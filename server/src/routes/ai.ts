import { Router } from "express";
import mongoose, { Model } from "mongoose";
import Groq from "groq-sdk";
import { ExpenseModel } from "../models/Expense.js";
import { SpaceModel } from "../models/Space.js";
import { UserModel } from "../models/User.js";
import { authRequired } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { config } from "../config.js";
import { notifyDataChanged, notifySpaceDataChanged } from "../lib/pusher.js";
import { getSpaceExpenseModel } from "../lib/spaceDb.js";
import {
  userBurstLimiter,
  groqSlidingLimiter,
  acquireGroqSlot,
  releaseGroqSlot,
  getActiveGroqCount,
} from "../middleware/groqRateLimiter.js";

const router = Router();
router.use(authRequired);

router.use((req, res, next) => {
  if (!userBurstLimiter.allow(String(req.userId ?? req.ip), 30)) {
    res.status(429).json({
      error: "Too many AI requests. Please slow down and wait a moment.",
      retryAfter: 60,
    });
    return;
  }
  next();
});

function logAiEvent(event: Record<string, unknown>): void {
  console.log(JSON.stringify({ event: "ai_request", timestamp: new Date().toISOString(), ...event }));
}

function groqClient() {
  if (!config.groqApiKey) {
    const err = new Error("AI features require GROQ_API_KEY to be set") as Error & { status: number };
    err.status = 503;
    throw err;
  }
  return new Groq({ apiKey: config.groqApiKey });
}

async function checkQuota(userId: string | undefined): Promise<{
  allowed: boolean;
  weeklyRemaining: number;
}> {
  if (!userId) {
    return { allowed: false, weeklyRemaining: 0 };
  }

  const weekStartKey = getWeekStartKey(new Date());

  const user = await UserModel.findById(userId).select("aiUsage").lean();
  const u = (user?.aiUsage ?? {}) as {
    weeklyCount?: number;
    weekStartDate?: string;
  };

  const currentWeekly = u.weekStartDate === weekStartKey ? (u.weeklyCount ?? 0) : 0;

  return {
    allowed: currentWeekly < config.aiWeeklyLimit,
    weeklyRemaining: Math.max(0, config.aiWeeklyLimit - currentWeekly),
  };
}

// C7: reset lands at the start of the Monday following the current date —
// i.e. usage resets right after Sunday 11:59pm — using the server's local
// clock/timezone rather than a hardcoded UTC offset.
function getWeekStartKey(now: Date): string {
  const day = now.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? 6 : day - 1;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffToMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function incrementQuota(userId: string | undefined, count = 1): Promise<{
  weeklyRemaining: number;
}> {
  if (!userId) {
    return { weeklyRemaining: 0 };
  }

  const weekStartKey = getWeekStartKey(new Date());

  const user = await UserModel.findById(userId).select("aiUsage").lean();
  const u = (user?.aiUsage ?? {}) as {
    weeklyCount?: number;
    weekStartDate?: string;
  };

  const update: Record<string, any> = { $inc: { "aiUsage.count": count } };
  const $set: Record<string, any> = {};

  if (u.weekStartDate === weekStartKey) {
    update.$inc["aiUsage.weeklyCount"] = count;
  } else {
    $set["aiUsage.weekStartDate"] = weekStartKey;
    $set["aiUsage.weeklyCount"] = count;
  }

  if (Object.keys($set).length) {
    update.$set = $set;
  }

  await UserModel.updateOne({ _id: userId }, update);

  const newWeekly = u.weekStartDate === weekStartKey ? (u.weeklyCount ?? 0) + count : count;

  return {
    weeklyRemaining: Math.max(0, config.aiWeeklyLimit - newWeekly),
  };
}

function rejectIfUnavailable(res: any, req: any, endpoint: string, start: number): boolean {
  if (!groqSlidingLimiter.allow(config.groqApiKey, 25)) {
    logAiEvent({
      userId: req.userId, endpoint, duration: Date.now() - start,
      status: "rate_limited", error: "groq_rate_limit",
    });
    res.status(429).json({
      error: "AI service is temporarily busy. Please try again shortly.",
      retryAfter: 60,
    });
    return true;
  }
  if (!acquireGroqSlot()) {
    logAiEvent({
      userId: req.userId, endpoint, duration: Date.now() - start,
      status: "rate_limited", error: "concurrency_limit",
      activeRequests: getActiveGroqCount(),
    });
    res.status(503).json({
      error: "AI service is at capacity. Please try again shortly.",
    });
    return true;
  }
  return false;
}

function rejectQuotaExceeded(
  res: any, usage: { allowed: boolean; weeklyRemaining: number },
  req: any, endpoint: string, start: number
): boolean {
  if (!usage.allowed) {
    logAiEvent({
      userId: req.userId, endpoint, duration: Date.now() - start,
      status: "rate_limited", error: "weekly_quota",
      weeklyRemaining: usage.weeklyRemaining,
    });
    res.status(429).json({
      error: "Weekly AI request limit reached. Resets Monday.",
      weeklyRemaining: usage.weeklyRemaining,
    });
    return true;
  }
  return false;
}

router.get(
  "/quota",
  asyncHandler(async (req, res) => {
    const quota = await checkQuota(req.userId);
    res.json({
      weeklyRemaining: quota.weeklyRemaining,
    });
  })
);

// C8: tool definitions the chat assistant can invoke to act on the user's
// data, in addition to answering questions about it.
const CHAT_TOOLS: Groq.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "add_transaction",
      description: "Add a new income or expense transaction for the user.",
      parameters: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["income", "expense"] },
          amount: { type: "number", description: "Positive amount" },
          category: { type: "string", description: "e.g. Food & Dining, Salary, Transportation" },
          date: { type: "string", description: "YYYY-MM-DD; defaults to today if omitted" },
          name: { type: "string", description: "Optional short title/label for the transaction" },
          note: { type: "string", description: "Optional merchant/description" },
          currency: { type: "string", description: "3-letter code; defaults to USD" },
        },
        required: ["type", "amount", "category"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_transaction",
      description: "Edit an existing transaction. The id comes from the transaction history listed above (each line is prefixed with its id in brackets).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          type: { type: "string", enum: ["income", "expense"] },
          amount: { type: "number" },
          category: { type: "string" },
          date: { type: "string", description: "YYYY-MM-DD" },
          name: { type: "string" },
          note: { type: "string" },
          currency: { type: "string" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_transaction",
      description: "Delete a transaction by its id (shown in brackets in the transaction history above).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
  },
];

// C8: which ledger the chat assistant is acting on — either the user's
// personal transactions or a Hub's shared ledger. Personal expenses are
// scoped by userId; a Hub's whole collection is the ledger, so the scope
// filter is empty (membership was already verified before this runs).
interface ChatDataContext {
  model: Model<any>;
  ownerFields: Record<string, any>;
  scopeFilter: Record<string, any>;
  notify: () => Promise<void>;
}

async function executeChatTool(
  userId: string,
  name: string,
  args: Record<string, any>,
  ctx: ChatDataContext
): Promise<Record<string, any>> {
  if (name === "add_transaction") {
    if (typeof args.type !== "string" || !["income", "expense"].includes(args.type)) {
      return { error: "type must be 'income' or 'expense'" };
    }
    if (typeof args.amount !== "number" || !(args.amount > 0) || args.amount > 1e12) {
      return { error: "amount must be a positive number" };
    }
    if (typeof args.category !== "string" || !args.category.trim()) {
      return { error: "category is required" };
    }
    const date = args.date && !isNaN(Date.parse(args.date)) ? new Date(args.date) : new Date();
    const expense = await ctx.model.create({
      ...ctx.ownerFields,
      type: args.type,
      amount: args.amount,
      category: args.category.trim().slice(0, 64),
      date,
      name: typeof args.name === "string" ? args.name.trim().slice(0, 120) : "",
      note: typeof args.note === "string" ? args.note.slice(0, 500) : "",
      currency: typeof args.currency === "string" && args.currency.trim() ? args.currency.trim().slice(0, 8) : "USD",
    });
    await ctx.notify();
    return { success: true, id: expense._id.toString() };
  }

  if (name === "edit_transaction") {
    if (typeof args.id !== "string" || !mongoose.Types.ObjectId.isValid(args.id)) {
      return { error: "invalid or missing id" };
    }
    const updates: Record<string, any> = {};
    if (args.type !== undefined) {
      if (!["income", "expense"].includes(args.type)) return { error: "type must be 'income' or 'expense'" };
      updates.type = args.type;
    }
    if (args.amount !== undefined) {
      if (typeof args.amount !== "number" || !(args.amount > 0) || args.amount > 1e12) {
        return { error: "amount must be a positive number" };
      }
      updates.amount = args.amount;
    }
    if (args.category !== undefined) updates.category = String(args.category).trim().slice(0, 64);
    if (args.name !== undefined) updates.name = String(args.name).trim().slice(0, 120);
    if (args.note !== undefined) updates.note = String(args.note).slice(0, 500);
    if (args.currency !== undefined) updates.currency = String(args.currency).trim().slice(0, 8);
    if (args.date !== undefined) {
      if (isNaN(Date.parse(args.date))) return { error: "date is invalid" };
      updates.date = new Date(args.date);
    }
    if (Object.keys(updates).length === 0) return { error: "no fields to update" };

    const expense = await ctx.model.findOneAndUpdate(
      { _id: args.id, ...ctx.scopeFilter },
      { $set: updates },
      { new: true }
    );
    if (!expense) return { error: "transaction not found" };
    await ctx.notify();
    return { success: true, id: expense._id.toString() };
  }

  if (name === "delete_transaction") {
    if (typeof args.id !== "string" || !mongoose.Types.ObjectId.isValid(args.id)) {
      return { error: "invalid or missing id" };
    }
    const expense = await ctx.model.findOneAndDelete({ _id: args.id, ...ctx.scopeFilter });
    if (!expense) return { error: "transaction not found" };
    await ctx.notify();
    return { success: true, id: args.id };
  }

  return { error: `unknown tool: ${name}` };
}

// Resolve which ledger a chat request should read from and act on. When
// spaceId is supplied the chat targets that Hub's shared ledger (membership
// is required); otherwise it targets the user's personal ledger.
async function resolveChatContext(
  req: { userId?: string },
  spaceId: unknown
): Promise<{ ctx: ChatDataContext; contextName: string; memberNames: Record<string, string> } | { error: string; status: number }> {
  const personalCtx: ChatDataContext = {
    model: ExpenseModel,
    ownerFields: { userId: req.userId },
    scopeFilter: { userId: req.userId },
    notify: () => notifyDataChanged(req.userId!),
  };

  if (typeof spaceId !== "string" || !spaceId) {
    return { ctx: personalCtx, contextName: "Personal", memberNames: {} };
  }
  if (!mongoose.Types.ObjectId.isValid(spaceId)) {
    return { error: "spaceId must be a valid Hub id", status: 400 };
  }

  const space = await SpaceModel.findById(spaceId).lean();
  const membership = space?.members.find(
    (m) => String(m.userId) === req.userId && m.status === "active"
  );
  if (!space || !membership) {
    return { error: "Not a member of this Hub", status: 403 };
  }

  const memberNames: Record<string, string> = {};
  for (const m of space.members) memberNames[String(m.userId)] = m.nickname;

  return {
    ctx: {
      model: getSpaceExpenseModel(spaceId),
      ownerFields: { authorUserId: req.userId },
      scopeFilter: {},
      notify: () => notifySpaceDataChanged(spaceId),
    },
    contextName: `Hub: ${space.name}`,
    memberNames,
  };
}

router.post(
  "/chat",
  asyncHandler(async (req, res) => {
    const start = Date.now();
    const { message, history = [], spaceId, lang } = req.body ?? {};
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }
    if (!Array.isArray(history)) {
      return res.status(400).json({ error: "history must be an array" });
    }

    const usage = await checkQuota(req.userId);
    if (rejectQuotaExceeded(res, usage, req, "/chat", start)) return;
    if (rejectIfUnavailable(res, req, "/chat", start)) return;

    try {
      // Resolve the ledger (personal or Hub) inside the try so the acquired
      // Groq slot is always released, including on membership/validation errors.
      const resolved = await resolveChatContext(req, spaceId);
      if ("error" in resolved) {
        logAiEvent({
          userId: req.userId, endpoint: "/chat", duration: Date.now() - start,
          status: "error", error: resolved.error,
        });
        return res.status(resolved.status).json({ error: resolved.error });
      }
      const { ctx, contextName, memberNames } = resolved;

      const expenses = await ctx.model.find(ctx.scopeFilter).sort({ date: -1 }).limit(200).lean();
      const totalIncome = expenses.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
      const totalExpense = expenses.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);

      const lines = expenses.map((e) => {
        const d = new Date(e.date).toISOString().substring(0, 10);
        const name = e.name ? ` "${e.name}"` : "";
        const note = e.note ? ` | ${e.note}` : "";
        const member = e.familyMember
          ? ` (${e.familyMember})`
          : e.authorUserId
            ? ` (by ${memberNames[String(e.authorUserId)] ?? "a Hub member"})`
            : "";
        return `[${e._id}] ${d} | ${e.type} | ${e.currency} ${e.amount} | ${e.category}${name}${note}${member}`;
      });

      const today = new Date().toISOString().substring(0, 10);
      const languageLine =
        lang === "es"
          ? "\nReply in Spanish (es). Use natural, conversational Spanish."
          : lang && lang !== "en"
            ? `\nReply in the user's language (locale: ${lang}).`
            : "\nReply in English.";
      const systemPrompt = `You are a personal finance assistant for SpendsWise.
Today: ${today}
Context: ${contextName}
Total Income: ${totalIncome} | Total Expenses: ${totalExpense} | Balance: ${totalIncome - totalExpense}

Transaction history (newest first, id in brackets):
${lines.length ? lines.join("\n") : "No transactions yet."}

Be concise, specific to the user's actual data, and actionable. You can add, edit, or delete
transactions on the user's behalf using the provided tools when they ask you to (e.g. "log $12 for lunch",
"delete that Netflix charge", "change yesterday's grocery amount to 40"). Confirm what you did in your reply.
Never invent a transaction id — only use ids that appear in the history above.
Transaction ids are internal identifiers only: never show a transaction id to the user. When you
confirm an edit or deletion, describe the transaction by its date, category, amount, and name/note instead
(e.g. "Updated the $40 Groceries charge from yesterday to $35.50").${languageLine}`;

      const safeHistory = history
        .slice(-10)
        .filter(
          (m: unknown): m is { role: string; content: string } =>
            !!m &&
            typeof (m as Record<string, unknown>).role === "string" &&
            typeof (m as Record<string, unknown>).content === "string"
        )
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

      const messages: Groq.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: systemPrompt },
        ...safeHistory,
        { role: "user", content: message.trim() },
      ];

      let completion = await groqClient().chat.completions.create({
        model: config.groqModel,
        messages,
        max_tokens: 1024,
        tools: CHAT_TOOLS,
        tool_choice: "auto",
      });

      let responseMessage = completion.choices[0]?.message;
      let dataChanged = false;
      let totalTokens = completion.usage?.total_tokens ?? 0;

      // C8: cap tool-call rounds so a misbehaving model can't loop forever.
      for (let round = 0; round < 3 && responseMessage?.tool_calls?.length; round++) {
        messages.push(responseMessage);
        for (const call of responseMessage.tool_calls.slice(0, 10)) {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(call.function.arguments || "{}");
          } catch {
            // malformed args — let the tool executor's own validation report the error
          }
          const result = await executeChatTool(req.userId!, call.function.name, args, ctx);
          if (result.success) dataChanged = true;
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }

        completion = await groqClient().chat.completions.create({
          model: config.groqModel,
          messages,
          max_tokens: 512,
          tools: CHAT_TOOLS,
          tool_choice: "auto",
        });
        responseMessage = completion.choices[0]?.message;
        totalTokens += completion.usage?.total_tokens ?? 0;
      }

      const remaining = await incrementQuota(req.userId);

      logAiEvent({
        userId: req.userId, endpoint: "/chat", duration: Date.now() - start,
        status: "success", weeklyRemaining: remaining.weeklyRemaining, groqModel: config.groqModel,
        groqTokens: totalTokens, dataChanged,
      });

      return res.json({
        reply: responseMessage?.content ?? "Sorry, I could not generate a response.",
        dataChanged,
        weeklyRemaining: remaining.weeklyRemaining,
      });
    } catch (err) {
      logAiEvent({
        userId: req.userId, endpoint: "/chat", duration: Date.now() - start,
        status: "error", error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      releaseGroqSlot();
    }
  })
);

export default router;

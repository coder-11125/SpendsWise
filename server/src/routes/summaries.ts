import { Router } from "express";
import mongoose, { Model } from "mongoose";
import Groq from "groq-sdk";
import { ExpenseModel } from "../models/Expense.js";
import { SpaceModel } from "../models/Space.js";
import { UserModel } from "../models/User.js";
import { SummaryModel } from "../models/Summary.js";
import { WeeklySummaryModel } from "../models/WeeklySummary.js";
import { authRequired } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { config } from "../config.js";
import { groqSlidingLimiter, acquireGroqSlot, releaseGroqSlot } from "../middleware/groqRateLimiter.js";
import { zonedNowParts } from "../lib/timezone.js";
import { getSpaceExpenseModel } from "../lib/spaceDb.js";
import { fetchCurrencyRates } from "../lib/currencyRates.js";

const router = Router();
router.use(authRequired);

// How many completed weeks back each request keeps summarized (backfilling
// weeks nobody opened the page for), how many AI write-ups one request may
// generate (the rest get the plain-numbers narrative and are upgraded on a
// later request), and how long a plain-numbers narrative waits before the AI
// is retried.
export const SUMMARY_WINDOW_WEEKS = 12;
export const MAX_AI_GENERATIONS_PER_REQUEST = 2;
export const AI_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function addDaysToYMD(y: number, m: number, d: number, delta: number): { y: number; m: number; d: number } {
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

// C9: weeks run Monday..Sunday. Transaction dates are stored as plain
// UTC-midnight calendar days (matching the rest of the app), so week
// boundaries stay in calendar-date space rather than converting through
// real timezone-instant math — the only place the user's timezone actually
// matters is figuring out what "today" is for them right now.
function getWeekRange(timeZone: string, weeksAgo: number) {
  const now = zonedNowParts(timeZone);
  const diffToMonday = now.dayOfWeek === 0 ? 6 : now.dayOfWeek - 1;
  const currentMonday = addDaysToYMD(now.y, now.m, now.d, -diffToMonday);
  const monday = addDaysToYMD(currentMonday.y, currentMonday.m, currentMonday.d, -7 * weeksAgo);
  const sunday = addDaysToYMD(monday.y, monday.m, monday.d, 6);
  const startKey = dateKey(monday.y, monday.m, monday.d);
  const endKey = dateKey(sunday.y, sunday.m, sunday.d);
  return {
    startKey,
    endKey,
    startUtc: new Date(`${startKey}T00:00:00.000Z`),
    endUtc: new Date(`${endKey}T23:59:59.999Z`),
  };
}
type WeekRange = ReturnType<typeof getWeekRange>;

interface Tx {
  _id: unknown;
  type: string;
  amount: number; // in the summary's display currency (see convertAll)
  rawAmount: number;
  currency: string;
  category: string;
  note?: string;
  date: Date;
  updatedAt?: Date;
  authorUserId?: unknown;
}

interface CategoryBreakdown { category: string; amount: number; count: number }
interface MemberBreakdown { name: string; income: number; expense: number }
interface WeekStats {
  transactions: Tx[];
  totalIncome: number;
  totalExpense: number;
  net: number;
  transactionCount: number;
  byCategory: CategoryBreakdown[];
  byMember: MemberBreakdown[];
}

interface Scope {
  scopeKey: string;
  model: Model<any>;
  filter: Record<string, unknown>;
  // Hub ledgers only: userId -> member nickname, and the Hub's name.
  memberNames: Record<string, string>;
  ledgerName: string | null;
}

// Personal ledger by default; ?spaceId= summarizes that Hub's own database,
// for active members only (mirrors the AI chat's context resolution).
async function resolveScope(userId: string, spaceId: unknown): Promise<Scope | { error: string; status: number }> {
  if (typeof spaceId !== "string" || !spaceId) {
    return { scopeKey: `user:${userId}`, model: ExpenseModel, filter: { userId }, memberNames: {}, ledgerName: null };
  }
  if (!mongoose.Types.ObjectId.isValid(spaceId)) {
    return { error: "spaceId must be a valid Hub id", status: 400 };
  }
  const space = await SpaceModel.findById(spaceId).lean();
  const membership = space?.members.find((m) => String(m.userId) === userId && m.status === "active");
  if (!space || !membership) {
    return { error: "Not a member of this Hub", status: 403 };
  }
  const memberNames: Record<string, string> = {};
  for (const m of space.members) memberNames[String(m.userId)] = m.nickname;
  return {
    scopeKey: `space:${spaceId}`,
    model: getSpaceExpenseModel(spaceId),
    filter: {},
    memberNames,
    ledgerName: space.name,
  };
}

// Converts every amount into `currency`. Rates are keyed by the target
// currency (units of `from` per 1 target), so target = amount / rates[from].
// Without live rates amounts are left as recorded and `converted` is false.
async function convertAll(raw: Array<Record<string, any>>, currency: string): Promise<{ txs: Tx[]; converted: boolean }> {
  const toTx = (t: Record<string, any>, amount: number): Tx => ({
    _id: t._id,
    type: t.type,
    amount,
    rawAmount: t.amount,
    currency: String(t.currency || "USD").toUpperCase(),
    category: t.category,
    note: t.note,
    date: t.date,
    updatedAt: t.updatedAt,
    authorUserId: t.authorUserId,
  });

  const hasForeign = raw.some((t) => String(t.currency || "USD").toUpperCase() !== currency);
  if (!hasForeign) return { txs: raw.map((t) => toTx(t, t.amount)), converted: true };

  const { rates, live } = await fetchCurrencyRates(currency);
  let converted = live;
  const txs = raw.map((t) => {
    const from = String(t.currency || "USD").toUpperCase();
    if (from === currency) return toTx(t, t.amount);
    const rate = rates[from];
    if (!live || !rate) {
      converted = false;
      return toTx(t, t.amount);
    }
    return toTx(t, t.amount / rate);
  });
  return { txs, converted };
}

function inWeek(t: Tx, week: WeekRange): boolean {
  return t.date >= week.startUtc && t.date <= week.endUtc;
}

function computeStats(transactions: Tx[], memberNames: Record<string, string>): WeekStats {
  const income = transactions.filter((t) => t.type === "income");
  const expense = transactions.filter((t) => t.type === "expense");
  const totalIncome = income.reduce((s, t) => s + t.amount, 0);
  const totalExpense = expense.reduce((s, t) => s + t.amount, 0);

  const byCategoryMap = new Map<string, CategoryBreakdown>();
  for (const t of expense) {
    const existing = byCategoryMap.get(t.category) ?? { category: t.category, amount: 0, count: 0 };
    existing.amount += t.amount;
    existing.count += 1;
    byCategoryMap.set(t.category, existing);
  }

  // Hub ledgers attribute each entry to the member who added it.
  const byMemberMap = new Map<string, MemberBreakdown>();
  if (Object.keys(memberNames).length > 0) {
    for (const t of transactions) {
      const name = memberNames[String(t.authorUserId)] || "Former member";
      const m = byMemberMap.get(name) ?? { name, income: 0, expense: 0 };
      if (t.type === "income") m.income += t.amount;
      else m.expense += t.amount;
      byMemberMap.set(name, m);
    }
  }

  return {
    transactions,
    totalIncome,
    totalExpense,
    net: totalIncome - totalExpense,
    transactionCount: transactions.length,
    byCategory: [...byCategoryMap.values()].sort((a, b) => b.amount - a.amount),
    byMember: [...byMemberMap.values()].sort((a, b) => b.expense - a.expense),
  };
}

// Identifies the data a narrative was written from: the week's and the
// previous week's entries (it compares against last week), whether amounts
// were converted, and Hub member names. Any edit, add or delete changes it.
function fingerprint(week: Tx[], prev: Tx[], converted: boolean, memberNames: Record<string, string>): string {
  const part = (txs: Tx[]) => {
    const sum = txs.reduce((s, t) => s + t.rawAmount, 0);
    const latest = txs.reduce((m, t) => Math.max(m, t.updatedAt ? new Date(t.updatedAt).getTime() : 0), 0);
    return `${txs.length}:${sum.toFixed(2)}:${latest}`;
  };
  const members = Object.values(memberNames).sort().join(",");
  return `${part(week)}|${part(prev)}|${converted ? 1 : 0}|${members}`;
}

function moneyFormatter(lang: string, currency: string): (n: number) => string {
  try {
    const fmt = new Intl.NumberFormat(lang === "es" ? "es-ES" : "en-US", { style: "currency", currency });
    return (n) => fmt.format(n);
  } catch {
    return (n) => `${n.toFixed(2)} ${currency}`;
  }
}

function fallbackNarrative(stats: WeekStats, lang: string, currency: string): string {
  const m = moneyFormatter(lang, currency);
  const top = stats.byCategory[0];
  if (lang === "es") {
    return (
      `Esta semana gastaste ${m(stats.totalExpense)} en ${stats.transactionCount} transacción(es)` +
      (top ? `, siendo ${top.category} tu categoría más grande con ${m(top.amount)}` : "") +
      `. Los ingresos fueron ${m(stats.totalIncome)}, con un neto de ${m(stats.net)}.`
    );
  }
  return (
    `This week you spent ${m(stats.totalExpense)} across ${stats.transactionCount} transaction(s)` +
    (top ? `, with ${top.category} as your largest category at ${m(top.amount)}` : "") +
    `. Income was ${m(stats.totalIncome)}, leaving a net of ${m(stats.net)}.`
  );
}

function groqClient() {
  return new Groq({ apiKey: config.groqApiKey });
}

// Reasoning models spend completion tokens thinking before they answer; keep
// that short so the recap itself isn't cut off (an empty reply falls back).
function reasoningParams(model: string): { reasoning_effort?: "low" } {
  return /gpt-oss|qwen3/i.test(model) ? { reasoning_effort: "low" } : {};
}

// C10: generation is deliberately data-first — every number in the prompt is
// pre-computed server-side so the model only has to narrate real figures,
// not calculate or invent them, which is what keeps this from reading as
// generic AI filler.
async function generateNarrative(
  stats: WeekStats,
  prevStats: WeekStats,
  week: WeekRange,
  lang: string,
  currency: string,
  ledgerName: string | null
): Promise<{ narrative: string; aiGenerated: boolean }> {
  const fallback = { narrative: fallbackNarrative(stats, lang, currency), aiGenerated: false };
  if (!config.groqApiKey) return fallback;
  if (!groqSlidingLimiter.allow(config.groqApiKey, 25) || !acquireGroqSlot()) {
    console.warn("[Summaries] Groq busy — saving the plain-numbers narrative for", week.startKey);
    return fallback;
  }
  try {
    const topCategories = stats.byCategory
      .slice(0, 6)
      .map((c) => `- ${c.category}: ${c.amount.toFixed(2)} across ${c.count} transaction(s)`)
      .join("\n");

    const memberLines = stats.byMember
      .map((mb) => `- ${mb.name}: spent ${mb.expense.toFixed(2)}, added income ${mb.income.toFixed(2)}`)
      .join("\n");

    const notesList = stats.transactions
      .filter((t) => t.type === "expense" && t.note)
      .slice(0, 25)
      .map((t) => `- ${t.category} — "${t.note}": ${t.amount.toFixed(2)}`)
      .join("\n");

    const changeText =
      prevStats.transactionCount > 0
        ? (() => {
            const diff = stats.totalExpense - prevStats.totalExpense;
            const pct = prevStats.totalExpense > 0 ? ((diff / prevStats.totalExpense) * 100).toFixed(1) : "n/a";
            return `Previous week's total expenses: ${prevStats.totalExpense.toFixed(2)} (this week is ${diff >= 0 ? "up" : "down"} ${Math.abs(diff).toFixed(2)}, ${pct}%).`;
          })()
        : "No transactions recorded the previous week to compare against.";

    const prompt = `You are writing a weekly spending summary for a personal finance app called SpendsWise.
Use ONLY the numbers given below — never estimate, round loosely, or invent a figure that isn't here.
Reference actual category names and merchant/description notes from the data. Do not use generic filler
phrases like "great job" or "you should budget better" unless directly tied to a specific number below.
Write 3-4 short, dense paragraphs, then a "Highlights" section with 2-4 bullet points calling out concrete
things (e.g. the single largest expense with its amount and note, the category that grew or shrank the most
vs last week with the actual percentage, an unusually high-frequency category).${
  lang === "es" ? "\nWrite the summary in Spanish (es). Use natural, conversational Spanish." : ""
}${
  ledgerName
    ? `\nThis is a shared household ledger ("${ledgerName}"). Mention how spending split between members.`
    : ""
}

All amounts are in ${currency}.
Week: ${week.startKey} to ${week.endKey}
Total income: ${stats.totalIncome.toFixed(2)}
Total expenses: ${stats.totalExpense.toFixed(2)}
Net: ${stats.net.toFixed(2)}
Transaction count: ${stats.transactionCount}

Spending by category (highest first):
${topCategories || "No expenses recorded this week."}
${memberLines ? `\nBy member:\n${memberLines}\n` : ""}
${changeText}

Individual expense notes this week:
${notesList || "No notes recorded on any expense this week."}`;

    const completion = await groqClient().chat.completions.create({
      model: config.groqModel,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
      temperature: 0.4,
      ...reasoningParams(config.groqModel),
    });

    const content = completion.choices[0]?.message?.content?.trim();
    if (!content) {
      console.warn("[Summaries] Groq returned an empty narrative for", week.startKey, "— using plain numbers");
      return fallback;
    }
    return { narrative: content, aiGenerated: true };
  } catch (err) {
    console.error("[Summaries] Groq generation failed:", err);
    return fallback;
  } finally {
    releaseGroqSlot();
  }
}

function toResponse(doc: Record<string, any>, legacy = false) {
  return {
    weekStartDate: doc.weekStartDate,
    weekEndDate: doc.weekEndDate,
    narrative: doc.narrative,
    currency: legacy ? null : doc.currency,
    lang: legacy ? null : doc.lang,
    aiGenerated: legacy ? true : doc.aiGenerated,
    converted: legacy ? true : doc.converted,
    legacy,
    stats: {
      totalIncome: doc.stats.totalIncome,
      totalExpense: doc.stats.totalExpense,
      net: doc.stats.net,
      transactionCount: doc.stats.transactionCount,
      byCategory: doc.stats.byCategory ?? [],
      byMember: doc.stats.byMember ?? [],
      previousWeekExpense: doc.stats.previousWeekExpense ?? null,
    },
  };
}

// GET /api/summaries?lang=en|es&currency=XXX[&spaceId=<hub>]
// Keeps the last SUMMARY_WINDOW_WEEKS completed weeks (in the user's timezone)
// of the chosen ledger summarized, then returns that ledger's full history.
// Weeks are (re)generated when missing, when their data changed since the
// narrative was written, or when a plain-numbers narrative is due an AI retry.
// AI calls per request are capped; this never touches the interactive AI quota.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const scope = await resolveScope(req.userId!, req.query.spaceId);
    if ("error" in scope) return res.status(scope.status).json({ error: scope.error });

    const user = await UserModel.findById(req.userId).select("timezone").lean();
    const timezone = user?.timezone || "UTC";
    const lang = req.query.lang === "es" ? "es" : "en";
    const requestedCurrency = typeof req.query.currency === "string" ? req.query.currency.toUpperCase() : "";
    const currency = /^[A-Z]{3}$/.test(requestedCurrency) ? requestedCurrency : "USD";

    // Newest first; one extra week at the end so the oldest has a "previous week".
    const weeks = Array.from({ length: SUMMARY_WINDOW_WEEKS + 1 }, (_, i) => getWeekRange(timezone, i + 1));
    const raw = await scope.model
      .find({ ...scope.filter, date: { $gte: weeks[weeks.length - 1].startUtc, $lte: weeks[0].endUtc } })
      .select("type amount currency category note date updatedAt authorUserId")
      .sort({ date: 1 })
      .lean();
    const { txs, converted } = await convertAll(raw as Array<Record<string, any>>, currency);

    const windowStart = weeks[SUMMARY_WINDOW_WEEKS - 1].startKey;
    const existingDocs = await WeeklySummaryModel.find({
      scopeKey: scope.scopeKey,
      lang,
      currency,
      weekStartDate: { $gte: windowStart },
    }).lean();
    const existingByWeek = new Map(existingDocs.map((d) => [d.weekStartDate, d]));

    let aiBudget = MAX_AI_GENERATIONS_PER_REQUEST;
    for (let i = 0; i < SUMMARY_WINDOW_WEEKS; i++) {
      const week = weeks[i];
      const weekTxs = txs.filter((t) => inWeek(t, week));
      const prevTxs = txs.filter((t) => inWeek(t, weeks[i + 1]));
      const existing = existingByWeek.get(week.startKey);

      if (weekTxs.length === 0) {
        // Every entry for that week was deleted (or moved): drop its recap.
        if (existing) await WeeklySummaryModel.deleteOne({ _id: existing._id });
        continue;
      }

      const sourceFingerprint = fingerprint(weekTxs, prevTxs, converted, scope.memberNames);
      const fresh = existing?.sourceFingerprint === sourceFingerprint;
      const dueAiRetry =
        !!existing &&
        !existing.aiGenerated &&
        !!config.groqApiKey &&
        Date.now() - new Date(existing.updatedAt).getTime() >= AI_RETRY_COOLDOWN_MS;
      if (fresh && !dueAiRetry) continue;

      const stats = computeStats(weekTxs, scope.memberNames);
      const prevStats = computeStats(prevTxs, scope.memberNames);
      let result = { narrative: fallbackNarrative(stats, lang, currency), aiGenerated: false };
      if (aiBudget > 0 && config.groqApiKey) {
        aiBudget--;
        result = await generateNarrative(stats, prevStats, week, lang, currency, scope.ledgerName);
      }
      // A retry that fell back again changes nothing; leave the cooldown running.
      if (fresh && !result.aiGenerated) continue;

      try {
        await WeeklySummaryModel.updateOne(
          { scopeKey: scope.scopeKey, lang, currency, weekStartDate: week.startKey },
          {
            $set: {
              weekEndDate: week.endKey,
              timezone,
              narrative: result.narrative,
              aiGenerated: result.aiGenerated,
              converted,
              sourceFingerprint,
              stats: {
                totalIncome: stats.totalIncome,
                totalExpense: stats.totalExpense,
                net: stats.net,
                transactionCount: stats.transactionCount,
                byCategory: stats.byCategory,
                byMember: stats.byMember,
                previousWeekExpense: prevStats.transactionCount > 0 ? prevStats.totalExpense : null,
              },
            },
          },
          { upsert: true }
        );
      } catch (err: any) {
        // Unique-index race with a concurrent request writing the same week.
        if (err?.code !== 11000) throw err;
      }
    }

    const docs = await WeeklySummaryModel.find({ scopeKey: scope.scopeKey, lang, currency })
      .sort({ weekStartDate: -1 })
      .lean();
    const summaries = docs.map((d) => toResponse(d));

    // Personal-ledger recaps from before this cache existed, for weeks it
    // doesn't cover (older than anything regenerated above).
    if (scope.scopeKey.startsWith("user:")) {
      const oldest = summaries.length ? summaries[summaries.length - 1].weekStartDate : windowStart;
      const legacy = await SummaryModel.find({
        userId: req.userId,
        weekStartDate: { $lt: oldest < windowStart ? oldest : windowStart },
      })
        .sort({ weekStartDate: -1 })
        .lean();
      for (const doc of legacy) summaries.push(toResponse(doc, true));
    }

    return res.json({ summaries });
  })
);

export default router;

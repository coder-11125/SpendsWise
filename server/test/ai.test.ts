import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, clearDb, stopTestDb } from "./helpers/db.js";
import { createUser } from "./helpers/auth.js";
import { ExpenseModel } from "../src/models/Expense.js";
import { SpaceModel } from "../src/models/Space.js";
import { getSpaceExpenseModel } from "../src/lib/spaceDb.js";

// C8: The chat endpoint calls Groq with tool definitions and runs any tool
// calls it receives against the user's ledger. Script the Groq client so we
// can exercise the tool-execution path without a real API key.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("groq-sdk", () => {
  return {
    default: class {
      chat = { completions: { create: createMock } };
    },
  };
});

import aiRouter from "../src/routes/ai.js";

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use("/api/ai", aiRouter);

function as(token: string) {
  return { Cookie: [`sw_session=${token}`] };
}

function toolCallMessage(name: string, args: Record<string, unknown>) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_1",
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function finalMessage(content: string) {
  return { choices: [{ message: { role: "assistant", content } }], usage: { total_tokens: 5 } };
}

function scriptToolRound(name: string, args: Record<string, unknown>, reply: string) {
  createMock
    .mockResolvedValueOnce({ choices: [{ message: toolCallMessage(name, args) }], usage: { total_tokens: 5 } })
    .mockResolvedValueOnce(finalMessage(reply));
}

beforeAll(async () => {
  await startTestDb();
});

beforeEach(async () => {
  await clearDb();
  createMock.mockReset();
});

afterAll(async () => {
  await stopTestDb();
});

describe("AI chat agentic tools", () => {
  it("adds a transaction to the personal ledger when the model calls add_transaction", async () => {
    const { _id, token } = await createUser();
    scriptToolRound(
      "add_transaction",
      { type: "expense", amount: 12.5, category: "Food & Dining", note: "lunch" },
      "Added $12.50 to Food & Dining."
    );

    const res = await request(app)
      .post("/api/ai/chat")
      .set(as(token))
      .send({ message: "log $12.50 for lunch" });

    expect(res.status).toBe(200);
    expect(res.body.reply).toBe("Added $12.50 to Food & Dining.");
    expect(res.body.dataChanged).toBe(true);

    const created = await ExpenseModel.findOne({ userId: _id });
    expect(created).not.toBeNull();
    expect(created!.amount).toBe(12.5);
    expect(created!.category).toBe("Food & Dining");
    expect(created!.note).toBe("lunch");
  });

  it("edits an existing personal transaction via edit_transaction", async () => {
    const { _id, token } = await createUser();
    const expense = await ExpenseModel.create({
      userId: _id,
      type: "expense",
      amount: 40,
      category: "Groceries",
      date: new Date(),
    });

    scriptToolRound(
      "edit_transaction",
      { id: expense._id.toString(), amount: 35.5, category: "Shopping" },
      "Updated the grocery charge to $35.50."
    );

    const res = await request(app)
      .post("/api/ai/chat")
      .set(as(token))
      .send({ message: "change yesterday's grocery amount to 35.50" });

    expect(res.status).toBe(200);
    expect(res.body.dataChanged).toBe(true);

    const updated = await ExpenseModel.findById(expense._id);
    expect(updated!.amount).toBe(35.5);
    expect(updated!.category).toBe("Shopping");
  });

  it("adds a transaction to a Hub's shared ledger when spaceId is provided", async () => {
    const { _id, token } = await createUser();
    const space = await SpaceModel.create({
      name: "Family",
      ownerId: _id,
      members: [{ userId: _id, nickname: "Ranji", role: "owner", status: "active" }],
    });

    scriptToolRound(
      "add_transaction",
      { type: "expense", amount: 89.9, category: "Utilities", note: "electric bill" },
      "Logged the electric bill in Family."
    );

    const res = await request(app)
      .post("/api/ai/chat")
      .set(as(token))
      .send({ message: "log the $89.90 electric bill", spaceId: space._id.toString() });

    expect(res.status).toBe(200);
    expect(res.body.dataChanged).toBe(true);

    const created = await getSpaceExpenseModel(space._id.toString()).findOne({});
    expect(created).not.toBeNull();
    expect(created!.amount).toBe(89.9);
    expect(created!.authorUserId.toString()).toBe(_id.toString());
    // Hub expenses must not leak into the personal ledger.
    const personalCount = await ExpenseModel.countDocuments({ userId: _id });
    expect(personalCount).toBe(0);
  });

  it("rejects chat against a Hub the user is not a member of", async () => {
    const user = await createUser();
    const owner = await createUser();
    const space = await SpaceModel.create({
      name: "Private Hub",
      ownerId: owner._id,
      members: [{ userId: owner._id, nickname: "Owner", role: "owner", status: "active" }],
    });

    const res = await request(app)
      .post("/api/ai/chat")
      .set(as(user.token))
      .send({ message: "log $5 for coffee", spaceId: space._id.toString() });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Not a member");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid spaceId format", async () => {
    const { token } = await createUser();
    const res = await request(app)
      .post("/api/ai/chat")
      .set(as(token))
      .send({ message: "log $5 for coffee", spaceId: "not-an-object-id" });
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not persist anything when the model declines to call a tool", async () => {
    const { _id, token } = await createUser();
    createMock.mockResolvedValueOnce(finalMessage("You have no transactions yet."));

    const res = await request(app)
      .post("/api/ai/chat")
      .set(as(token))
      .send({ message: "what did I spend last week?" });

    expect(res.status).toBe(200);
    expect(res.body.dataChanged).toBe(false);
    expect(await ExpenseModel.countDocuments({ userId: _id })).toBe(0);
  });
});

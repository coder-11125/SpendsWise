import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestDb, clearDb, stopTestDb } from "./helpers/db.js";
import { createUser } from "./helpers/auth.js";
import { ExpenseModel } from "../src/models/Expense.js";
import { SpaceModel } from "../src/models/Space.js";
import { SummaryModel } from "../src/models/Summary.js";
import { WeeklySummaryModel } from "../src/models/WeeklySummary.js";
import { getSpaceExpenseModel } from "../src/lib/spaceDb.js";
import type { Types } from "mongoose";

// Script Groq so the summary generation path runs without a real API key,
// and exchange rates so currency conversion doesn't hit the network.
const { createMock, ratesMock } = vi.hoisted(() => ({ createMock: vi.fn(), ratesMock: vi.fn() }));

vi.mock("groq-sdk", () => {
  return {
    default: class {
      chat = { completions: { create: createMock } };
    },
  };
});

vi.mock("../src/lib/currencyRates.js", () => ({ fetchCurrencyRates: ratesMock }));

import summariesRouter, { MAX_AI_GENERATIONS_PER_REQUEST } from "../src/routes/summaries.js";

const app = express();
app.use(cookieParser());
app.use(express.json());
app.use("/api/summaries", summariesRouter);

function as(token: string) {
  return { Cookie: [`sw_session=${token}`] };
}

// Monday (YYYY-MM-DD, UTC) of the week `weeksAgo` completed weeks back; mirrors
// getWeekRange(timezone, n) for test users, whose timezone defaults to UTC.
function weekStart(weeksAgo: number): string {
  const now = new Date();
  const dayOfWeek = now.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMonday - 7 * weeksAgo));
  return monday.toISOString().slice(0, 10);
}

async function addExpense(userId: Types.ObjectId, weeksAgo: number, overrides: Record<string, unknown> = {}) {
  return ExpenseModel.create({
    userId,
    type: "expense",
    amount: 42,
    category: "Food & Dining",
    currency: "USD",
    date: new Date(`${weekStart(weeksAgo)}T12:00:00.000Z`),
    ...overrides,
  });
}

function aiReply(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeAll(async () => {
  await startTestDb();
});

beforeEach(async () => {
  await clearDb();
  createMock.mockReset();
  ratesMock.mockReset();
  ratesMock.mockResolvedValue({ rates: { USD: 1, EUR: 0.5 }, live: true });
});

afterAll(async () => {
  await stopTestDb();
});

describe("GET /api/summaries language", () => {
  it("generates a Spanish fallback narrative when lang=es and Groq fails", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockRejectedValue(new Error("groq down"));

    const res = await request(app).get("/api/summaries?lang=es").set(as(token));

    expect(res.status).toBe(200);
    expect(res.body.summaries).toHaveLength(1);
    expect(res.body.summaries[0].narrative).toMatch(/Esta semana gastaste/);
    expect(res.body.summaries[0].aiGenerated).toBe(false);
  });

  it("instructs the model to write in Spanish when lang=es", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("Resumen semanal en español."));

    const res = await request(app).get("/api/summaries?lang=es").set(as(token));

    expect(res.status).toBe(200);
    const prompt = createMock.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toMatch(/in Spanish \(es\)/i);
    expect(res.body.summaries[0]).toMatchObject({ narrative: "Resumen semanal en español.", aiGenerated: true, lang: "es" });
  });

  it("keeps the English fallback, with currency formatting, when lang is omitted", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockRejectedValue(new Error("groq down"));

    const res = await request(app).get("/api/summaries").set(as(token));

    expect(res.status).toBe(200);
    expect(res.body.summaries[0].narrative).toMatch(/This week you spent \$42\.00/);
    expect(res.body.summaries[0].narrative).toMatch(/Income was \$0\.00/);
  });

  it("asks reasoning models for low reasoning effort and room for the reply", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("Recap."));

    await request(app).get("/api/summaries").set(as(token));

    const params = createMock.mock.calls[0][0];
    expect(params.reasoning_effort).toBe("low");
    expect(params.max_tokens).toBeGreaterThanOrEqual(1500);
  });

  it("falls back to plain numbers when the model returns an empty reply", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("   "));

    const res = await request(app).get("/api/summaries").set(as(token));

    expect(res.body.summaries[0].aiGenerated).toBe(false);
    expect(res.body.summaries[0].narrative).toMatch(/This week you spent/);
  });
});

describe("GET /api/summaries generation", () => {
  it("backfills past weeks that were never opened and skips empty weeks", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    await addExpense(_id, 3);
    createMock.mockResolvedValue(aiReply("Recap."));

    const res = await request(app).get("/api/summaries").set(as(token));

    expect(res.body.summaries.map((s: any) => s.weekStartDate)).toEqual([weekStart(1), weekStart(3)]);
  });

  it("caps AI write-ups per request and upgrades the rest on later requests", async () => {
    const { _id, token } = await createUser();
    for (const w of [1, 2, 3, 4]) await addExpense(_id, w);
    createMock.mockResolvedValue(aiReply("Recap."));

    const first = await request(app).get("/api/summaries").set(as(token));
    expect(createMock).toHaveBeenCalledTimes(MAX_AI_GENERATIONS_PER_REQUEST);
    expect(first.body.summaries).toHaveLength(4);
    expect(first.body.summaries.filter((s: any) => s.aiGenerated)).toHaveLength(MAX_AI_GENERATIONS_PER_REQUEST);

    // Plain-numbers weeks wait out the retry cooldown, so an immediate reload is free.
    await request(app).get("/api/summaries").set(as(token));
    expect(createMock).toHaveBeenCalledTimes(MAX_AI_GENERATIONS_PER_REQUEST);

    // Once the cooldown has passed, they're upgraded.
    await WeeklySummaryModel.collection.updateMany({ aiGenerated: false }, { $set: { updatedAt: new Date(0) } });
    const later = await request(app).get("/api/summaries").set(as(token));
    expect(later.body.summaries.every((s: any) => s.aiGenerated)).toBe(true);
  });

  it("regenerates a week when its entries change, and not otherwise", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("Recap."));

    await request(app).get("/api/summaries").set(as(token));
    await request(app).get("/api/summaries").set(as(token));
    expect(createMock).toHaveBeenCalledTimes(1);

    await addExpense(_id, 1, { amount: 8, category: "Transportation" });
    const res = await request(app).get("/api/summaries").set(as(token));

    expect(createMock).toHaveBeenCalledTimes(2);
    expect(res.body.summaries[0].stats).toMatchObject({ transactionCount: 2, totalExpense: 50 });
  });

  it("regenerates when an entry is edited", async () => {
    const { _id, token } = await createUser();
    const entry = await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("Recap."));
    await request(app).get("/api/summaries").set(as(token));

    await ExpenseModel.updateOne({ _id: entry._id }, { $set: { amount: 100 } });
    const res = await request(app).get("/api/summaries").set(as(token));

    expect(res.body.summaries[0].stats.totalExpense).toBe(100);
  });

  it("removes a week's recap once all of its entries are deleted", async () => {
    const { _id, token } = await createUser();
    const entry = await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("Recap."));
    await request(app).get("/api/summaries").set(as(token));

    await ExpenseModel.deleteOne({ _id: entry._id });
    const res = await request(app).get("/api/summaries").set(as(token));

    expect(res.body.summaries).toHaveLength(0);
  });

  it("caches each language separately instead of regenerating on every switch", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("Recap."));

    await request(app).get("/api/summaries?lang=en").set(as(token));
    await request(app).get("/api/summaries?lang=es").set(as(token));
    await request(app).get("/api/summaries?lang=en").set(as(token));

    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("converts every amount to the requested currency before totaling", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1, { amount: 10, currency: "EUR" });
    await addExpense(_id, 1, { amount: 10, currency: "USD" });
    createMock.mockResolvedValue(aiReply("Recap."));

    const res = await request(app).get("/api/summaries?currency=USD").set(as(token));

    expect(ratesMock).toHaveBeenCalledWith("USD");
    expect(res.body.summaries[0]).toMatchObject({ currency: "USD", converted: true });
    expect(res.body.summaries[0].stats.totalExpense).toBe(30); // 10 EUR at 0.5 EUR/USD + 10 USD
  });

  it("flags summaries whose amounts couldn't be converted", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1, { amount: 10, currency: "EUR" });
    await addExpense(_id, 1, { amount: 10, currency: "USD" });
    ratesMock.mockResolvedValue({ rates: { USD: 1, EUR: 1 }, live: false });
    createMock.mockResolvedValue(aiReply("Recap."));

    const res = await request(app).get("/api/summaries?currency=USD").set(as(token));

    expect(res.body.summaries[0]).toMatchObject({ converted: false });
    expect(res.body.summaries[0].stats.totalExpense).toBe(20);
  });

  it("ignores an invalid currency and uses USD", async () => {
    const { _id, token } = await createUser();
    await addExpense(_id, 1);
    createMock.mockResolvedValue(aiReply("Recap."));

    const res = await request(app).get("/api/summaries?currency=not-a-code").set(as(token));

    expect(res.body.summaries[0].currency).toBe("USD");
  });
});

describe("GET /api/summaries for Hubs", () => {
  async function hubWithMembers() {
    const owner = await createUser();
    const member = await createUser();
    const space = await SpaceModel.create({
      name: "Home",
      ownerId: owner._id,
      members: [
        { userId: owner._id, nickname: "Sam", role: "owner", status: "active" },
        { userId: member._id, nickname: "Alex", role: "member", status: "active" },
      ],
    });
    const model = getSpaceExpenseModel(space._id.toString());
    const date = new Date(`${weekStart(1)}T12:00:00.000Z`);
    await model.create({ authorUserId: owner._id, type: "expense", amount: 60, category: "Housing", date });
    await model.create({ authorUserId: member._id, type: "expense", amount: 40, category: "Food & Dining", date });
    return { owner, member, spaceId: space._id.toString() };
  }

  it("summarizes the Hub's own ledger with a per-member breakdown", async () => {
    const { member, spaceId } = await hubWithMembers();
    createMock.mockResolvedValue(aiReply("Hub recap."));

    const res = await request(app).get(`/api/summaries?spaceId=${spaceId}`).set(as(member.token));

    expect(res.status).toBe(200);
    expect(res.body.summaries).toHaveLength(1);
    expect(res.body.summaries[0].stats.totalExpense).toBe(100);
    expect(res.body.summaries[0].stats.byMember).toEqual([
      { name: "Sam", income: 0, expense: 60 },
      { name: "Alex", income: 0, expense: 40 },
    ]);
    const prompt = createMock.mock.calls[0][0].messages[0].content as string;
    expect(prompt).toMatch(/shared household ledger \("Home"\)/);
  });

  it("shares one cached Hub summary between its members", async () => {
    const { owner, member, spaceId } = await hubWithMembers();
    createMock.mockResolvedValue(aiReply("Hub recap."));

    await request(app).get(`/api/summaries?spaceId=${spaceId}`).set(as(owner.token));
    await request(app).get(`/api/summaries?spaceId=${spaceId}`).set(as(member.token));

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("keeps Hub entries out of the personal summary", async () => {
    const { owner } = await hubWithMembers();
    createMock.mockResolvedValue(aiReply("Recap."));

    const res = await request(app).get("/api/summaries").set(as(owner.token));

    expect(res.body.summaries).toHaveLength(0);
  });

  it("rejects non-members and invalid Hub ids", async () => {
    const { spaceId } = await hubWithMembers();
    const outsider = await createUser();

    const forbidden = await request(app).get(`/api/summaries?spaceId=${spaceId}`).set(as(outsider.token));
    const invalid = await request(app).get("/api/summaries?spaceId=nope").set(as(outsider.token));

    expect(forbidden.status).toBe(403);
    expect(invalid.status).toBe(400);
  });
});

describe("GET /api/summaries legacy history", () => {
  it("still lists pre-cache personal summaries older than the regeneration window", async () => {
    const { _id, token } = await createUser();
    await SummaryModel.create({
      userId: _id,
      weekStartDate: weekStart(30),
      weekEndDate: weekStart(30),
      timezone: "UTC",
      narrative: "An old recap.",
      stats: { totalIncome: 0, totalExpense: 5, net: -5, transactionCount: 1, byCategory: [] },
    });
    await SummaryModel.create({
      userId: _id,
      weekStartDate: weekStart(1),
      weekEndDate: weekStart(1),
      timezone: "UTC",
      narrative: "Superseded recap.",
      stats: { totalIncome: 0, totalExpense: 5, net: -5, transactionCount: 1, byCategory: [] },
    });

    const res = await request(app).get("/api/summaries").set(as(token));

    expect(res.body.summaries).toHaveLength(1);
    expect(res.body.summaries[0]).toMatchObject({ narrative: "An old recap.", legacy: true });
  });
});

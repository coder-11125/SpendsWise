import { beforeEach, describe, expect, it } from "vitest";
import { getLatestSummary, hasUnseenSummary, markSummarySeen, setEmail, setLatestSummary } from "./state.svelte.js";
import { formatWeekRange } from "./utils.js";
import type { LatestSummary } from "../types.js";

function summary(weekStartDate: string, weekEndDate: string, spaceId: string | null = null): LatestSummary {
  return {
    spaceId,
    ledgerName: spaceId ? "Home" : null,
    summary: {
      weekStartDate,
      weekEndDate,
      narrative: "",
      currency: "USD",
      lang: "en",
      aiGenerated: true,
      converted: true,
      stats: { totalIncome: 0, totalExpense: 0, net: 0, transactionCount: 3, byCategory: [], previousWeekExpense: null },
    },
  };
}

describe("weekly summary notifications", () => {
  beforeEach(() => {
    localStorage.clear();
    setEmail("sam@example.com");
    setLatestSummary(null);
  });

  it("has nothing to show without a summary", () => {
    expect(getLatestSummary()).toBeNull();
    expect(hasUnseenSummary()).toBe(false);
  });

  it("flags a new summary until it is marked seen", () => {
    setLatestSummary(summary("2026-10-05", "2026-10-11"));
    expect(hasUnseenSummary()).toBe(true);
    markSummarySeen();
    expect(hasUnseenSummary()).toBe(false);
  });

  it("remembers the seen week across reloads of the summary", () => {
    setLatestSummary(summary("2026-10-05", "2026-10-11"));
    markSummarySeen();
    setLatestSummary(summary("2026-10-05", "2026-10-11"));
    expect(hasUnseenSummary()).toBe(false);
  });

  it("flags the next week's summary again", () => {
    setLatestSummary(summary("2026-10-05", "2026-10-11"));
    markSummarySeen();
    setLatestSummary(summary("2026-10-12", "2026-10-18"));
    expect(hasUnseenSummary()).toBe(true);
  });

  it("treats a week as seen whichever ledger it was viewed in", () => {
    setLatestSummary(summary("2026-10-05", "2026-10-11", "hub-1"));
    markSummarySeen();
    setLatestSummary(summary("2026-10-05", "2026-10-11"));
    expect(hasUnseenSummary()).toBe(false);
  });

  it("tracks seen state per account on the same device", () => {
    setLatestSummary(summary("2026-10-05", "2026-10-11"));
    markSummarySeen();
    setEmail("alex@example.com");
    setLatestSummary(summary("2026-10-05", "2026-10-11"));
    expect(hasUnseenSummary()).toBe(true);
  });
});

describe("formatWeekRange", () => {
  it("formats a Monday..Sunday week with the year on the end date", () => {
    const out = formatWeekRange("2026-10-05", "2026-10-11");
    expect(out).toContain("5");
    expect(out).toContain("11");
    expect(out).toContain("2026");
    expect(out).toContain("–");
  });
});

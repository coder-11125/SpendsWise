import { beforeEach, describe, expect, it } from "vitest";
import { getLatestSummary, hasUnseenSummary, markSummarySeen, setEmail, setLatestSummary } from "./state.svelte.js";
import { formatWeekRange } from "./utils.js";
import type { WeeklySummary } from "../types.js";

function summary(weekStartDate: string, weekEndDate: string): WeeklySummary {
  return {
    weekStartDate,
    weekEndDate,
    narrative: "",
    stats: { totalIncome: 0, totalExpense: 0, net: 0, transactionCount: 3, byCategory: [], previousWeekExpense: null },
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

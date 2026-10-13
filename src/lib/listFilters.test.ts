import { describe, expect, it } from "vitest";
import { applyListFilters, countActiveFilters, defaultListFilters, type ListFilters } from "./listFilters.js";
import type { Expense } from "../types.js";

function item(overrides: Partial<Expense> & Pick<Expense, "id" | "amount" | "date">): Expense {
  const base: Expense = {
    id: "x",
    type: "income",
    amount: 0,
    category: "Salary",
    date: "2026-01-01",
    currency: "USD",
  };
  return { ...base, ...overrides };
}

const items: Expense[] = [
  item({ id: "a", amount: 100, date: "2026-01-05", category: "Salary", name: "January pay" }),
  item({ id: "b", amount: 40, date: "2026-02-10", category: "Freelance", note: "logo design", authorNickname: "Alice" }),
  item({ id: "c", amount: 250, date: "2026-03-01", category: "Salary", authorNickname: "Bob", recurrence: { frequency: "monthly", nextDueDate: "2026-04-01", isActive: true } }),
  item({ id: "d", amount: 15, date: "2026-03-20", category: "Gifts", familyMember: "Mom" }),
];

function filtered(overrides: Partial<ListFilters>): string[] {
  return applyListFilters(items, { ...defaultListFilters(), ...overrides }).map((i) => i.id);
}

describe("applyListFilters", () => {
  it("sorts newest first by default", () => {
    expect(filtered({})).toEqual(["d", "c", "b", "a"]);
  });

  it("sorts by amount in either direction", () => {
    expect(filtered({ sortBy: "amount", sortDir: "desc" })).toEqual(["c", "a", "b", "d"]);
    expect(filtered({ sortBy: "amount", sortDir: "asc" })).toEqual(["d", "b", "a", "c"]);
  });

  it("does not mutate the source array", () => {
    const copy = [...items];
    applyListFilters(items, { ...defaultListFilters(), sortBy: "amount" });
    expect(items).toEqual(copy);
  });

  it("searches across category, name, note, family member and contributor", () => {
    expect(filtered({ search: "freelance" })).toEqual(["b"]);
    expect(filtered({ search: "january" })).toEqual(["a"]);
    expect(filtered({ search: "logo" })).toEqual(["b"]);
    expect(filtered({ search: "mom" })).toEqual(["d"]);
    expect(filtered({ search: "bob" })).toEqual(["c"]);
    expect(filtered({ search: "   " })).toHaveLength(4);
  });

  it("filters by inclusive date range", () => {
    expect(filtered({ dateFrom: "2026-02-10", dateTo: "2026-03-01" })).toEqual(["c", "b"]);
  });

  it("filters by inclusive amount range", () => {
    expect(filtered({ amountMin: "40", amountMax: "100" })).toEqual(["b", "a"]);
    expect(filtered({ amountMin: "not-a-number" })).toHaveLength(4);
  });

  it("filters by category and by contributor", () => {
    expect(filtered({ categories: ["Salary"] })).toEqual(["c", "a"]);
    expect(filtered({ contributors: ["Alice", "Mom"] })).toEqual(["d", "b"]);
  });

  it("keeps only recurring entries when asked", () => {
    expect(filtered({ recurringOnly: true })).toEqual(["c"]);
  });

  it("combines filters", () => {
    expect(filtered({ categories: ["Salary"], amountMin: "200" })).toEqual(["c"]);
  });
});

describe("countActiveFilters", () => {
  it("is zero for the defaults, ignoring search and sort", () => {
    expect(countActiveFilters(defaultListFilters())).toBe(0);
    expect(countActiveFilters({ ...defaultListFilters(), search: "x", sortBy: "amount", sortDir: "asc" })).toBe(0);
  });

  it("counts each narrowing filter once", () => {
    expect(
      countActiveFilters({
        ...defaultListFilters(),
        dateFrom: "2026-01-01",
        amountMax: "10",
        categories: ["A", "B"],
        recurringOnly: true,
      })
    ).toBe(4);
  });
});

export interface Recurrence {
  frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'yearly';
  nextDueDate: string;
  endDate?: string | null;
  isActive: boolean;
}

export interface Expense {
  id: string;
  type: 'income' | 'expense';
  amount: number;
  category: string;
  date: string;
  familyMember?: string;
  name?: string;
  note?: string;
  currency: string;
  recurrence?: Recurrence | null;
  authorUserId?: string;
  authorNickname?: string;
}

export interface Profile {
  email: string;
  createdAt?: string;
}

export interface SpaceMember {
  userId: string;
  nickname: string;
  role: 'owner' | 'member';
  status: 'pending' | 'active';
}

export interface Space {
  id: string;
  name: string;
  ownerId: string;
  members: SpaceMember[];
}

export interface CurrencyRates {
  [base: string]: {
    [target: string]: number;
  };
}

export interface Summary {
  income: number;
  expenses: number;
  balance: number;
}

export interface IncomeSummary {
  total: number;
  count: number;
  average: number;
}

export interface ExpenseSummary {
  total: number;
  count: number;
  average: number;
}

export interface CategoryData {
  category: string;
  amount: number;
  percentage: number;
}

export interface TrendPoint {
  key: string;
  label: string;
  amount: number;
}

export interface TrendData {
  points: TrendPoint[];
  total: number;
  average: number;
  periodLabel: string;
  isEmpty?: boolean;
}

export interface WeeklySummaryCategory {
  category: string;
  amount: number;
  count: number;
}

export interface WeeklySummaryMember {
  name: string;
  income: number;
  expense: number;
}

export interface WeeklySummary {
  weekStartDate: string;
  weekEndDate: string;
  narrative: string;
  currency: string | null;     // amounts' currency; null for legacy recaps
  lang: string | null;
  aiGenerated: boolean;        // false = plain-numbers narrative, AI write-up retried later
  converted: boolean;          // false = some amounts couldn't be converted (no live rates)
  legacy?: boolean;            // recap from before per-ledger caching
  stats: {
    totalIncome: number;
    totalExpense: number;
    net: number;
    transactionCount: number;
    byCategory: WeeklySummaryCategory[];
    byMember?: WeeklySummaryMember[];  // Hub ledgers only
    previousWeekExpense: number | null;
  };
}

/** The newest summary across the user's ledgers, surfaced in Header notifications. */
export interface LatestSummary {
  summary: WeeklySummary;
  spaceId: string | null;      // null = personal ledger
  ledgerName: string | null;   // Hub name, null for personal
}

import { Schema, model, Types, InferSchemaType } from "mongoose";

const categoryBreakdownSchema = new Schema(
  {
    category: { type: String, required: true },
    amount: { type: Number, required: true },
    count: { type: Number, required: true },
  },
  { _id: false }
);

const memberBreakdownSchema = new Schema(
  {
    name: { type: String, required: true },
    income: { type: Number, required: true },
    expense: { type: Number, required: true },
  },
  { _id: false }
);

// One cached recap per ledger, week, language and display currency. A ledger
// ("scope") is either a user's personal ledger ("user:<id>") or a Hub
// ("space:<id>", shared by its members). The narrative is regenerated when
// sourceFingerprint no longer matches the week's data, and AI write-ups that
// fell back to plain numbers (aiGenerated: false) are retried after a cooldown.
const weeklySummarySchema = new Schema(
  {
    scopeKey: { type: String, required: true },
    // Monday..Sunday of the summarized week, YYYY-MM-DD calendar dates.
    weekStartDate: { type: String, required: true },
    weekEndDate: { type: String, required: true },
    lang: { type: String, required: true },
    currency: { type: String, required: true },
    timezone: { type: String, required: true },
    narrative: { type: String, required: true },
    aiGenerated: { type: Boolean, required: true },
    // False when some amounts couldn't be converted to `currency` (no live rates).
    converted: { type: Boolean, required: true },
    sourceFingerprint: { type: String, required: true },
    stats: {
      totalIncome: { type: Number, required: true },
      totalExpense: { type: Number, required: true },
      net: { type: Number, required: true },
      transactionCount: { type: Number, required: true },
      byCategory: { type: [categoryBreakdownSchema], default: [] },
      byMember: { type: [memberBreakdownSchema], default: [] },
      previousWeekExpense: { type: Number, default: null },
    },
  },
  { timestamps: true }
);

weeklySummarySchema.index({ scopeKey: 1, lang: 1, currency: 1, weekStartDate: 1 }, { unique: true });

export type WeeklySummary = InferSchemaType<typeof weeklySummarySchema> & { _id: Types.ObjectId };
// Stored in its own collection: the legacy `summaries` collection (models/Summary.ts)
// has a (userId, weekStartDate) unique index that can't hold per-language/currency copies.
export const WeeklySummaryModel = model("WeeklySummary", weeklySummarySchema, "weekly_summaries");

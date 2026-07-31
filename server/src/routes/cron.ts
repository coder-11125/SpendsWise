import { Router } from "express";
import { config } from "../config.js";
import { processRecurringTransactions } from "../lib/recurringScheduler.js";
import { asyncHandler } from "../middleware/asyncHandler.js";

/**
 * Protected endpoints invoked by schedulers (Vercel cron, GitHub Actions
 * workflow) — never by browser clients.
 *
 * Vercel automatically sends the CRON_SECRET env value as an Authorization
 * header on cron invocations; the GitHub Actions workflow sends the same
 * secret explicitly. The endpoint is a GET so the CSRF middleware (which only
 * guards state-changing requests) never touches it, and its only side effect
 * is the idempotent, atomically-claimed recurring scan.
 */
const router = Router();

router.get(
  "/recurring",
  (req, res, next) => {
    const auth = req.headers.authorization ?? "";
    if (!config.cronSecret || auth !== `Bearer ${config.cronSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  },
  asyncHandler(async (_req, res) => {
    await processRecurringTransactions();
    res.json({ ok: true });
  })
);

export default router;

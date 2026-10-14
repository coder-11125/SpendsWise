import express from "express";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { authRequired } from "../middleware/auth.js";
import { fetchCurrencyRates, rateCache } from "../lib/currencyRates.js";

const router = express.Router();
router.use(authRequired);

/**
 * GET /api/currency/rates
 * Returns conversion rates from base currency (default: USD)
 */
router.get(
  "/rates",
  asyncHandler(async (req, res) => {
    const baseCurrency = ((req.query.base as string) || "USD").toUpperCase();
    if (!/^[A-Z]{3}$/.test(baseCurrency)) {
      return res.status(400).json({ error: "base must be a 3-letter ISO 4217 currency code" });
    }
    const { rates, live } = await fetchCurrencyRates(baseCurrency);

    res.json({
      base: baseCurrency,
      rates,
      cached: !!rateCache[baseCurrency],
      live,
    });
  })
);

/**
 * GET /api/currency/convert
 * Convert amount from one currency to another
 */
router.get(
  "/convert",
  asyncHandler(async (req, res) => {
    const fromCurrency = (req.query.from as string) || "USD";
    const toCurrency = (req.query.to as string) || "USD";
    const amount = parseFloat(req.query.amount as string) || 0;

    if (fromCurrency === toCurrency) {
      return res.json({
        from: fromCurrency,
        to: toCurrency,
        amount,
        convertedAmount: amount,
        rate: 1,
        live: true,
      });
    }

    const { rates, live } = await fetchCurrencyRates(fromCurrency);
    const rate = rates[toCurrency];

    if (rate === undefined) {
      return res.status(400).json({
        error: `Cannot convert from ${fromCurrency} to ${toCurrency} - unsupported currency`,
      });
    }

    const convertedAmount = amount * rate;

    res.json({
      from: fromCurrency,
      to: toCurrency,
      amount,
      convertedAmount,
      rate,
      live,
    });
  })
);

export default router;

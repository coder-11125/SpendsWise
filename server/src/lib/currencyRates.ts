// Exchange-rate fetching with a 1-hour in-memory cache, shared by the
// currency routes and weekly-summary currency conversion.

// Simple in-memory cache for currency rates (1 hour expiry)
export const rateCache: {
  [key: string]: {
    rates: Record<string, number>;
    timestamp: number;
    baseCurrency: string;
    // C11: whether `rates` came from the real exchangerate-api response, or
    // the hardcoded 1:1 fallback. Callers must not treat these the same —
    // a 1:1 "rate" is not a conversion, it's a placeholder.
    live: boolean;
  };
} = {};

const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

/**
 * Fetch currency conversion rates from a free API
 * Using exchangerate-api.com as a free service
 */
// Track API call count for rate limiting awareness
let apiCallCount = 0;
const API_LIMIT_WARNING = 1000; // Warn when approaching free tier limit

export async function fetchCurrencyRates(baseCurrency: string = "USD"): Promise<{ rates: Record<string, number>; live: boolean }> {
  const cacheKey = baseCurrency;

  // Return cached rates if available and not expired
  if (rateCache[cacheKey] && Date.now() - rateCache[cacheKey].timestamp < CACHE_DURATION) {
    return { rates: rateCache[cacheKey].rates, live: rateCache[cacheKey].live };
  }

  try {
    // Use a free currency API
    const apiKey = process.env.CURRENCY_API_KEY;
    if (!apiKey) {
      console.warn("[CURRENCY] CURRENCY_API_KEY not set, skipping external fetch — see server/.env.example");
      throw new Error("Currency API key not configured");
    }
    apiCallCount++;

    // Warn if approaching rate limit
    if (apiCallCount % API_LIMIT_WARNING === 0) {
      console.warn(`[CURRENCY] Approaching API rate limit: ${apiCallCount} calls made`);
    }

    const response = await fetch(
      `https://v6.exchangerate-api.com/v6/${apiKey}/latest/${baseCurrency}`
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      if (response.status === 429 || response.status === 403) {
        console.error(`[CURRENCY] Rate limit exceeded or forbidden: ${response.status}`);
        throw new Error("Currency API rate limit exceeded");
      }
      throw new Error(`Currency API returned status ${response.status}: ${errorData["error-type"] || "Unknown error"}`);
    }

    const data = await response.json();

    if (data.result !== "success") {
      // Handle specific error types
      if (data["error-type"] === "quota-exceeded") {
        console.error("[CURRENCY] Monthly API quota exceeded");
        throw new Error("Currency API monthly quota exceeded");
      }
      throw new Error(data["error-type"] || "Unknown currency API error");
    }

    // Cache the rates
    rateCache[cacheKey] = {
      rates: data.conversion_rates,
      timestamp: Date.now(),
      baseCurrency,
      live: true,
    };

    console.log(`[CURRENCY] Fetched rates for ${baseCurrency}, cache expires at ${new Date(Date.now() + CACHE_DURATION).toISOString()}`);
    return { rates: data.conversion_rates, live: true };
  } catch (error) {
    console.error("Failed to fetch currency rates:", error);

    // Final fallback: 1:1 rates for a small set of known currencies. This is
    // NOT a real conversion — callers must surface `live: false` to the user
    // rather than silently presenting these numbers as converted amounts.
    const fallbackRates: Record<string, number> = {};
    const commonCurrencies = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "CNY", "INR", "MXN", "BRL", "RUB"];
    commonCurrencies.forEach((currency) => {
      fallbackRates[currency] = 1;
    });

    console.warn("[CURRENCY] Using fallback 1:1 rates due to API failure — conversions will be inaccurate until CURRENCY_API_KEY is set");
    rateCache[cacheKey] = { rates: fallbackRates, timestamp: Date.now(), baseCurrency, live: false };
    return { rates: fallbackRates, live: false };
  }
}

import { resolve } from "node:path";

// Runs before any test module is evaluated (per worker). src/config.ts reads
// environment variables at import time, so these must be set before the first
// route/model import. The in-memory MongoDB URI is injected by the per-file
// startTestDb() helper before any app-level module that depends on it loads.
process.env.NODE_ENV = "test";
// Placeholder only, so src/config.ts can load before the in-memory server is
// started. Non-app test files never connect through config (they use the memory
// server directly). Port 1 fails fast (ECONNREFUSED) instead of hanging if any
// test ever accidentally routes DB traffic through config.mongoUri.
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:1/spendswise-test";
process.env.JWT_SECRET ??= "test-only-jwt-secret-0123456789abcdef";
process.env.CSRF_SECRET ??= "test-only-csrf-secret-0123456789abcdef";
process.env.FRONTEND_URL ??= "http://localhost:5173";

// Pin MongoDB 6.0 for the in-memory server: 7.x x64 binaries require AVX2 and
// SIGABRT on older CPUs (e.g. the Intel i5-6360U this project is developed on).
process.env.MONGOMS_VERSION ??= "6.0.19";
process.env.MONGOMS_DOWNLOAD_DIR ??= resolve(import.meta.dirname, "..", ".mongodb-binaries");

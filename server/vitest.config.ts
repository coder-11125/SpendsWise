import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    // Run test files sequentially in one worker so the in-memory MongoDB
    // singleton is started/stopped exactly once per file without spawning
    // multiple mongod processes. The suite is small enough that serial
    // execution stays fast.
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});

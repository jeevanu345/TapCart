import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/**/*.test.ts", "research/**/*.test.ts", "client/src/**/*.test.{ts,tsx}"],
    environment: "node",
    env: { NODE_ENV: "test" },
    testTimeout: 20000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
});

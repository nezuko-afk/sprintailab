import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only our tests. Never run the vendored REA suite in upstream/.
    include: ["src/**/*.test.ts"],
    exclude: ["upstream/**", "node_modules/**", "dist/**"],
    testTimeout: 15000,
  },
});

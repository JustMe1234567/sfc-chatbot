import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "src");

export default defineConfig({
  resolve: {
    alias: { "@": srcDir },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: "tests/global-setup.ts",
    setupFiles: ["tests/setup-auth.ts"],
    // Provisioning-heavy beforeAll hooks (service init, staff fixtures, TOTP
    // enrollment) legitimately exceed vitest's 10s default when this machine
    // is busy, and the API-flow tests drive many authenticated round trips
    // per test. Both budgets stay generous; parallelism, not the app, is the
    // variable.
    hookTimeout: 60_000,
    testTimeout: 20_000,
  },
});

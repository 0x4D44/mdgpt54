import { defineConfig } from "vitest/config";

// Unit tests only. Playwright e2e specs (e2e/**/*.spec.ts) are run separately via
// `npm run test:e2e`; vitest's default glob would otherwise pick them up and fail to
// load them (`test.describe() ... not expected here`), turning `npm run check` red.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages/demo/e2e",
  testMatch: ["**/*.spec.js"],
  timeout: 30_000,
  use: {
    headless: true
  }
});

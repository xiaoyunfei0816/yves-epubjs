import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./packages",
  timeout: 30_000,
  use: {
    headless: true
  }
});

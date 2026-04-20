import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@pretext-epub/core": fileURLToPath(new URL("../core/src/index.ts", import.meta.url))
    }
  }
});

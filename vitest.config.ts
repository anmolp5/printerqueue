import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/lib/__tests__/**/*.test.ts"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

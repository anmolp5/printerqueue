import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    watch: {
      ignored: ["**/.next/**", "**/out/**", "**/node_modules/**"],
    },
  },
  test: {
    fileParallelism: false,
    isolate: false,
    exclude: ["**/node_modules/**", "**/.next/**", "**/out/**"],
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/lib/__tests__/**/*.test.ts"],
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    /*
     * 15s, not the 5s default.
     *
     * Six render tests in `notes.test.tsx` timed out in a full run and every
     * one passed on its own — a different six the next run. The suite spends
     * ~220s in environment setup across 41 files, so on a loaded machine a
     * render that normally takes a moment can miss a 5s budget while a
     * `waitFor` inside it is already spending 3s of that.
     *
     * A gate that fails randomly is worse than a slow one: it teaches people
     * to re-run until green, which is how a real failure gets waved through.
     * Raised rather than the assertions loosened, so a genuine hang still
     * fails — just not a busy laptop.
     */
    testTimeout: 15_000,
    setupFiles: ["./src/test/setup.ts"],
    server: {
      deps: {
        inline: ["@exodus/bytes"],
      },
    },
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: [
      "node_modules/**",
      "dist/**",
      "e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "src/services/**/*.{ts,tsx}",
        "src/hooks/**/*.{ts,tsx}",
        "src/lib/**/*.{ts,tsx}",
        "src/features/**/*.{ts,tsx}",
        "src/pages/**/*.{ts,tsx}",
      ],
      exclude: [
        "src/components/ui/**",          // shadcn primitives
        "src/integrations/supabase/types.ts",
        "**/*.d.ts",
        "**/*.test.{ts,tsx}",
        "**/*.spec.{ts,tsx}",
        "src/test/**",
      ],
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

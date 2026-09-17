import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    /*
     * Raised from the 5000ms default because the suite outgrew it.
     *
     * The v4 namespace took the suite from 90 files / 634 tests to 125 / 950,
     * and wall-clock from ~91s to ~326s. Past that point sixteen tests failed
     * in a full run while passing in isolation — `StudentDashboard.test.tsx`
     * timed out at 5000ms in the suite and finished in 417ms alone. Nothing
     * was wrong with them; they were starved of CPU by their neighbours, and a
     * `waitFor` cannot tell contention from a hang.
     *
     * This matters in CI, not just locally: the frontend job runs
     * `npx vitest run --coverage`, and v8 coverage instrumentation makes every
     * test slower than the run that already failed here. Left alone, a PR from
     * this branch would go red for a reason unrelated to the code in it — the
     * worst kind of red, because it teaches people to ignore CI.
     *
     * A timeout is a guard against a hang, not a performance budget. 20s is
     * still far below any real deadlock and well above the slowest honest test.
     */
    testTimeout: 20000,
    hookTimeout: 20000,
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

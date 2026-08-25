import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    globals: true,
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
      // Per-directory aggregate thresholds from TESTING_STRATEGY.md section 7
      // (`src/pages/**` is documented as "smoke only" with no numeric target,
      // so it is intentionally left out here). All three now use the
      // documented targets directly — services was briefly ratcheted down
      // to 60%/55% (statements measured 61.11% against a 65% target at the
      // time) until tests were added for its lowest-covered files
      // (adminService, searchService, courseBlueprintService,
      // uploadBatchService, reviewService); it now measures 69.78%/78.09%,
      // comfortably clearing the documented target.
      thresholds: {
        "src/services/**": { statements: 65, branches: 55 },
        "src/hooks/**": { statements: 60, branches: 50 },
        "src/lib/**": { statements: 70, branches: 60 },
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});

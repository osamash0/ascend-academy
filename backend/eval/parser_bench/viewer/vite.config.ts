/*
 * The Parser Bench viewer: its own Vite build, separate from the app's, so it ships nothing of the
 * product but the reading face's renderer (`@/components/markdown` → Prose), which it imports so
 * outputs render exactly as learners would see them.
 *
 *   build:  npx vite build --config backend/eval/parser_bench/viewer/vite.config.ts
 *   test:   npx vitest run --config backend/eval/parser_bench/viewer/vite.config.ts
 *
 * The built files (viewer/dist, git-ignored) are served by `python -m backend.eval.parser_bench serve`.
 */
import path from "path";
import react from "@vitejs/plugin-react-swc";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vitest/config";

const here = __dirname;
const repo = path.resolve(here, "../../../..");

export default defineConfig({
  root: here,
  base: "/",
  cacheDir: path.join(repo, "node_modules/.vite-parser-bench"),
  plugins: [react()],
  resolve: {
    alias: { "@": path.join(repo, "src") },
    dedupe: ["react", "react-dom"],
  },
  css: {
    postcss: { plugins: [tailwindcss({ config: path.join(here, "tailwind.config.ts") }), autoprefixer()] },
  },
  build: { outDir: path.join(here, "dist"), emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    port: 5207,
    strictPort: true,
    proxy: { "/api": { target: "http://127.0.0.1:8766" } },
  },
  test: {
    root: here,
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
  },
});

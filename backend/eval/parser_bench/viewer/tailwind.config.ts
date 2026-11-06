/*
 * Only Prose (the reading face's renderer) and this viewer are scanned; the app's own theme is
 * the preset, so Prose's classes compile exactly as they do in the app.
 */
import path from "path";
import type { Config } from "tailwindcss";
import app from "../../../../tailwind.config";

const repo = path.resolve(__dirname, "../../../..");

export default {
  presets: [app],
  content: [
    path.join(__dirname, "index.html"),
    path.join(__dirname, "src/**/*.{ts,tsx}"),
    path.join(repo, "src/components/markdown/**/*.{ts,tsx}"),
  ],
} satisfies Config;

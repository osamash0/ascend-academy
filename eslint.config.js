import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".local/**",
      "node_modules/**",
      "coverage/**",
      "mineru-env/**",
      "stop-slop-main/**",
      "Document-Insight-Engine/**",
      "litellm/**",
      "pdf_testset/**",
      "scratch/**",
      ".agent_scratch/**",
      "GPU-Server/**",
      "test-results/**",
      ".venv/**",
      "venv/**",
      ".claude/**"
    ]
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      // Existing application and test code has a large `any` baseline. Keep
      // it visible in CI while migrations happen incrementally; other lint
      // errors remain blocking.
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);

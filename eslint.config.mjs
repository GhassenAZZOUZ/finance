import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The engine must stay pure: no framework, no I/O, no clock, no randomness (docs/SPEC.md).
    files: ["lib/engine/**/*.ts"],
    ignores: ["lib/engine/**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ regex: "^(?!\\.{1,2}/)", message: "lib/engine may only import its own modules." }] },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Use YearMonth strings; the caller provides the current month." },
        { name: "fetch", message: "The engine does no I/O." },
        { name: "process", message: "The engine does not read the environment." },
      ],
      "no-restricted-properties": ["error", { object: "Math", property: "random", message: "The engine is deterministic." }],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "scripts/**"]),
]);

export default eslintConfig;

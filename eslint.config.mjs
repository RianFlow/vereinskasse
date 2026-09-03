import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "backoffice/dist/**",
    "tmp/**",
    "output/**",
    "next-env.d.ts",
  ]),
  { files: ["backoffice/**/*.jsx"], rules: { "@next/next/no-img-element": "off", "@next/next/no-html-link-for-pages": "off" } },
]);

export default eslintConfig;

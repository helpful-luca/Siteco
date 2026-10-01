import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Architecture boundaries: features are used only through their index.ts, and shared/ never
// depends on features or routes.
const deepFeatureImport = {
  group: ['@/features/*/*'],
  message: 'Import a feature through its index.ts (@/features/<name>).',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: [deepFeatureImport] }] },
  },
  {
    files: ['src/shared/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/features/*', '@/app/*'], message: 'shared/ must not depend on features or routes.' },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // PDF.js runtime files copied from pdfjs-dist (scripts/copy-pdfjs-assets.mjs).
    "public/pdfjs/**",
  ]),
]);

export default eslintConfig;

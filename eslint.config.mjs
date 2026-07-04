// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Root flat ESLint config for the monorepo.
 *
 * Applied to packages/workspaces that opt in by running `eslint .` from their
 * own directory (e.g. apps/workers, packages/shared). ESLint 9 walks up the
 * directory tree to discover this config, so no per-package config is needed.
 *
 * apps/web is NOT covered here — it keeps its own `next lint` (eslint-config-next).
 *
 * Deliberately uses the NON type-checked recommended preset to keep CI fast:
 * no per-file TypeScript program is spun up. Type errors are caught separately
 * by `turbo run check-types` (tsc --noEmit).
 */
export default tseslint.config(
  // Global ignores — must be its own object with only `ignores` to apply repo-wide.
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/build/**',
      '**/out/**',
      '**/generated/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.cjs',
      '**/*.config.ts',
      // apps/web lints through Next's toolchain (eslint-config-next provides
      // the react/react-hooks/next plugins this config doesn't). Without this
      // ignore, `next build`'s lint step resolves THIS config for web files
      // and fails on rules the Next plugins are supposed to own.
      'apps/web/**',
    ],
  },

  // Base JS recommended rules.
  js.configs.recommended,

  // TypeScript recommended rules (non type-checked flavour).
  ...tseslint.configs.recommended,

  // Repo-wide rule overrides.
  {
    rules: {
      // Workers and scripts log to stdout by design; surface console use as a
      // warning (visible, non-blocking) rather than banning it outright.
      'no-console': 'warn',
      // First adoption of lint on an existing codebase: the pre-existing `any`
      // usages are tracked as warnings so CI stays green while the debt is
      // visible. Tighten to 'error' once the backlog is burned down.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
);

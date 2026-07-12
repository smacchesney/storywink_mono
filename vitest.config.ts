import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve @storywink/shared/* subpath imports to the package SOURCE (src/*)
// rather than the built dist/*. This keeps unit tests running against the
// current source without requiring a `packages/shared` rebuild first, and
// sidesteps ESM/.js-suffix resolution against the dist exports map.
const sharedSrc = (p: string) =>
  fileURLToPath(new URL(`./packages/shared/src/${p}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: '@storywink/shared/utils', replacement: sharedSrc('utils.ts') },
      { find: '@storywink/shared/collage', replacement: sharedSrc('collage.ts') },
      { find: '@storywink/shared/text-emphasis', replacement: sharedSrc('text-emphasis.ts') },
      { find: '@storywink/shared/schemas', replacement: sharedSrc('schemas.ts') },
      { find: '@storywink/shared/constants', replacement: sharedSrc('constants.ts') },
      { find: '@storywink/shared/types', replacement: sharedSrc('types.ts') },
      {
        find: '@storywink/shared/prompts/story-check',
        replacement: sharedSrc('prompts/story-check.ts'),
      },
      { find: '@storywink/shared/prompts/story', replacement: sharedSrc('prompts/story.ts') },
      {
        find: '@storywink/shared/prompts/illustration',
        replacement: sharedSrc('prompts/illustration.ts'),
      },
      { find: '@storywink/shared/prompts/styles', replacement: sharedSrc('prompts/styles.ts') },
      {
        find: '@storywink/shared/prompts/photo-analysis',
        replacement: sharedSrc('prompts/photo-analysis.ts'),
      },
      {
        find: '@storywink/shared/prompts/character-identity',
        replacement: sharedSrc('prompts/character-identity.ts'),
      },
      { find: '@storywink/shared/prompts', replacement: sharedSrc('prompts/index.ts') },
      { find: '@storywink/shared', replacement: sharedSrc('index.ts') },
    ],
  },
  test: {
    include: [
      'packages/shared/src/**/*.test.ts',
      'packages/pdf/src/**/*.test.ts',
      'apps/workers/src/**/*.test.ts',
      'apps/web/src/**/*.test.ts',
    ],
    environment: 'node',
  },
});

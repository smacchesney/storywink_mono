# Shared Package

Shared types, schemas, prompts, and utilities consumed by all apps. Builds to `dist/`.

## Critical: Import Pattern

Always import from `@storywink/shared`, never relative paths:

```typescript
import { BookStatus } from '@storywink/shared';
import { createBullMQConnection } from '@storywink/shared/redis';
import { STYLE_LIBRARY } from '@storywink/shared/prompts/styles';
```

## Available Exports

The `exports` map in `package.json` is the source of truth. Adding a new module? Add its subpath there and rebuild.

## Key Files

- `src/prompts/` — All AI prompt templates (story + illustration)
- `src/types.ts` — Shared TypeScript types
- `src/schemas.ts` — Zod validation schemas
- `src/utils.ts` — Utilities including `isTitlePage()`
- `src/redis.ts` — `createBullMQConnection()` factory
- `src/constants.ts` — Shared constants

## Rules

- After changes, the package must be rebuilt (`builds to dist/`) for consumers to pick up updates
- Never duplicate shared logic in app-level code — add it here instead

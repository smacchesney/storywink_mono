# Workers (BullMQ)

Background job processors for AI operations.

## Stack
- BullMQ workers with TypeScript
- GPT-5.1 for story generation
- Gemini 3 Pro Image for illustrations
- Redis via `createBullMQConnection()` from `@storywink/shared/redis`

## Key Directories
- `src/workers/` — Job processor implementations
- `src/utils/pdf/` — Server-side PDF generation (mirrored in web app)
- `src/lib/` — AI client wrappers and utilities

## PDF Generation
This app has PDF generators that mirror `apps/web/src/lib/pdf/`. Changes to PDF logic must be applied to BOTH locations.

## Patterns
- All AI operations are async — enqueued via the Express API, processed here
- Workers should be idempotent — a job may be retried on failure
- Use `@storywink/shared` for all shared types, schemas, and prompts

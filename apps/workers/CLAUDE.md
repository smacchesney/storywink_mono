# Workers (BullMQ)

Background job processors for AI operations.

## Stack
- BullMQ workers with TypeScript
- GPT-5.1 for story generation
- Gemini 3.1 Flash Image or OpenAI gpt-image-2 for illustrations (selected via `ILLUSTRATION_PROVIDER` env)
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

## Illustration Providers

The illustrator worker supports two image models, selected at startup by `ILLUSTRATION_PROVIDER`:

- `gemini` (default) — `gemini-3.1-flash-image-preview` via `@google/genai`. Requires `GOOGLE_API_KEY`.
- `openai` — `gpt-image-2` via `openai` SDK (`images.edit` endpoint). Requires `OPENAI_API_KEY`. Optional `OPENAI_IMAGE_QUALITY` (low/medium/high/auto, default high) and `OPENAI_THINKING` (true/false, default false).

Provider implementations live in `src/lib/illustrators/`. Each implements the `IllustrationProvider` interface. The worker calls `illustrator.generate()` — it does not know which provider is running.

Flipping the env var on Railway redeploys the workers service and takes effect immediately. Rollback is a single variable change.

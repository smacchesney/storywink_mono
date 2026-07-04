# Workers (BullMQ)

Background job processors for AI operations.

## Stack
- BullMQ workers with TypeScript
- `gpt-5.5` (OpenAI Responses API, override via `STORY_MODEL`) for story generation
- `gpt-5-mini` for character extraction and QC (illustration QC + story QC)
- Gemini 3.1 Flash Image or OpenAI gpt-image-2 for illustrations (selected via `ILLUSTRATION_PROVIDER` env)
- Redis via `createBullMQConnection()` from `@storywink/shared/redis`

## Key Directories
- `src/workers/` — Job processor implementations
- `src/lib/` — AI client wrappers and utilities

## PDF Generation
All PDF generation lives in the shared `packages/pdf` workspace (`@storywink/pdf`). This app supplies fonts via `src/utils/pdf-fonts.ts`; the print-fulfillment worker calls the package. The Lulu output path is production-verified — behavior changes there require a new proof print.

## Patterns
- All AI operations are async — enqueued by Next.js API routes in `apps/web`, processed here
- Workers should be idempotent — a job may be retried on failure
- Use `@storywink/shared` for all shared types, schemas, and prompts
- Auto-illustrate re-enters via the character-extraction worker, which builds the illustration FlowProducer flow (parent finalize + child illustration jobs). See `createIllustrationFlow` in `src/workers/character-extraction.worker.ts`.

## Illustration Providers

The illustrator worker supports two image models, selected at startup by `ILLUSTRATION_PROVIDER`:

- `gemini` (default) — `gemini-3.1-flash-image-preview` via `@google/genai`. Requires `GOOGLE_API_KEY`.
- `openai` — `gpt-image-2` via `openai` SDK (`images.edit` endpoint). Requires `OPENAI_API_KEY`. Optional `OPENAI_IMAGE_QUALITY` (low/medium/high/auto, default high) and `OPENAI_THINKING` (true/false, default false).

Provider implementations live in `src/lib/illustrators/`. Each implements the `IllustrationProvider` interface. The worker calls `illustrator.generate()` — it does not know which provider is running.

Flipping the env var on Railway redeploys the workers service and takes effect immediately. Rollback is a single variable change.

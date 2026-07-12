# Architecture Details

Detailed technical documentation for Storywink.ai systems.

## Services

- **`apps/web`** — Next.js 15 (App Router), port 3000. Serves the UI and every API route (book creation, Cloudinary/Clerk/Stripe webhooks, queue enqueue, PDF export).
- **`apps/workers`** — BullMQ job processors. All AI work runs here.
- **`packages/database`** — Prisma schema and generated client.
- **`packages/shared`** — Shared types, schemas, prompts, and Redis helpers (builds to `dist/`).

There is no separate Express service; the web app owns all HTTP endpoints.

## Data Flow

1. User uploads photos → direct browser-to-Cloudinary upload
2. Database records created via `/api/cloudinary/notify` endpoint
3. Book created with status `DRAFT`
4. Story generation job queued → `gpt-5.5` (OpenAI Responses API) analyzes images and writes the story
5. Book status updates to `GENERATING`
6. Story generation completes → status `STORY_READY`
7. Illustration jobs queued → `gemini-3.1-flash-image-preview` (Google `@google/genai`) generates illustrations
8. Book status updates to `ILLUSTRATING`
9. Final book assembled → status `COMPLETED` or `PARTIAL`
10. PDF export available via `/api/book/[bookId]/export/pdf`

### Auto-chain sequencing

When a book is set to auto-illustrate (the `autoIllustrate` flag on `Book`), the pipeline re-enters through the **character-extraction worker** after the story is ready. That worker extracts the canonical character identity, then builds the illustration `FlowProducer` flow (a parent `book-finalize` job plus one child illustration job per page). See `apps/workers/src/workers/character-extraction.worker.ts` (`createIllustrationFlow`).

## Models

| Job                        | Provider               | Model                            |
| -------------------------- | ---------------------- | -------------------------------- |
| Story generation           | OpenAI Responses API   | `gpt-5.5`                        |
| Character extraction       | OpenAI                 | `gpt-5-mini`                     |
| Illustration QC / finalize | OpenAI                 | `gpt-5-mini`                     |
| Story QC (upcoming)        | OpenAI                 | `gpt-5-mini`                     |
| Illustration generation    | Google `@google/genai` | `gemini-3.1-flash-image-preview` |

## Art Styles

Three styles live in `STYLE_LIBRARY` (`packages/shared/src/prompts/styles.ts`):

- **vignette** — watercolor/pencil aesthetic, soft organic edges fading to pure white. Default style.
- **origami** — layered paper-craft look, compact contained set piece on a white page.
- **kawaii** — cute rounded character style.

Each style provides interior and cover prompt builders plus `referenceImageUrls[]` for multi-image style transfer.

## Story Text Rendering

Story text renders on its own pages, never composited onto illustrations. Title pages use AI-generated artistic text; the only image compositing left is the title-page logo stamp (opentype.js + sharp) in `apps/workers/src/utils/image-processing.ts`.

### Where text renders

- **Print + PDF export**: `generateTextPageHtml` in `packages/pdf/src/pages.ts` — a white page with centered story text (Andika for en, Zen Maru Gothic for ja), verso text / recto illustration pairs. User strings are HTML-escaped via `packages/pdf/src/escape.ts`.
- **On-screen flipbook**: `buildDisplayPages` in `apps/web/src/components/book/display-pages.ts` — spread layout mirrors print (text page + illustration page); portrait layout combines square art + a text strip on one page.

The old text-overlay system (story text composited onto the illustration at yPosition 0.88) is gone; do not build against it.

## Illustration Failure Handling

### Page Moderation Status

- **PENDING**: Not yet processed
- **OK**: Illustration generated successfully
- **FLAGGED**: Blocked by the image model's content policy — permanent, cannot retry
- **FAILED**: Transient error — can be retried

### Error Classification

| Error Type                        | Page Status | BullMQ Retry   | User Can Retry |
| --------------------------------- | ----------- | -------------- | -------------- |
| Content policy (safety/copyright) | `FLAGGED`   | No             | No             |
| Transient (network/timeout/503)   | Unchanged   | Yes (up to 5x) | Yes            |
| Permanent error on last attempt   | `FAILED`    | No             | Yes            |

**Transient Errors** (auto-retry): `fetch failed`, `ETIMEDOUT`, `ECONNRESET`, `503`, `rate limit`, `429`

**Content Policy Errors** (no retry): `safety`, `blocked`, `content policy`, `copyright`

### Smart Retry (User-Initiated)

1. Pages with `OK` status → SKIPPED
2. Pages with `FLAGGED` status → SKIPPED
3. Pages with `FAILED` status → RETRIED

### Key Files

- `apps/web/src/app/api/generate/illustrations/route.ts` — Smart retry logic
- `apps/workers/src/workers/illustration-generation.worker.ts` — Error classification

## Title Page System

- **Source of truth**: `page.assetId === book.coverAssetId`
- **Centralized function**: `isTitlePage()` in `packages/shared/src/utils.ts`
- **Logo overlay**: `addLogoToTitlePage()` adds Storywink.ai logo (bottom-left)
- **Mascot image**: `apps/workers/assets/images/mascot.png`

## Upload Architecture

- **Direct browser uploads**: Files go straight to Cloudinary (no server)
- **Cloudinary widget**: `next-cloudinary` with CldUploadWidget
- **Upload preset**: `storywink_unsigned` with folder `user_${userId}/uploads`
- **Database sync**: `/api/cloudinary/notify` creates Asset and Page records

## Cloudinary Image Optimization

All images use `f_auto,q_auto` transformations:

- **f_auto**: WebP/AVIF/JPEG based on browser (30-50% smaller)
- **q_auto**: Intelligent compression (20-40% smaller)
- **PDF export**: Uses `q_auto:best` for print quality

**Function**: `optimizeCloudinaryUrl()` in `packages/shared/src/utils.ts`

## AI Prompt Architecture

Prompts centralized in `/packages/shared/src/prompts/`:

- `story.ts` — `gpt-5.5` story prompts; generates `illustrationNotes` for dynamic effects
- `illustration.ts` — Gemini prompts with multi-image style transfer
- `styles.ts` — Style library with `referenceImageUrls[]` arrays (vignette / origami / kawaii)
- `character-identity.ts` — `gpt-5-mini` character-extraction prompts

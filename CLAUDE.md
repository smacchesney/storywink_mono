# Storywink.ai

AI-powered platform transforming photos into personalized children's picture books. Uses GPT-5.1 for story generation and Gemini 3 Pro Image for illustrations.

## Commands

```bash
# Development (requires docker-compose up -d first)
npm run dev                    # Start all services with Turbo

# Before committing
npm run lint && npm run format && npm run check-types

# Database
npm run db:studio              # GUI for database inspection
npm run db:generate            # Regenerate Prisma client after schema changes
npm run db:migrate             # Run migrations
```

## Architecture

```
apps/
  web/          Next.js 15 frontend (port 3000)
  api/          Express REST API (port 4000)
  workers/      BullMQ job processors

packages/
  database/     Prisma schema and client
  shared/       Shared types, schemas, prompts (builds to dist/)
```

## Critical: Import Pattern

**IMPORTANT**: Always import from `@storywink/shared`, never relative paths.

```typescript
// Correct
import { BookStatus } from '@storywink/shared';
import { createBullMQConnection } from '@storywink/shared/redis';
import { STYLE_LIBRARY } from '@storywink/shared/prompts/styles';

// Wrong - never use these
import { BookStatus } from '../shared';
import { BookStatus } from './shared';
import { BookStatus } from '@/shared';
```

Available exports: main, `/constants`, `/schemas`, `/utils`, `/types`, `/redis`, `/prompts`, `/prompts/story`, `/prompts/illustration`, `/prompts/styles`

## Book Status Flow

```
DRAFT → GENERATING → STORY_READY → ILLUSTRATING → COMPLETED
                                                 ↘ PARTIAL (some pages failed)
                                                 ↘ FAILED (critical error)
```

## Hybrid API Pattern

The app uses both Express and Next.js API routes:

- **Express (port 4000)**: Queue operations, worker coordination
  - `/api/generate/story`, `/api/generate/illustrations`, `/api/books`

- **Next.js (port 3000)**: User-facing operations, webhooks
  - `/api/book/create`, `/api/cloudinary/notify`, `/api/webhooks/clerk`

## Key Patterns

- Queue-based processing: All AI operations async via BullMQ
- Direct Cloudinary uploads: Browser-to-Cloudinary (no server involvement)
- Title page detection: `isTitlePage()` in `packages/shared/src/utils.ts`
- AI prompts: Centralized in `packages/shared/src/prompts/`
- Redis connections: Use `createBullMQConnection()` from `@storywink/shared/redis`

## Print-on-Demand (Lulu Saddle Stitch)

Pod package: `0850X0850FCPRESS080CW444MXX` (8.5x8.5 Full Color Saddle Stitch)

**Two separate PDFs sent to Lulu:**

1. **Cover PDF** — Single-page spread: Back Cover (left, 8.625") + Front Cover (right, 8.625") = 17.25" x 8.75"
   - Front cover = title page illustration (full bleed)
   - Back cover = white bg, Excalifont "Storywink.ai" branding, mascot below
   - Files: `apps/web/src/lib/pdf/generateLuluCover.ts`, `apps/workers/src/utils/pdf/generateLuluCover.ts`

2. **Interior PDF** — Sequential single pages, 8.75" x 8.75" (8.5" + 0.125" bleed)
   - Page 1 (recto): Dedication — "This book was made especially for [childName]"
   - Pages 2+: Text (verso/left) + Illustration (recto/right) pairs per story page
   - Ending page: "The End / Until next time, [childName]!"
   - Padded to multiple of 4 with blank pages (saddle stitch requirement, 4-48 pages)
   - Title page EXCLUDED (it's on the cover spread)
   - Files: `apps/web/src/lib/pdf/generateBookPdf.ts`, `apps/workers/src/utils/pdf/generateBookPdf.ts`

**Key Lulu rules:**
- Inside front/back covers are NOT printable (saddle stitch only)
- Page 1 of interior prints on recto (right-hand side)
- Lulu handles imposition — supply reader-spread order, NOT printer spreads
- Page count formula: `2 (dedication + ending) + 2N` where N = story photos (always even)

**User PDF export** (different from Lulu): Title page → Dedication → Stories → Ending → Back cover. No blank padding. Controlled via `generateBookPdf(bookData, { titlePage, includeBackCover: true, padToFour: false })`.

**Dual code paths:** Web (`apps/web/src/lib/pdf/`) and Workers (`apps/workers/src/utils/pdf/`) have mirrored PDF generators. Changes must be applied to BOTH.

## Ways of Working

- Provide brutally honest assessments. No sugar-coating.
- Always question my assumptions - I may be incorrect or misunderstanding.
- Keep solutions simple. Only make changes directly requested.

## Brand

- **Primary**: Coral `#F76C5E`
- **Font**: Excalifont (hand-drawn style), class `font-playful` in Tailwind
- **Text**: Near-black `#1a1a1a`
- **Logo**: "Storywin" in black + "k.ai" in coral
- **Mascots** (Cloudinary): dedication (sleeping cats), ending (sitting cats), back cover (waving cats)

## Additional Documentation

See `docs/` folder for detailed technical documentation:
- `docs/print-on-demand.md` - Lulu API, Stripe, PDF generation
- `docs/architecture-details.md` - Text overlay, illustration handling, data flow

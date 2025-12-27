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

## Ways of Working

- Provide brutally honest assessments. No sugar-coating.
- Always question my assumptions - I may be incorrect or misunderstanding.
- Keep solutions simple. Only make changes directly requested.

## Brand

- **Primary**: Coral `#F76C5E`
- **Font**: Excalifont (hand-drawn style)
- **Text**: Near-black `#1a1a1a`

## Additional Documentation

See `docs/` folder for detailed technical documentation:
- `docs/print-on-demand.md` - Lulu API, Stripe, PDF generation
- `docs/architecture-details.md` - Text overlay, illustration handling, data flow

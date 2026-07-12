# Storywink.ai

AI-powered platform transforming photos into personalized children's picture books. Story generation runs on the OpenAI Responses API (`gpt-5.5`, override via `STORY_MODEL`); character extraction and QC use `gpt-5-mini`. Illustrations use Gemini 3.1 Flash Image or OpenAI gpt-image-2, selectable via the `ILLUSTRATION_PROVIDER` env var on the workers service.

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
  web/          Next.js 15 — UI + all API routes (port 3000)
  workers/      BullMQ job processors (all AI work)

packages/
  database/     Prisma schema and client
  shared/       Shared types, schemas, prompts (builds to dist/)
```

The web app owns every HTTP endpoint. Deploy target is Railway (services: web, workers, migrate).

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

## Ways of Working

- Provide brutally honest assessments. No sugar-coating.
- Always question my assumptions - I may be incorrect or misunderstanding.
- Keep solutions simple. Only make changes directly requested.
- When making UI / UX changes, use playwright MCP to verify the quality of the UI changes, and ensure consistency with brand guidelines. Save screenshots in .screenshots folder.
- The USP of this app is simplicity and intuitive UX for users. We need to hyper-focus on this in EVERYTHING we do.

## Additional Documentation

See `docs/` folder for detailed technical documentation:

- `docs/print-on-demand.md` - Lulu API, Stripe, PDF generation
- `docs/architecture-details.md` - Text overlay, illustration handling, data flow

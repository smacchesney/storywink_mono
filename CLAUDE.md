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

# Storywink.ai

AI-powered platform transforming photos into personalized children's picture books. Story generation runs on the OpenAI Responses API (`gpt-5.6`, override via `STORY_MODEL`); character extraction and QC use `gpt-5-mini`. Illustrations use Gemini 3.1 Flash Image or OpenAI gpt-image-2, selectable via the `ILLUSTRATION_PROVIDER` env var on the workers service.

## Commands

```bash
# Development (requires docker-compose up -d first)
npm run dev                    # Start all services with Turbo

# Before committing
npm run lint && npm run format && npm run check-types
npm run test                   # Vitest — 100+ test files, includes frozen PDF snapshots

# Database
npm run db:studio              # GUI for database inspection
npm run db:generate            # Regenerate Prisma client after schema changes
npm run db:migrate             # Run migrations

# i18n (after changing user-facing copy)
npm run i18n:check             # Verify en/ja translation parity
```

## Architecture

```
apps/
  web/          Next.js 15 — UI + all API routes (port 3000)
  workers/      BullMQ job processors (all AI work)
  api/          DEAD — build artifacts only, no source. Ignore it.

packages/
  database/     Prisma schema and client
  shared/       Shared types, schemas, prompts (builds to dist/)
  pdf/          All PDF generation (Lulu + user export) — snapshot-frozen, see .claude/rules/print-on-demand.md
```

The web app owns every HTTP endpoint. Deploy target is Railway (services: web, workers, migrate). UI copy is bilingual: `apps/web/messages/en.json` + `ja.json`.

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

The full subpath list lives in `packages/shared/package.json` (`exports`) — check there, don't guess.

## Ways of Working

- Provide brutally honest assessments. No sugar-coating.
- Always question my assumptions - I may be incorrect or misunderstanding.
- Keep solutions simple. Only make changes directly requested.
- When making UI / UX changes, use playwright MCP to verify the quality of the UI changes, and ensure consistency with brand guidelines. Save screenshots in .screenshots folder.
- The USP of this app is simplicity and intuitive UX for users. We need to hyper-focus on this in EVERYTHING we do.

## Dual-Brain Workflow (Claude + Sol)

For features and non-trivial fixes, GPT-5.6 Sol acts as a second brain via the `codex@openai-codex` plugin. Claude orchestrates and has **final say** on all Sol feedback — consider each point, adopt or reject with reasons.

1. **Plan** — Claude drafts in plan mode, saves to `.claude/plans/`.
2. **Plan review** — `/codex:rescue --wait --fresh --effort xhigh` pointing Sol at the plan file. Read-only: challenge assumptions, failure modes, simpler alternatives.
3. **Fold in** — Claude integrates surviving critique into the plan.
4. **Implement** — Claude by default (knows the codebase); Sol via `/codex:rescue --effort high` (write mode) when delegating. Never both editing at once. **Write mode is not the default**: when driving the runtime directly (the `codex-companion.mjs task` invocation inside the rescue subagent), pass `--write` explicitly or Sol lands in a read-only sandbox and every edit is rejected. Review/diagnosis runs correctly omit it.
5. **QA** — Claude runs real verification (lint, check-types, test, Playwright vs brand). Then `/codex:adversarial-review --base main` in a fresh thread. Sol never reviews its own same-thread work.

Skip step 2 for small fixes. Review gate stays OFF. Sol's instruction file is `AGENTS.md` — keep it in sync when rules here change materially.

**Claude drives Sol directly — no user intervention.** The owner works in the Claude Code desktop app; never ask them to type `/codex:` commands. Invoke the plugin commands yourself via the Skill tool (`codex:rescue`, `codex:adversarial-review`, `codex:status`, `codex:result`) with the flags above as args. The review gate is already configured off; do not re-run setup unless a codex call fails. If a call reports an auth failure, that's the one thing Claude can't fix: ask the owner to run `codex logout && codex login` in a terminal, then retry.

## Additional Documentation

See `docs/` folder for detailed technical documentation:

- `docs/print-on-demand.md` - Lulu API, Stripe, PDF generation
- `docs/architecture-details.md` - Text overlay, illustration handling, data flow
- `docs/voice.md` - Storywink brand voice for user-facing copy
- `docs/ja-review.md` - Japanese localization review notes
- `docs/privacy-deletion.md` - Account/data deletion flow

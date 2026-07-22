# Storywink.ai — Agent Instructions (Codex/Sol)

AI-powered platform transforming photos into personalized children's picture books. This is a Turbo monorepo deployed on Railway.

**Source of truth:** `CLAUDE.md` plus every file in `.claude/rules/` (architecture, brand, coding-standards, print-on-demand). Read them before writing code. This file is the condensed version; when they conflict, the rules files win.

## Layout

```
apps/
  web/          Next.js 15 — UI + ALL HTTP endpoints (port 3000)
  workers/      BullMQ job processors (all AI work)
  api/          DEAD — build artifacts only. Ignore it.

packages/
  database/     Prisma schema and client
  shared/       Shared types, schemas, prompts (builds to dist/)
  pdf/          All PDF generation — snapshot-frozen, do not touch without reading .claude/rules/print-on-demand.md
```

## Hard rules

1. **Imports**: always from `@storywink/shared` (or a subpath like `@storywink/shared/redis`). Never relative paths into shared, never `@/shared`.
2. **No quick fixes.** Diagnose to root cause. No patches or workarounds unless explicitly requested.
3. **Scope**: only make changes directly requested. Keep solutions simple. If a plan file is referenced (usually in `.claude/plans/`), implement it exactly; flag disagreements instead of silently deviating.
4. **PDF package is frozen** by a byte-exact Lulu snapshot test. Interior-PDF changes require a deliberate snapshot re-baseline; do not "fix" a failing snapshot by updating it.
5. **Bilingual copy**: user-facing strings live in `apps/web/messages/en.json` + `ja.json`. Change both, follow `docs/voice.md` (kind children's librarian persona), run `npm run i18n:check`.
6. **Brand**: coral `#F76C5E`; Excalifont (`font-playful`) for display headings/CTAs, Geist for body, `font-japanese` replaces `font-playful` in Japanese. Waiting states use the Storydust system (`apps/web/src/components/ui/storydust.tsx`), never `Loader2`. Mascot URLs come from `apps/web/src/lib/mascots.ts`, never inlined.
7. **Never commit or push.** Leave changes in the working tree for review.
8. **No secrets** in code or logs. All timestamps UTC.

## Models

AI model IDs and env overrides live in `apps/workers/src/config/models.ts` and `apps/workers/src/lib/illustrators/`. Read those files; never hardcode a model id from memory.

## Nested instructions

Subdirectories carry their own CLAUDE.md (apps/web, apps/workers, packages/database, packages/shared, packages/pdf). These load for you automatically as fallback instruction files — treat them as binding for code in their tree, and `packages/pdf/CLAUDE.md` as a hard stop-and-read before touching PDFs.

## Verification before you claim done

```bash
npm run lint && npm run check-types
npm run test          # Vitest, 100+ files — must pass untouched
npm run i18n:check    # only if you changed messages/*.json
```

Report failures honestly. A skipped check is a skipped check, not a pass.

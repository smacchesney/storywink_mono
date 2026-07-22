# PDF Package (@storywink/pdf)

Single code path for ALL PDF generation: Lulu print (cover + interior) and user export. Consumed by both apps; apps supply fonts only.

## STOP before editing

Interior output is pinned by a **byte-frozen Lulu snapshot test** (`src/pages.lulu-snapshot.test.ts`). A failing snapshot means your change altered print output — that requires a deliberate re-baseline AND a physical proof print, never a casual snapshot update. Full Lulu rules (spread layout, page-count formula, saddle-stitch constraints): `.claude/rules/print-on-demand.md`.

## Key Files

- `src/generateBookPdf.ts` — interior assembly (Lulu + user export modes via options)
- `src/pages.ts` — page HTML
- `src/generateLuluCover.ts` + `src/cover.ts` — cover spread
- Fonts come from the caller: `apps/web/.../export/pdfFonts.ts`, `apps/workers/src/utils/pdf-fonts.ts`

## Verify

`npm run test` from repo root — this package carries ~99 tests and all must pass untouched.

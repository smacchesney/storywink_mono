# Web App (Next.js 15)

Port 3000. Frontend + all API routes. There is no separate Express service — this app owns every HTTP endpoint (book ops, webhooks, queue enqueue, PDF/print export).

## Stack
- Next.js 15 App Router, React, TypeScript
- Tailwind CSS with `font-playful` (Excalifont)
- Clerk for auth
- next-intl for i18n
- Cloudinary for image hosting (direct browser uploads)

## API Routes (Next.js)
All endpoints live under `src/app/api/`. Examples (non-exhaustive):
- `/api/book/create` — Book creation
- `/api/generate/story`, `/api/generate/illustrations` — Queue enqueue
- `/api/cloudinary/notify` — Upload webhooks
- `/api/webhooks/clerk`, `/api/webhooks/stripe` — Auth + payment webhooks
- `/api/book/[bookId]/export/...` — PDF and Lulu print export

## Key Directories
- `src/app/` — App Router pages and layouts
- `src/components/` — React components
- `src/i18n/` — Internationalization config and messages
- `src/hooks/` — Custom React hooks

## PDF Generation
All PDF generation lives in the shared `packages/pdf` workspace (`@storywink/pdf`). This app supplies its fonts via `src/app/api/book/[bookId]/export/pdfFonts.ts` and calls the package from the export routes.

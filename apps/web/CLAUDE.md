# Web App (Next.js 15)

Port 3000. Frontend + user-facing API routes.

## Stack
- Next.js 15 App Router, React, TypeScript
- Tailwind CSS with `font-playful` (Excalifont)
- Clerk for auth
- next-intl for i18n
- Cloudinary for image hosting (direct browser uploads)

## API Routes (Next.js)
- `/api/book/create` — Book creation
- `/api/cloudinary/notify` — Upload webhooks
- `/api/webhooks/clerk` — Auth webhooks

## Key Directories
- `src/app/` — App Router pages and layouts
- `src/components/` — React components
- `src/lib/pdf/` — Client-side PDF generation (mirrored in workers)
- `src/i18n/` — Internationalization config and messages
- `src/hooks/` — Custom React hooks

## PDF Generation
This app has PDF generators that mirror `apps/workers/src/utils/pdf/`. Changes to PDF logic must be applied to BOTH locations.

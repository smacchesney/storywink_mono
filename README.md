# Storywink Monorepo

AI-powered platform that transforms photos into personalized children's storybooks.

## Architecture

Two apps and two shared packages:

- **`apps/web`** — Next.js 15 frontend and all API routes (port 3000)
- **`apps/workers`** — Background job processors (BullMQ) for all AI work

Shared packages:

- **`packages/database`** — Prisma schema and database client
- **`packages/shared`** — Shared types, schemas, prompts, and Redis helpers

The web app owns every HTTP endpoint (book operations, webhooks, queue enqueue, PDF/print export). AI operations run asynchronously in the workers via BullMQ.

## Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis
- Docker (for local Postgres + Redis)

### Installation

```bash
# Clone and install
git clone <your-repo-url>
cd storywink-monorepo
npm install

# Set up environment variables
cp apps/web/.env.example apps/web/.env.local
cp apps/workers/.env.example apps/workers/.env.local

# Start databases
docker-compose up -d

# Generate Prisma client and run migrations
npm run db:generate
npm run db:migrate

# Start all services
npm run dev
```

## Project Structure

```
storywink-monorepo/
├── apps/
│   ├── web/          # Next.js 15 — UI + all API routes
│   └── workers/      # BullMQ job processors
├── packages/
│   ├── database/     # Prisma ORM
│   └── shared/       # Shared code (types, schemas, prompts)
├── docs/             # Technical documentation
├── docker-compose.yml
├── turbo.json
└── package.json
```

## Available Scripts

### Root Level

- `npm run dev` — Start all services in development mode
- `npm run build` — Build all services
- `npm run lint` — Lint all code
- `npm run format` — Format code with Prettier
- `npm run check-types` — Type-check all packages

### Database

- `npm run db:generate` — Generate Prisma client
- `npm run db:migrate` — Run migrations
- `npm run db:studio` — Open Prisma Studio

## Environment Variables

Each app ships an `.env.example` — that file is the source of truth for the full list.

### Web (`apps/web`) — key vars

- `DATABASE_URL` — PostgreSQL connection
- `REDIS_URL` — Redis connection (queue enqueue)
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — Clerk auth
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_*` — image storage
- `OPENAI_API_KEY` — batch-avatar subject detection (`/api/avatars/detect`)
- `STRIPE_*`, `LULU_*`, `DROPBOX_*` — payment and print-on-demand
- Feature-flag pairs (`AVATARS_ENABLED` + `NEXT_PUBLIC_AVATARS_ENABLED`, …) — the
  `NEXT_PUBLIC_*` halves are baked at build time and must stay declared in
  `apps/web/Dockerfile` ARGs and `turbo.json` build env

### Workers (`apps/workers`) — key vars

- `DATABASE_URL` — PostgreSQL connection
- `REDIS_URL` — Redis connection
- `OPENAI_API_KEY` — Story, character extraction, QC
- `GOOGLE_API_KEY` — Illustration generation
- `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` — image uploads

## Deployment

Deployed on **Railway** with three services:

- **web** — Next.js app
- **workers** — BullMQ processors
- **migrate** — Runs database migrations on deploy

Provision PostgreSQL and Redis, set the environment variables above per service, and push to trigger a deploy.

## Development Workflow

1. **Feature Development**

   ```bash
   git checkout -b feature/your-feature
   npm run dev
   npm run lint && npm run check-types   # before committing
   ```

2. **Database Changes**
   ```bash
   # Edit packages/database/prisma/schema.prisma, then:
   npm run db:migrate    # generate + apply migration
   npm run db:generate   # regenerate the client
   ```

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **API**: Next.js App Router route handlers
- **Database**: PostgreSQL with Prisma ORM
- **Queue**: BullMQ with Redis
- **Auth**: Clerk
- **Storage**: Cloudinary (images), Dropbox (print PDFs)
- **AI**: OpenAI Responses API (`gpt-5.5` story, `gpt-5-mini` extraction/QC); Google `@google/genai` (`gemini-3.1-flash-image-preview` illustrations)

## Documentation

See the `docs/` folder:

- `docs/architecture-details.md` — Data flow, text overlay, illustration handling, art styles
- `docs/print-on-demand.md` — Lulu API, Stripe, PDF generation

## Troubleshooting

- **Database connection failed** — Ensure PostgreSQL is running; check `DATABASE_URL`.
- **Redis connection failed** — Ensure Redis is running; check `REDIS_URL`.
- **Build failures** — Clear cache with `rm -rf node_modules .turbo`, then `npm install`.

## License

Private — All rights reserved

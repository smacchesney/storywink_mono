# Database Package (Prisma)

Shared Prisma schema and generated client, consumed by all apps.

## Commands
```bash
npm run db:studio       # GUI for database inspection
npm run db:generate     # Regenerate Prisma client after schema changes
npm run db:migrate      # Run migrations
```

## Key Files
- `prisma/schema.prisma` — Database schema (source of truth)
- `prisma/migrations/` — Migration history

## Rules
- Always create proper migrations for schema changes — never modify the database directly
- After changing schema.prisma, run `npm run db:generate` to update the client
- Test migrations on a local database before applying to staging/production

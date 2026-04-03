# API (Express)

Port 4000. Queue operations and worker coordination.

## Stack
- Express with TypeScript
- BullMQ for job queues
- Prisma for database access

## Routes
- `/api/generate/story` — Enqueue story generation
- `/api/generate/illustrations` — Enqueue illustration generation
- `/api/books` — Book CRUD
- `/api/health` — Health check
- `/api/cart` — Cart operations
- `/api/print-orders` — Lulu print order management

## Key Directories
- `src/routes/` — Express route handlers
- `src/services/` — Business logic and external API wrappers
- `src/lib/` — Shared utilities (Lulu client, etc.)
- `src/middleware/` — Auth and request middleware

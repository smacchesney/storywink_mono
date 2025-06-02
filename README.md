# Storywink Monorepo

AI-powered platform that transforms photos into personalized children's storybooks.

## Architecture

This monorepo contains three main services:

- **`apps/web`** - Next.js frontend application (UI only)
- **`apps/api`** - Express.js backend API server
- **`apps/workers`** - Background job processors (BullMQ)

Shared packages:
- **`packages/database`** - Prisma schema and database client
- **`packages/shared`** - Shared types, schemas, and constants

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL
- Redis
- npm or pnpm

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd storywink-monorepo

# Install dependencies
npm install

# Set up environment variables
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.env.example apps/api/.env.local
cp apps/workers/.env.example apps/workers/.env.local

# Start databases (requires Docker)
docker-compose up -d

# Generate Prisma client
npm run db:generate

# Run database migrations
npm run db:migrate

# Start all services
npm run dev
```

## Project Structure

```
storywink-monorepo/
├── apps/
│   ├── web/          # Next.js frontend
│   ├── api/          # Express backend
│   └── workers/      # Queue workers
├── packages/
│   ├── database/     # Prisma ORM
│   └── shared/       # Shared code
├── docker-compose.yml
├── turbo.json
└── package.json
```

## Available Scripts

### Root Level
- `npm run dev` - Start all services in development mode
- `npm run build` - Build all services
- `npm run lint` - Lint all code
- `npm run format` - Format code with Prettier

### Database
- `npm run db:generate` - Generate Prisma client
- `npm run db:migrate` - Run migrations
- `npm run db:studio` - Open Prisma Studio

## Environment Variables

### Web (Frontend)
- `NEXT_PUBLIC_API_URL` - Backend API URL
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` - Clerk auth
- `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME` - Image storage

### API (Backend)
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `OPENAI_API_KEY` - OpenAI API
- `CLERK_SECRET_KEY` - Clerk auth
- `CLOUDINARY_*` - Cloudinary credentials

### Workers
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis connection
- `OPENAI_API_KEY` - OpenAI API

## Deployment

### Railway

For a complete step-by-step guide to deploying on Railway, see [RAILWAY_DEPLOYMENT_GUIDE.md](./RAILWAY_DEPLOYMENT_GUIDE.md).

Quick deployment:
1. Push your code to GitHub
2. Create a new Railway project
3. Deploy PostgreSQL and Redis databases
4. Deploy the three services (web, api, workers)
5. Configure environment variables

See [RAILWAY_DEPLOYMENT_GUIDE.md](./RAILWAY_DEPLOYMENT_GUIDE.md) for detailed deployment instructions.

### Manual Deployment

Each service can be deployed independently:
- Frontend: Deploy to Vercel, Netlify, or any static hosting
- API: Deploy to Railway, Render, or any Node.js hosting
- Workers: Deploy alongside API or as separate service

## Development Workflow

1. **Feature Development**
   ```bash
   # Create feature branch
   git checkout -b feature/your-feature
   
   # Make changes and test locally
   npm run dev
   
   # Run checks before committing
   npm run lint
   npm run check-types
   ```

2. **Database Changes**
   ```bash
   # Modify schema in packages/database/prisma/schema.prisma
   
   # Generate migration
   npm run db:migrate
   
   # Update TypeScript types
   npm run db:generate
   ```

3. **API Development**
   - Add routes in `apps/api/src/routes`
   - Add business logic in `apps/api/src/services`
   - Update shared types in `packages/shared`

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **Backend**: Express.js, TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Queue**: BullMQ with Redis
- **Auth**: Clerk
- **Storage**: Cloudinary
- **AI**: OpenAI GPT-4, DALL-E 3

## Troubleshooting

### Common Issues

1. **Database connection failed**
   - Ensure PostgreSQL is running
   - Check DATABASE_URL in .env.local

2. **Redis connection failed**
   - Ensure Redis is running
   - Check REDIS_URL in .env.local

3. **CORS errors**
   - Update NEXT_PUBLIC_API_URL in frontend
   - Check allowed origins in API CORS config

4. **Build failures**
   - Clear cache: `rm -rf node_modules .turbo`
   - Reinstall: `npm install`

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

Private - All rights reserved
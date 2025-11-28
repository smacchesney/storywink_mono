# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Storywink.ai is an AI-powered platform that transforms users' photos into personalized children's picture books. The application uses GPT-4o Vision for story generation and Google's Gemini 2.5 Flash Image API for illustrations, with a queue-based architecture for asynchronous processing.

## Essential Commands

### Development
```bash
# Initial setup (required before first run)
docker-compose up -d    # Start PostgreSQL & Redis containers
npm install            # Install all dependencies
npm run db:generate    # Generate Prisma client
npm run db:migrate     # Run database migrations

# Start development
npm run dev            # Runs all services concurrently with Turbo

# Individual services (if needed)
npm run dev --filter=@storywink/web      # Next.js frontend only
npm run dev --filter=@storywink/api      # Express API only
npm run dev --filter=@storywink/workers  # Background workers only
```

### Code Quality (Run before committing)
```bash
npm run lint           # ESLint with auto-fix
npm run format         # Prettier formatting
npm run check-types    # TypeScript type checking
```

### Database Management
```bash
npm run db:studio      # GUI for database inspection
npm run db:push        # Push schema changes without migration
npm run db:generate    # Regenerate Prisma client after schema changes
docker-compose down    # Stop database containers
```

### Build & Production
```bash
npm run build          # Build all services
npm run start          # Start production builds
npm run clean          # Clean all build artifacts
```

## Architecture Overview

### Monorepo Structure
- **Turborepo** for build orchestration and caching
- **npm workspaces** for dependency management
- **apps/web**: Next.js 15 frontend (App Router)
- **apps/api**: Express.js REST API
- **apps/workers**: BullMQ background job processors
- **packages/database**: Shared Prisma schema and client
- **packages/shared**: Shared types, schemas, and constants (built to dist/)

### Import Architecture (CRITICAL - June 8, 2025 Refactor)
- **All shared code imports from `@storywink/shared`** - no relative imports
- **No duplicate shared directories** - removed from apps/api/src/shared, apps/workers/src/shared, apps/web/src/shared
- **Shared package builds to dist/** - TypeScript compiles to JavaScript with declarations
- **STATUS_MESSAGES uses UPPERCASE keys** - matches PostgreSQL BookStatus enum (DO NOT change to lowercase)
- **Workers use esbuild externals** - @storywink/shared and @storywink/database are external dependencies

### Core Stack
- **Frontend**: Next.js 15 (App Router), React 19, TypeScript 5
- **Styling**: Tailwind CSS v4, shadcn/ui components, Rough.js
- **Backend**: Express.js, TypeScript, Prisma ORM
- **Database**: PostgreSQL (via Docker)
- **Queue**: BullMQ with Redis (via Docker)
- **Auth**: Clerk.dev for user authentication
- **Storage**: Cloudinary for image hosting
- **AI**: OpenAI (GPT-4o Vision for story), Google Gemini 2.5 Flash Image for illustrations

### Redis Configuration Requirements
**CRITICAL**: Redis must be configured with the correct eviction policy for job queue reliability:

- **Required Policy**: `noeviction`
- **Current Issue**: Many Redis instances default to `volatile-lru` which evicts job data when memory is low
- **Impact**: Job data loss can cause incomplete book generation when Redis evicts queued jobs
- **Detection**: Workers log "IMPORTANT! Eviction policy is volatile-lru. It should be 'noeviction'" warnings
- **Fix for Production**: Configure Redis with `maxmemory-policy noeviction`
- **Fix for Development**: Update docker-compose.yml or local Redis config

**Production Redis Configuration:**
```
# redis.conf
maxmemory-policy noeviction
```

**Docker Compose Redis Configuration:**
```yaml
redis:
  image: redis:7-alpine
  command: redis-server --maxmemory-policy noeviction
```

### Clerk Webhook Configuration
Configure your Clerk webhook to point to the Next.js API route:
- **Development**: `http://localhost:3000/api/webhooks/clerk`
- **Production**: `https://yourdomain.com/api/webhooks/clerk`
- **Required Events**: `user.created`, `user.updated`, `user.deleted`
- **Environment Variable**: Set `CLERK_WEBHOOK_SECRET` in `apps/web/.env.local`

### Data Flow
1. User uploads photos → direct browser-to-Cloudinary upload
2. Database records created via `/api/cloudinary/notify` endpoint
3. Book created with status `DRAFT`
4. Story generation job queued → GPT-4o Vision analyzes images
5. Book status updates to `GENERATING`
6. Story generation completes → status `STORY_READY`
7. Illustration jobs queued → ChatGPT's image1 API generates images
8. Book status updates to `ILLUSTRATING`
9. Final book assembled → status `COMPLETED` or `PARTIAL`
10. PDF export available via `/api/book/[bookId]/export/pdf`

### Upload Architecture (Direct to Cloudinary)
- **Direct browser uploads**: Files go straight from browser to Cloudinary (no server involvement)
- **Cloudinary widget**: Using `next-cloudinary` package with CldUploadWidget
- **Auto-opening uploader**: `CloudinaryUploaderAuto` component opens file picker immediately
- **Upload preset**: Unsigned preset `storywink_unsigned` with folder structure `user_${userId}/uploads`
- **Progress tracking**: Real-time upload progress shown with custom UI
- **Database sync**: After upload, `/api/cloudinary/notify` creates Asset and Page records
- **No size limits**: Bypasses server completely, supporting unlimited file sizes
- **User flow**: 
  - Create: Start Creating → Photo Source → Choose Phone → File Picker → Upload Progress → Edit Page
  - Edit: Add Photos → Photo Source → Choose Phone → File Picker → Upload Progress → Updated Pages

### Key Directories
- `/apps/web/src/app/`: Next.js App Router pages and API routes
- `/apps/api/src/routes/`: Express API endpoints
- `/apps/workers/src/workers/`: Background job processors
- `/packages/database/prisma/`: Database schema and migrations
- `/packages/shared/src/`: Shared types and schemas

### Important Patterns
- **Queue-based processing**: All AI operations are async via BullMQ
- **Status polling**: Frontend polls `/api/book-status` for real-time updates
- **Modular routing**: Separate route files for each resource
- **Shared packages**: Types and schemas shared across all services via `@storywink/shared`
- **Docker development**: PostgreSQL and Redis run in containers
- **Rough UI aesthetic**: Custom components with hand-drawn styling
- **Centralized title page logic**: `isTitlePage()` function in `packages/shared/src/utils.ts`
- **Consistent page categorization**: Story pages vs title pages based on coverAssetId
- **Flow Producer jobs**: Parent-child job relationships for coordinated processing
- **Centralized prompt architecture**: All AI prompts in `packages/shared/src/prompts/`
- **Direct Cloudinary uploads**: Browser-to-Cloudinary with no server involvement
- **Auto-opening file picker**: Better UX with immediate file selection dialog
- **Monorepo imports**: All shared code imported from `@storywink/shared` (no local duplicates)
- **Direct imports for critical modules**: `STYLE_LIBRARY` uses direct path `@storywink/shared/prompts/styles` to prevent barrel import race conditions

### Environment Variables
Create `.env` files in each app directory:

**apps/web/.env.local**:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME=storywink
```

**apps/api/.env**:
```
DATABASE_URL=postgresql://user:password@localhost:5432/storywink
REDIS_URL=redis://localhost:6379
CLERK_SECRET_KEY=
OPENAI_API_KEY=
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

**apps/workers/.env**:
```
DATABASE_URL=postgresql://user:password@localhost:5432/storywink
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=
GOOGLE_API_KEY=
CLOUDINARY_URL=
```

## Development Workflow
1. Always run `docker-compose up -d` first to start databases
2. Use `npm run dev` to start all services concurrently
3. Check worker logs for queue processing status
4. Use Prisma Studio (`npm run db:studio`) to inspect database
5. Run `npm run lint && npm run format && npm run check-types` before committing
6. Frontend runs on http://localhost:3000, API on http://localhost:4000

### Shared Package Notes
- `@storywink/shared` is built to `packages/shared/dist/`
- Turbo handles build order automatically (shared builds before apps)
- Import from `@storywink/shared`, not relative paths
- Exports available: main, `/constants`, `/schemas`, `/utils`, `/types`, `/redis`, `/prompts`, `/prompts/story`, `/prompts/illustration`, `/prompts/styles`
- Package uses simplified tsconfig.json (doesn't extend root) to avoid baseUrl conflicts
- All shared types, schemas, constants, and utils are centralized here

### Import Examples
```typescript
// ✅ Correct imports
import { BookStatus, STATUS_MESSAGES } from '@storywink/shared';
import { createVisionStoryGenerationPrompt } from '@storywink/shared/prompts/story';
import { STYLE_LIBRARY } from '@storywink/shared/prompts/styles';
import { createBullMQConnection } from '@storywink/shared/redis';

// ❌ Never use these patterns
import { BookStatus } from '../shared';  // No relative imports
import { BookStatus } from './shared';   // No local shared directories
import { BookStatus } from '@/shared';   // No path aliases to shared
```

## Book Status Flow
- **DRAFT**: Initial book creation, user uploading photos
- **GENERATING**: Story generation in progress (GPT-4o Vision analyzing photos)
- **STORY_READY**: Story generation complete, ready for illustrations
- **ILLUSTRATING**: Illustration generation in progress (image1 api)
- **COMPLETED**: All story and illustration generation successful
- **PARTIAL**: Some content generated but not complete
- **FAILED**: Critical errors prevented completion

## Title Page System
The system uses centralized logic for title page detection:
- **Source of truth**: `page.assetId === book.coverAssetId`
- **Centralized function**: `isTitlePage()` in `packages/shared/src/utils.ts`
- **Database field**: `page.isTitlePage` kept consistent via reorder API
- **Cover changes**: Automatically handled - old cover becomes story page
- **Migration script**: `scripts/fix-title-pages.ts` for data cleanup

## AI Prompt Architecture
All AI prompts are centralized in the shared package for consistency:
- **Location**: `/packages/shared/src/prompts/`
- **Story Prompts**: `story.ts` - Advanced prompts for GPT-4o Vision
  - Targets ages 2-5 (toddlers)
  - Supports Winkify mode for illustration enhancement notes
  - Structured message format with high-detail image analysis
  - Response format varies by Winkify state
- **Illustration Prompts**: `illustration.ts` - Style transfer prompts
  - Uses Gemini 2.5 Flash Image model with dual image inputs
  - Handles title pages vs story pages
  - Applies Winkify dynamic effects when enabled
  - Natural language instructions optimized for Gemini's interpretation
- **Style Library**: `styles.ts` - Art style definitions
  - Centralized style definitions with metadata
  - Type-safe style keys and validation functions
  - Reference images hosted on Cloudinary

## Color Correction System
Professional color grading is automatically applied to all AI-generated illustrations using LUT (Look-Up Table) transformation:

### Implementation
- **LUT File**: `storywink-LUT-better.cube` hosted on Cloudinary
- **Function**: `coolifyImageUrl()` in `packages/shared/src/utils.ts`
- **URL Transformation**: `/image/upload/` → `/image/upload/l_lut:storywink-LUT-better.cube/`

### Smart Image Detection
- **Generated images**: URLs containing `/image/upload/` get LUT applied automatically
- **User uploaded photos**: URLs without `/image/upload/` pass through unchanged
- **Zero storage cost**: Real-time URL transformation via Cloudinary

### Application Contexts
Color correction is applied across all image display locations:
- **FlipbookViewer**: Main story reading experience
- **BookPageGallery**: Page navigation thumbnails
- **BookCard**: Library cover thumbnails (completed books only)
- **PageCard**: Review page image display
- **PDF Generation**: Both web and API export include color correction

### URL Examples
```typescript
// Generated illustration (gets LUT applied)
// Before: https://res.cloudinary.com/storywink/image/upload/v123/page.jpg
// After:  https://res.cloudinary.com/storywink/image/upload/l_lut:storywink-LUT-better.cube/v123/page.jpg

// User uploaded photo (passes through unchanged)
// Before: https://res.cloudinary.com/storywink/video/upload/v123/photo.jpg
// After:  https://res.cloudinary.com/storywink/video/upload/v123/photo.jpg
```

## Testing Approach
Currently no automated tests. Manual testing through:
- Development server with hot reload
- Prisma Studio for database state inspection
- Console logs for queue job monitoring
- API testing via browser or HTTP client

## Ways of working
- Provide brutally honest and realistic assessments of requests, feasibility, and potential issues. No sugar-coating. No vague possibilities where concrete answers are needed.
- Always operate under the assumption that I, the user, might be incorrect, misunderstanding concepts, or providing incomplete/flawed information. Even if I state something with confidence, critically evaluate it. If you suspect a misunderstanding on my part, or if my request is ambiguous, unclear, or potentially flawed, you must ask clarifying questions or politely point out the potential error and explain why. Don't just accept my statements at face value. Your goal is to ensure the underlying logic and approach are sound.

## Brand visual identity
Brand primary color: coral: #F76C5E

## Recent Changes (October 1, 2025)

### Migration: OpenAI → Google Gemini 3 Pro Image

**Completed Migration**
- **Illustration API**: Migrated from OpenAI `gpt-image-1` to Google Gemini 3 Pro Image (`gemini-3-pro-image-preview`)
- **Story API**: Still using OpenAI GPT-4o Vision (no changes)
- **Quality**: Google's SOTA image generation model with "Thinking" mode for better composition
- **Resolution**: Supports up to 4K output via `imageSize: '2K'` or `'4K'`

**Technical Changes**
- **Package**: Using `@google/genai@^1.30.0` in `apps/workers`
- **Environment**: `GOOGLE_API_KEY` required in workers environment
- **API Call**: Uses `ai.models.generateContent()` with `responseModalities: ['TEXT', 'IMAGE']`
- **Image Config**: Supports `imageConfig: { aspectRatio: '1:1', imageSize: '2K' }`
- **Response Parsing**: Extract from `candidates[0].content.parts[0].inlineData.data`
- **Prompts**: Adapted illustration prompts for Gemini's natural language interpretation style

**Files Modified**
- `apps/workers/package.json` - Updated dependencies and esbuild externals
- `apps/workers/.env.example` - Added `GOOGLE_API_KEY`
- `apps/workers/src/workers/illustration-generation.worker.ts` - Rewrote for Gemini API
- `packages/shared/src/prompts/illustration.ts` - Adapted prompts for Gemini
- `CLAUDE.md` - Updated documentation

**Dual-Image Architecture Preserved**
The system still uses dual-image style transfer:
1. **Content Image** (user photo) - provides subjects, poses, composition
2. **Style Reference** (from style library) - provides artistic style, colors, textures
3. **Gemini 3 Pro Image** - blends them together with text overlay (upgraded from Gemini 2.5 Flash Image)

## Production Fixes (November 2025)

✅ **STATUS: RESOLVED** - All production issues have been fixed. Books now generate successfully.

### Railway Redis IPv6 Private Networking

**Problem**: Redis connections failing with `ENOTFOUND redis.railway.internal` when using Railway's internal Redis.

**Root Cause**: Railway's private network uses IPv6 only, but ioredis defaults to IPv4.

**Solution**: Added `family: 0` to all Redis connections via a shared helper function.

**Implementation**:
- **New File**: `packages/shared/src/redis.ts` - `createBullMQConnection()` helper
- **Export**: Available via `@storywink/shared/redis`
- **Key Setting**: `family: 0` enables both IPv4 and IPv6

**Files Modified**:
- `apps/workers/src/index.ts`
- `apps/api/src/lib/queue/index.ts`
- `apps/api/src/routes/generate.ts`
- `apps/web/src/lib/queue/index.ts`

```typescript
// Usage pattern
import { createBullMQConnection } from '@storywink/shared/redis';
const redis = new Redis(createBullMQConnection());
```

### Prisma SIGSEGV Crash Fix

**Problem**: Worker crashing with SIGSEGV (segmentation fault) during story generation batch updates.

**Root Cause**: `Promise.all()` executing 8+ parallel Prisma queries overwhelmed the query engine.

**Solution**: Replaced `Promise.all()` with `prisma.$transaction()` callback for sequential updates.

**File**: `apps/workers/src/workers/story-generation.worker.ts`

```typescript
// Before (crashed)
const results = await Promise.all(updatePromises);

// After (stable)
const results = await prisma.$transaction(async (tx) => {
  const updateResults = [];
  for (const update of pageUpdates) {
    const result = await tx.page.update({ ... });
    updateResults.push(result);
  }
  return updateResults;
});
```

### Timeout & Concurrency Optimizations

**Problem**: Gemini 3 Pro Image API has slower response times (40-60s) compared to previous models.

**Solutions Applied**:

1. **Backend Lock Duration**: 30s → **5 minutes (300000ms)**
   - **File**: `apps/workers/src/index.ts`
   - **Configuration**: `lockDuration: 300000` in `illustrationWorker`

2. **Frontend Polling Timeout**: 3 min → **15 minutes**
   - **File**: `apps/web/src/components/create/editor/IllustrationProgressScreen.tsx`
   - **Configuration**: `MAX_POLLS = 180` (180 × 5s = 15 minutes)

3. **Worker Concurrency**: **3 parallel workers**
   - **File**: `apps/workers/src/index.ts`
   - **Configuration**: `ILLUSTRATION_CONCURRENCY || '3'`

### STYLE_LIBRARY Protection

**Problem**: Intermittent "Missing referenceImageUrl for style: vignette" errors in production.

**Solution**: Multiple layers of protection applied:

1. **Direct imports only** - Removed barrel export from `packages/shared/src/index.ts`
2. **Startup validation** - Workers validate STYLE_LIBRARY at startup, exit if empty
3. **Deep freeze** - STYLE_LIBRARY frozen to detect any runtime mutations
4. **Diagnostic logging** - SHA256 hash logged to verify all containers run same code

### Bug Fixes

**1. Cloudinary Auto-Upload Component**
- **Issue**: State update during render causing blank page crashes
- **Fix**: Replaced `useState` with `useRef` and `queueMicrotask()` to defer function calls
- **File**: `apps/web/src/components/cloudinary-uploader-auto.tsx`

**2. API Client Book Creation**
- **Issue**: Trying to call Next.js API routes through Express API base URL
- **Fix**: Added `baseUrl` override parameter to support both Express and Next.js routes
- **File**: `apps/web/src/lib/api-client.ts`
- **Pattern**: Next.js API routes (like `/api/book/create`) use `baseUrl: ''` for relative paths

**3. Express API Environment Loading**
- **Issue**: `dotenv.config()` called after imports, causing `REDIS_URL` to be undefined
- **Fix**: Moved `dotenv.config()` to top of file before any imports
- **Added**: `--env-file=.env` flag to tsx watch command
- **File**: `apps/api/src/server.ts` and `apps/api/package.json`

**4. Docker Configuration**
- **Issue**: Redis using `volatile-lru` eviction policy (can lose job data)
- **Fix**: Added `--maxmemory-policy noeviction` to Redis command
- **Issue**: PostgreSQL username mismatch (`postgres` vs `storywink`)
- **Fix**: Updated docker-compose.yml to use consistent credentials
- **File**: `docker-compose.yml`

### API Architecture Clarification

**Hybrid API Pattern**
The application uses both Express and Next.js API routes:

**Express API** (Port 3001) - Background operations:
- `/api/generate/story` - Queue story generation jobs
- `/api/generate/illustrations` - Queue illustration generation jobs
- `/api/books` - CRUD operations on books

**Next.js API** (Port 3000) - User-facing operations:
- `/api/book/create` - Create book from uploaded assets
- `/api/cloudinary/notify` - Sync Cloudinary uploads to database
- `/api/book/[bookId]/export/pdf` - PDF generation
- `/api/webhooks/clerk` - User authentication webhooks

**Why Hybrid?**
- Next.js routes have direct access to frontend context (Clerk auth, cookies)
- Express routes handle queue operations and worker coordination
- Separation allows independent scaling of user operations vs background jobs
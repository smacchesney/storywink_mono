# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Storywink.ai is an AI-powered platform that transforms users' photos into personalized children's picture books. The application uses GPT-5.1 for story generation and Google's Gemini 3 Pro Image API for illustrations, with a queue-based architecture for asynchronous processing.

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
- **AI**: OpenAI (GPT-5.1 for story), Google Gemini 3 Pro Image for illustrations

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
4. Story generation job queued → GPT-5.1 analyzes images
5. Book status updates to `GENERATING`
6. Story generation completes → status `STORY_READY`
7. Illustration jobs queued → Gemini 3 Pro Image generates illustrations
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
  - Edit: Photos Button → Manage Photos Panel → Add/Remove Photos

### Photo Management (December 2025)
- **Manage Photos Panel**: Unified UI for adding and removing photos from books
- **Location**: "Photos" button in bottom toolbar opens the panel
- **Component**: `ManagePhotosPanel.tsx` - responsive Sheet (mobile) / Drawer (desktop)
- **Delete API**: `DELETE /api/book/[bookId]/page/[pageId]` removes page and re-indexes remaining pages
- **Constraints**:
  - Cannot delete cover photo (must change cover first)
  - Minimum 2 pages required per book
  - Confirmation dialog before deletion
- **Re-indexing**: Atomic transaction updates all page indices after deletion

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
- **GENERATING**: Story generation in progress (GPT-5.1 analyzing photos)
- **STORY_READY**: Story generation complete, ready for illustrations
- **ILLUSTRATING**: Illustration generation in progress (Gemini 3 Pro Image)
- **COMPLETED**: All story and illustration generation successful
- **PARTIAL**: Some content generated but not complete (some pages OK, some FAILED/FLAGGED)
- **FAILED**: Critical errors prevented completion

## Illustration Failure Handling (December 2025)

### Page Moderation Status
Each page has a `moderationStatus` field tracking illustration generation outcome:
- **PENDING**: Not yet processed
- **OK**: Illustration generated successfully
- **FLAGGED**: Blocked by Gemini's content policy (safety, copyright) - permanent, cannot retry
- **FAILED**: Transient error (network, timeout, API error) - can be retried

### Error Classification & Retry Logic

| Error Type | Page Status | Job Result | BullMQ Retry | User Can Retry |
|------------|-------------|------------|--------------|----------------|
| Content policy (safety/copyright) | `FLAGGED` | Success | No | No - must edit book |
| Transient (network/timeout/503) | Unchanged until last attempt | Failure | Yes (up to 5x) | Yes |
| Permanent error on last attempt | `FAILED` | Failure | No (exhausted) | Yes |

**Transient Error Patterns** (auto-retry):
- `fetch failed`, `ETIMEDOUT`, `ECONNRESET`, `ECONNREFUSED`
- `socket hang up`, `network error`, `timeout`, `aborted`
- `503`, `unavailable`, `internal error`, `deadline exceeded`
- `rate limit`, `429`, `quota exceeded`, `resource exhausted`

**Content Policy Errors** (no retry - marks as FLAGGED):
- `safety`, `blocked`, `content policy`
- `copyright`, `proprietary`, `trademark`

### Smart Retry (User-Initiated)

When user clicks "Retry Illustrations" on a PARTIAL or FAILED book:

1. **Pages with `OK` status + `generatedImageUrl`** → SKIPPED (already succeeded)
2. **Pages with `FLAGGED` status** → SKIPPED (content policy, retry won't help)
3. **Pages with `FAILED` status or missing illustration** → RETRIED

**Edge Cases**:
- If all remaining pages are FLAGGED → Returns message: "X page(s) were flagged by content policy and cannot be retried. Please edit your book to remove flagged photos."
- If all pages already succeeded → Updates book status to COMPLETED

### Implementation Files
- **Smart retry logic**: `apps/web/src/app/api/generate/illustrations/route.ts`
- **Error classification**: `apps/workers/src/workers/illustration-generation.worker.ts`
- **Helper functions**: `isTransientError()`, `isLastAttempt()` in illustration worker

### Future Phase 2 (Not Yet Implemented)
- Return user to `/edit` page with flagged photos marked for deletion
- Add "remove photo" option in edit interface
- Re-generate story text after photo removal (since story is cohesive across all images)

## Title Page System
The system uses centralized logic for title page detection:
- **Source of truth**: `page.assetId === book.coverAssetId`
- **Centralized function**: `isTitlePage()` in `packages/shared/src/utils.ts`
- **Database field**: `page.isTitlePage` kept consistent via reorder API
- **Cover changes**: Automatically handled - old cover becomes story page
- **Migration script**: `scripts/fix-title-pages.ts` for data cleanup

### Title Page Logo Overlay
Title pages automatically receive a Storywink.ai logo in the bottom-left corner:
- **Function**: `addLogoToTitlePage()` in `apps/workers/src/utils/text-overlay.ts`
- **Components**: Dino mascot image + "Storywink.ai" text with "k.ai" in coral (#F76C5E)
- **Mascot Image**: `apps/workers/assets/images/mascot.png`
- **Position**: Bottom-left with ~3% padding from edges
- **Applied**: After Gemini generates the illustration, before Cloudinary upload

## AI Prompt Architecture
All AI prompts are centralized in the shared package for consistency:
- **Location**: `/packages/shared/src/prompts/`
- **Story Prompts**: `story.ts` - Advanced prompts for GPT-5.1
  - Targets ages 2-5 (toddlers)
  - Always generates `illustrationNotes` for dynamic effects (onomatopoeia like "SPLASH!", "ZOOM!")
  - Structured message format with high-detail image analysis
  - Response format: `{ "1": { "text": "...", "illustrationNotes": "..." }, ... }`
- **Illustration Prompts**: `illustration.ts` - Style transfer prompts
  - Uses Gemini model with multi-image inputs (content + style references)
  - Handles title pages vs story pages differently
  - Always applies dynamic effects using black pencil-sketch style from references
  - Natural language instructions optimized for Gemini's interpretation
- **Style Library**: `styles.ts` - Art style definitions
  - Centralized style definitions with metadata
  - **`referenceImageUrls: string[]`** - Array of reference images (2 for story pages, 1 for title)
  - **`coverReferenceImageUrl?: string`** - Optional separate reference for title pages
  - Type-safe style keys and validation functions
  - Reference images hosted on Cloudinary

## Text Overlay System (December 2025)

Story page text is rendered programmatically for consistency, while title pages use AI-generated artistic text.

### Hybrid Approach
- **Title Pages**: AI generates artistic text integrated into the illustration (charming variation acceptable)
- **Story Pages**: Programmatic text overlay in bottom 18% white space (guaranteed consistency)

### Architecture
```
┌─────────────────────────────────┐
│                                 │
│      ILLUSTRATION AREA          │  ~82% of height
│      (soft vignette edges)      │
│                                 │
│         ↓ fades to white ↓      │
├ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─┤  (no hard line)
│                                 │
│   "Story text rendered here"    │  ~18% of height
│   "with Excalifont at 80px"     │  (pure white space)
│                                 │
└─────────────────────────────────┘
```

### Implementation
- **Utility File**: `apps/workers/src/utils/text-overlay.ts`
- **Font Rendering**: opentype.js converts text to SVG paths (avoids fontconfig dependency on Railway)
- **Image Compositing**: Sharp overlays SVG onto the image
- **Brand Font**: **Excalifont** (hand-drawn style from Excalidraw) at `apps/workers/assets/fonts/Excalifont.ttf`

### Text Overlay Configuration
```typescript
const DEFAULT_OPTIONS = {
  fontSize: 80,           // 80px base size
  color: '#1a1a1a',       // Near-black text
  yPosition: 0.88,        // 88% from top (centered in bottom 18%)
  lineHeight: 1.3,        // Line spacing multiplier
  maxWidth: 0.90,         // 90% of image width
  maxLines: 3,            // Maximum lines before truncation
};
```

### Key Technical Details
- **Font Loading**: Uses `new Uint8Array(buffer)` pattern for proper ArrayBuffer conversion (Node.js Buffer pool can have non-zero byteOffset)
- **SVG Path Conversion**: Text converted to `<path>` elements, not `<text>` elements (bypasses fontconfig entirely)
- **Dynamic Font Sizing**: Automatically reduces font size (down to 65% of base) if text doesn't fit in maxLines
- **Text Wrapping**: Actual font metrics used for accurate word wrapping

### Prompt Integration
Story pages request white space in the prompt (`illustration.ts`):
```typescript
`COMPOSITION: Create the illustration in the top ~82% of the image. Leave the
bottom ~18% as PURE WHITE (#FFFFFF) empty space - this area will be used for
text overlay. DO NOT add any text to the image.`
```

### Files Involved
| File | Purpose |
|------|---------|
| `apps/workers/src/utils/text-overlay.ts` | Text rendering utilities |
| `apps/workers/assets/fonts/Excalifont.ttf` | Brand font (TTF format) |
| `apps/workers/src/workers/illustration-generation.worker.ts` | Calls `addTextToImage()` after Gemini |
| `packages/shared/src/prompts/illustration.ts` | Requests white space for story pages |

## Cloudinary Image Optimization
All Cloudinary images are automatically optimized using `f_auto,q_auto` transformations:

### Implementation
- **Function**: `optimizeCloudinaryUrl()` in `packages/shared/src/utils.ts`
- **Alias**: `coolifyImageUrl()` (legacy name, same function)
- **URL Transformation**: `/image/upload/` → `/image/upload/f_auto,q_auto/`

### What These Parameters Do
- **f_auto**: Automatically delivers WebP, AVIF, or JPEG based on browser support (30-50% smaller)
- **q_auto**: Intelligent quality compression with no visible quality loss (20-40% smaller)
- **Combined**: 30-60% file size reduction

### PDF Export
For print quality, PDF generation uses `q_auto:best` instead of `q_auto` for higher fidelity output.

### URL Examples
```typescript
// Web display (f_auto,q_auto)
// Before: https://res.cloudinary.com/storywink/image/upload/v123/page.jpg
// After:  https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto/v123/page.jpg

// PDF export (f_auto,q_auto:best)
// After:  https://res.cloudinary.com/storywink/image/upload/f_auto,q_auto:best/v123/page.jpg
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

## Brand Visual Identity
- **Primary Color**: Coral `#F76C5E`
- **Brand Font**: Excalifont (hand-drawn style from Excalidraw)
- **Text Color**: Near-black `#1a1a1a`

## Recent Changes (October 1, 2025)

### Migration: OpenAI → Google Gemini 3 Pro Image

**Completed Migration**
- **Illustration API**: Migrated from OpenAI `gpt-image-1` to Google Gemini 3 Pro Image (`gemini-3-pro-image-preview`)
- **Story API**: Now using OpenAI GPT-5.1 (upgraded from GPT-4o Vision)
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

## Recent Changes (December 2025)

### Winkify Now Default + Multi-Reference Image Support

**Summary**: Dynamic effects (onomatopoeia) are now always enabled. The `isWinkifyEnabled` toggle has been removed.

**Key Changes**:
1. **No Toggle**: `isWinkifyEnabled` field removed from Book model and all code paths
2. **2 Reference Images**: Style library now uses `referenceImageUrls: string[]` (array) instead of single URL
   - Story pages: 2 reference images for better style consistency
   - Title pages: 1 reference image via `coverReferenceImageUrl`
3. **Title Page Logo**: Storywink.ai logo automatically added to title pages (bottom-left)
4. **Black Pencil-Sketch Onomatopoeia**: Dynamic effects match the hand-drawn style from reference images
5. **No Word Limit**: `illustrationNotes` no longer limited to 25 words

**Style Library Structure**:
```typescript
export const STYLE_LIBRARY = {
  vignette: {
    label: 'Vignette',
    referenceImageUrls: [
      'https://res.cloudinary.com/.../Pencil_Vignette_ref_1_evxxjl.jpg',
      'https://res.cloudinary.com/.../Pencil_Vignette_ref_2_tvaogo.jpg',
    ],
    coverReferenceImageUrl: 'https://res.cloudinary.com/.../Pencil_Vignette_title_ref_1_gbuznf.png',
    description: "...",
  },
} as const;
```

**Database Migration**: `20251205143749_remove_winkify_enabled_field` - Drops `isWinkifyEnabled` column

**Files Changed**:
- `packages/shared/src/prompts/styles.ts` - Array of reference URLs
- `packages/shared/src/prompts/story.ts` - Always generates illustrationNotes
- `packages/shared/src/prompts/illustration.ts` - Multi-reference support, black pencil style
- `apps/workers/src/workers/illustration-generation.worker.ts` - Fetches multiple refs, adds logo
- `apps/workers/src/utils/text-overlay.ts` - New `addLogoToTitlePage()` function
- `apps/web/src/components/create/editor/ArtStylePicker.tsx` - Removed toggle UI
- All API routes and types - Removed `isWinkifyEnabled` references

## Print-on-Demand Integration (December 2025) - COMPLETE ✅

### Overview
Lulu Print-on-Demand API integration for printing physical children's books. Full checkout flow with Stripe payment and async fulfillment is live and working.

### Lulu API Configuration
- **Sandbox API**: `https://api.sandbox.lulu.com`
- **Production API**: `https://api.lulu.com`
- **Auth**: OAuth 2.0 client credentials flow
- **POD Package**: `0850X0850FCPRESS080CW444MXX` (8.5x8.5" Saddle Stitch, Full Color)

### Environment Variables
```bash
# apps/api/.env
LULU_CLIENT_ID=...
LULU_CLIENT_SECRET=...
LULU_USE_SANDBOX=true  # Remove or set false for production
```

### Key Files

| File | Purpose |
|------|---------|
| `packages/shared/src/lulu.ts` | Lulu constants, PDF specs, shipping labels |
| `apps/api/src/lib/lulu/client.ts` | Lulu API client with OAuth |
| `apps/api/src/routes/print-orders.ts` | Print order API routes |
| `apps/web/src/app/checkout/test/page.tsx` | Test checkout page (no Stripe) |
| `apps/web/src/app/api/book/[bookId]/export/lulu-interior/route.ts` | Interior PDF generation |
| `apps/web/src/app/api/book/[bookId]/export/lulu-cover/route.ts` | Cover PDF generation |

### Lulu API Client (`apps/api/src/lib/lulu/client.ts`)

```typescript
import { getLuluClient } from '../lib/lulu/client.js';

const client = getLuluClient();

// Get shipping options
const options = await client.getShippingOptions({
  pageCount: 16,
  quantity: 1,
  shippingAddress: { city, country_code, postcode, state_code, street1, phone_number },
});

// Calculate price quote
const cost = await client.calculateCost({
  pageCount: 16,
  quantity: 1,
  shippingAddress: { ... },
  shippingOption: 'MAIL',
});

// Create print job (after payment)
const job = await client.createPrintJob({
  contactEmail: 'user@example.com',
  pageCount: 16,
  quantity: 1,
  interiorPdfUrl: 'https://...',
  coverPdfUrl: 'https://...',
  shippingAddress: { ... },
  shippingLevel: 'MAIL',
  bookTitle: 'My Book',
  externalId: 'order-123',
});
```

### API Endpoints (Express - Port 4000)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/print-orders/shipping-options` | POST | Get available shipping options from Lulu |
| `/api/print-orders/calculate-price` | POST | Get price quote from Lulu |
| `/api/print-orders` | POST | Create print order record |
| `/api/print-orders` | GET | List user's print orders |
| `/api/print-orders/:orderId` | GET | Get specific order |
| `/api/print-orders/:orderId/submit-to-lulu` | POST | Submit order to Lulu API |
| `/api/print-orders/:orderId/cancel` | POST | Cancel order |

### Lulu API Quirks (IMPORTANT)

1. **Different field names per endpoint**:
   - `/shipping-options/` uses `country` in shipping_address
   - `/print-job-cost-calculations/` uses `country_code` in shipping_address

2. **phone_number required**: Both endpoints require `phone_number` in shipping_address

3. **Response formats differ**:
   - `/shipping-options/` returns array directly (not wrapped)
   - `/print-job-cost-calculations/` returns object with nested fields

4. **Cost fields**:
   - `cost_excl_discounts` = per-unit cost (doesn't scale with quantity)
   - `total_cost_excl_tax` = total cost for all units (scales with quantity)
   - `fulfillment_cost` = per-order fee (doesn't scale)

### Cost Response Structure

```typescript
interface LuluPrintJobCostResponse {
  total_cost_excl_tax: string;      // Grand total before tax
  total_cost_incl_tax: string;      // Grand total including tax
  total_tax: string;
  currency: string;
  line_item_costs: Array<{
    cost_excl_discounts: string;    // Per-unit cost
    total_cost_excl_tax: string;    // Total for quantity (USE THIS)
    quantity: number;
  }>;
  shipping_cost: {
    total_cost_excl_tax: string;
  };
  fulfillment_cost?: {              // Per-order fee (~$0.75)
    total_cost_excl_tax: string;
  };
}
```

### Test Checkout Page

**URL**: `/checkout/test?bookId=xxx`

Tests Lulu API integration without Stripe:
- Fetches shipping options
- Calculates price quotes
- Creates test orders
- Generates interior + cover PDFs
- Displays PDF URLs for verification

### PDF Specifications (8.5x8.5" Saddle Stitch)

| Spec | Interior | Cover Spread |
|------|----------|--------------|
| Trim Size | 8.5" × 8.5" | 17.25" × 8.75" (back + front) |
| With Bleed | 8.75" × 8.75" | Same |
| Bleed Margin | 0.125" | 0.125" |
| Resolution | 300 DPI | 300 DPI |
| Pixels | 2625 × 2625 | 5175 × 2625 |
| Page Count | 4-48 (divisible by 4) | N/A |

### Database Schema

```prisma
model PrintOrder {
  id                String   @id @default(cuid())
  userId            String
  bookId            String
  quantity          Int      @default(1)
  status            String   @default("PENDING_PAYMENT")
  pageCount         Int?

  // Shipping address
  shippingName      String?
  shippingStreet1   String?
  shippingStreet2   String?
  shippingCity      String?
  shippingState     String?
  shippingPostcode  String?
  shippingCountry   String?
  shippingPhone     String?
  contactEmail      String?

  // Lulu integration
  luluPrintJobId    String?
  interiorPdfUrl    String?
  coverPdfUrl       String?
  submittedAt       DateTime?

  // Stripe integration (Phase 2)
  stripeSessionId   String?
  stripePaymentId   String?
  totalAmount       Int?

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  user              User     @relation(...)
  book              Book     @relation(...)
}
```

### Dropbox Integration (Lulu PDFs)

Lulu print PDFs are stored in Dropbox instead of Cloudinary to avoid the 10MB upload limit.

**Folder Structure**:
```
/Apps/Storywink/lulu-prints/{bookId}/interior.pdf
/Apps/Storywink/lulu-prints/{bookId}/cover.pdf
```

**Environment Variables** (apps/web):
```bash
DROPBOX_APP_KEY=your_app_key
DROPBOX_APP_SECRET=your_app_secret
DROPBOX_REFRESH_TOKEN=your_refresh_token
```

**Key Files**:
| File | Purpose |
|------|---------|
| `apps/web/src/lib/dropbox.ts` | Dropbox client with refresh token auth |
| `apps/web/src/app/api/book/[bookId]/export/lulu-interior/route.ts` | Interior PDF → Dropbox |
| `apps/web/src/app/api/book/[bookId]/export/lulu-cover/route.ts` | Cover PDF → Dropbox |

**Technical Notes**:
- Uses `DropboxAuth` with refresh token for automatic token renewal (no 4-hour expiration)
- Uses `filesUpload()` for files < 150MB
- Creates public shared links via `sharingCreateSharedLinkWithSettings()`
- URLs converted to `?dl=1` for direct download (required by Lulu)
- Existing files overwritten on re-upload

**What stays on Cloudinary**: User photos, generated illustrations, regular PDF exports

## Checkout & Print Fulfillment (December 2025) - PHASE 2 ✅

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CHECKOUT FLOW                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  User clicks "Order Print"                                           │
│         ↓                                                            │
│  POST /api/checkout/print                                            │
│  (Creates Stripe Checkout session with shipping options)             │
│         ↓                                                            │
│  Stripe Checkout UI (payment + shipping address)                     │
│         ↓                                                            │
│  checkout.session.completed webhook                                  │
│         ↓                                                            │
│  Create PrintOrder record (idempotent)                               │
│         ↓                                                            │
│  Queue PRINT_FULFILLMENT job                                         │
│         ↓                                                            │
│  Worker: Generate PDFs → Dropbox → Lulu API                          │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

1. **Stripe ↔ Lulu Decoupling**: No direct integration. Stripe handles payment, our system generates PDFs and submits to Lulu.
2. **Async Fulfillment**: PDF generation and Lulu submission happen in workers, not during payment.
3. **Fixed Pricing**: $15 flat print cost + $10/$20 shipping (SG/MY only for Phase 1).
4. **Photo Limit**: Maximum 20 photos per book (enforced in UI and Cloudinary widget).

### Environment Variables

```bash
# apps/workers/.env
LULU_CLIENT_ID=...
LULU_CLIENT_SECRET=...
LULU_USE_SANDBOX=true
DROPBOX_APP_KEY=...
DROPBOX_APP_SECRET=...
DROPBOX_REFRESH_TOKEN=...

# apps/web/.env.local
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
```

### Pricing Configuration

```typescript
// apps/web/src/lib/stripe.ts
export const PRINT_PRICING = {
  FLAT_COST_CENTS: 1500, // $15.00 flat rate
  MAX_PAGES: 20,
} as const;

// packages/shared/src/shipping.ts
export const SHIPPING_TIERS = {
  SINGAPORE_MALAYSIA: { priceCents: 1000, luluLevel: 'MAIL' },      // $10
  SINGAPORE_MALAYSIA_EXPRESS: { priceCents: 2000, luluLevel: 'EXPEDITED' }, // $20
};
```

### Key Files

| File | Purpose |
|------|---------|
| `apps/web/src/lib/stripe.ts` | Stripe config, pricing constants |
| `apps/web/src/app/api/checkout/print/route.ts` | Creates Stripe Checkout sessions |
| `apps/web/src/app/api/webhooks/stripe/route.ts` | Handles payment completion, queues fulfillment |
| `apps/workers/src/workers/print-fulfillment.worker.ts` | PDF generation + Lulu submission |
| `packages/shared/src/shipping.ts` | Shipping tiers for SG/MY |

### Webhook Flow (Critical Path)

```typescript
// apps/web/src/app/api/webhooks/stripe/route.ts
// 1. Idempotency check (prevents duplicate orders)
const existingOrder = await prisma.printOrder.findFirst({
  where: { stripeSessionId: session.id },
});
if (existingOrder) return; // Skip if already processed

// 2. Create PrintOrder from Stripe session
const printOrder = await prisma.printOrder.create({ ... });

// 3. Queue async fulfillment
await queue.add('fulfill-order', {
  printOrderId: printOrder.id,
  bookId: printOrder.bookId,
});
```

### Worker Flow

```typescript
// apps/workers/src/workers/print-fulfillment.worker.ts
async function processPrintFulfillment(job) {
  // 1. Load order + book data
  // 2. Generate interior PDF (via Puppeteer)
  // 3. Generate cover PDF (via Puppeteer)
  // 4. Upload both to Dropbox
  // 5. Submit to Lulu API
  // 6. Update order status to SUBMITTED_TO_LULU
}
```

### Photo Limit (20 max)

- **Constant**: `BOOK_CONSTRAINTS.MAX_PHOTOS` in `packages/shared/src/constants.ts`
- **UI**: ManagePhotosPanel shows "X / 20 photos" with progress bar
- **Enforcement**: Cloudinary widget `maxFiles: BOOK_CONSTRAINTS.MAX_PHOTOS`
- **Disable**: "Add More Photos" button disabled when at limit

### Order Success Page

**URL**: `/orders/[sessionId]/success`

Displays order confirmation after successful Stripe checkout.

**Key Features**:
- **Database-first approach**: Queries PrintOrder from database before Stripe (webhook already created it)
- **Graceful degradation**: Shows confirmation even if Stripe API call fails
- **Data sources**: Prefers database data, falls back to Stripe session metadata

**File**: `apps/web/src/app/orders/[sessionId]/success/page.tsx`

**Stripe API Note**: `shipping_details` is NOT an expandable field - it's a direct property on the session object. Only expand `line_items` or `payment_intent`.

```typescript
// ✅ Correct
const session = await stripe.checkout.sessions.retrieve(sessionId, {
  expand: ['line_items'],
});

// ❌ Wrong - will throw 400 error
const session = await stripe.checkout.sessions.retrieve(sessionId, {
  expand: ['line_items', 'shipping_details'],  // shipping_details is NOT expandable
});
```

### PDF Generation in Docker (Railway)

The workers use Puppeteer for PDF generation. The `@sparticuz/chromium` package is designed for Lambda/Vercel serverless, not Docker containers.

**Solution**: Install system Chromium in the Dockerfile.

**File**: `apps/workers/Dockerfile`

```dockerfile
FROM base AS runner
WORKDIR /app

# Install Chromium and dependencies for PDF generation
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto \
    font-noto-emoji

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
```

**PDF Generation Code**: Both `generateBookPdf.ts` and `generateLuluCover.ts` respect `PUPPETEER_EXECUTABLE_PATH` env var.

### Recovery Script for Failed Orders

If a print order fails (e.g., due to Chromium issues), use this script to retry:

**File**: `scripts/retry-failed-print-order.ts`

```bash
# Usage
npx tsx scripts/retry-failed-print-order.ts <orderId>

# Example
npx tsx scripts/retry-failed-print-order.ts cmj7akirs0053le0d8ody1m0s
```

**What it does**:
1. Resets order status from `FAILED` to `PAYMENT_COMPLETED`
2. Re-queues the print fulfillment job
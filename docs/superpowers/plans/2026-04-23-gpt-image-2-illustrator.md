# gpt-image-2 Illustrator Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime-switchable support for OpenAI `gpt-image-2` alongside the existing Gemini illustrator, selectable via `ILLUSTRATION_PROVIDER` env var, with zero behavior change when flag stays on default (`gemini`).

**Architecture:** Strategy pattern in a new `apps/workers/src/lib/illustrators/` module. Interface `IllustrationProvider` with `GeminiProvider` and `OpenAIProvider` implementations. Factory reads env at module load. Worker is decoupled from any SDK — it calls one `generate()` method for both story-page and cover illustrations.

**Tech Stack:** Node.js / TypeScript, `@google/genai` (existing), `openai` v6.25 (already in deps), Cloudinary, BullMQ, Sharp. No new packages.

**Testing approach:** This repo has no unit-test framework installed. Verification uses TypeScript strict type-checking (`npm run check-types`), production build (`npm run build` in workers), lint, and a manual staging smoke test per the spec's rollout section. Introducing vitest/jest is out of scope.

**Spec:** [`docs/superpowers/specs/2026-04-22-gpt-image-2-illustrator-design.md`](../specs/2026-04-22-gpt-image-2-illustrator-design.md)

---

## File Structure

**Create:**

- `apps/workers/src/lib/illustrators/types.ts` — `IllustrationProvider` interface, `IllustrationInput`, `IllustrationOutput`.
- `apps/workers/src/lib/illustrators/gemini.ts` — `GeminiProvider` (lift-and-shift from current worker).
- `apps/workers/src/lib/illustrators/openai.ts` — `OpenAIProvider` using `images.edit`.
- `apps/workers/src/lib/illustrators/index.ts` — `getIllustrator()` factory + startup validation.

**Modify:**

- `apps/workers/src/workers/illustration-generation.worker.ts` — replace two inline Gemini calls with `illustrator.generate(...)`. Extend `isTransientError()` with OpenAI markers.
- `apps/workers/CLAUDE.md` — update stack description.
- `CLAUDE.md` (root) — update stack description.

**No changes:** `packages/shared`, `apps/web`, `apps/api`, Prisma schema.

---

## Task 1: Define provider interface and shared types

**Files:**

- Create: `apps/workers/src/lib/illustrators/types.ts`

- [ ] **Step 1: Create the types module**

Create `apps/workers/src/lib/illustrators/types.ts`:

```ts
/**
 * Provider-agnostic contract for illustration image generation.
 *
 * Implementations wrap a specific image model SDK (Gemini, OpenAI) and expose
 * a single `generate()` method. The worker does not know which model is in use.
 */

export interface IllustrationImageInput {
  buffer: Buffer;
  mimeType: string;
}

export interface IllustrationInput {
  /** The user's source photo that becomes the illustration subject. */
  contentImage: IllustrationImageInput;
  /** Style reference images (1-2 per call, provider decides encoding). */
  styleRefs: IllustrationImageInput[];
  /** Fully constructed text prompt from createIllustrationPrompt(). */
  prompt: string;
}

export interface IllustrationOutput {
  /** Base64-encoded PNG/JPEG bytes on success. Mutually exclusive with blockedReason. */
  imageBase64?: string;
  /** Human-readable reason when content policy / safety blocked generation. */
  blockedReason?: string;
}

export type IllustrationProviderName = 'gemini' | 'openai';

export interface IllustrationProvider {
  readonly name: IllustrationProviderName;
  /**
   * Generate one illustration.
   *
   * Behavior contract:
   *  - On success: returns { imageBase64 }.
   *  - On content-policy / safety block: returns { blockedReason }.
   *  - On transient error (network, 5xx, rate limit): throws.
   *  - On permanent error (invalid key, quota exhausted): throws.
   *
   * The worker distinguishes transient vs permanent via isTransientError().
   */
  generate(input: IllustrationInput): Promise<IllustrationOutput>;
}
```

- [ ] **Step 2: Verify type-checks**

Run from repo root: `npm run check-types`
Expected: PASS (no new files referenced yet, but shouldn't break anything).

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/lib/illustrators/types.ts
git commit -m "feat(workers): add IllustrationProvider interface"
```

---

## Task 2: Implement GeminiProvider (lift-and-shift from worker)

**Files:**

- Create: `apps/workers/src/lib/illustrators/gemini.ts`

- [ ] **Step 1: Create the Gemini provider**

Create `apps/workers/src/lib/illustrators/gemini.ts`:

```ts
import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import type { IllustrationInput, IllustrationOutput, IllustrationProvider } from './types.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class GeminiProvider implements IllustrationProvider {
  readonly name = 'gemini' as const;
  private readonly client: GoogleGenAI;

  constructor() {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required when ILLUSTRATION_PROVIDER=gemini');
    }
    this.client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  }

  async generate(input: IllustrationInput): Promise<IllustrationOutput> {
    // Order matters: content image first, then style refs, then text prompt.
    // Prompts in packages/shared assume this ordering.
    const contents = [
      {
        inlineData: {
          mimeType: input.contentImage.mimeType,
          data: input.contentImage.buffer.toString('base64'),
        },
      },
      ...input.styleRefs.map((ref) => ({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.buffer.toString('base64'),
        },
      })),
      { text: input.prompt },
    ];

    const result = await this.client.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '2K',
        },
      },
    });

    const imagePart = result?.candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData);

    if (imagePart?.inlineData?.data) {
      return { imageBase64: imagePart.inlineData.data };
    }

    logger.warn({ provider: 'gemini' }, 'Gemini response contained no image data');
    return {
      blockedReason:
        'Image generation failed or blocked by content policy (no image data in response).',
    };
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/lib/illustrators/gemini.ts
git commit -m "feat(workers): extract GeminiProvider"
```

---

## Task 3: Implement OpenAIProvider

**Files:**

- Create: `apps/workers/src/lib/illustrators/openai.ts`

- [ ] **Step 1: Create the OpenAI provider**

Create `apps/workers/src/lib/illustrators/openai.ts`:

```ts
import OpenAI, { toFile } from 'openai';
import pino from 'pino';
import type { IllustrationInput, IllustrationOutput, IllustrationProvider } from './types.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

type QualityLevel = 'low' | 'medium' | 'high' | 'auto';

function readQuality(): QualityLevel {
  const raw = (process.env.OPENAI_IMAGE_QUALITY ?? 'high').toLowerCase();
  if (raw === 'low' || raw === 'medium' || raw === 'high' || raw === 'auto') {
    return raw;
  }
  logger.warn({ raw }, `Invalid OPENAI_IMAGE_QUALITY "${raw}" — falling back to "high"`);
  return 'high';
}

function readThinking(): boolean {
  return (process.env.OPENAI_THINKING ?? 'false').toLowerCase() === 'true';
}

/**
 * Detect a content-policy / safety block from an OpenAI SDK error.
 * OpenAI returns HTTP 400 with specific error codes for moderation outcomes.
 */
function isContentPolicyBlock(err: any): boolean {
  const code = String(err?.code ?? err?.error?.code ?? '').toLowerCase();
  const message = String(err?.message ?? err?.error?.message ?? '').toLowerCase();
  if (code === 'moderation_blocked' || code === 'content_policy_violation') return true;
  return (
    message.includes('content policy') ||
    message.includes('safety system') ||
    message.includes('moderation')
  );
}

export class OpenAIProvider implements IllustrationProvider {
  readonly name = 'openai' as const;
  private readonly client: OpenAI;

  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when ILLUSTRATION_PROVIDER=openai');
    }
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  async generate(input: IllustrationInput): Promise<IllustrationOutput> {
    const filenameFor = (mime: string, index: number) => {
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      return `ref-${index}.${ext}`;
    };

    // Content photo MUST be first — mirrors Gemini ordering and prompt expectations.
    const imageFiles = await Promise.all([
      toFile(input.contentImage.buffer, filenameFor(input.contentImage.mimeType, 0), {
        type: input.contentImage.mimeType,
      }),
      ...input.styleRefs.map((ref, idx) =>
        toFile(ref.buffer, filenameFor(ref.mimeType, idx + 1), { type: ref.mimeType }),
      ),
    ]);

    const quality = readQuality();
    const thinking = readThinking();

    try {
      const response = await this.client.images.edit({
        model: 'gpt-image-2',
        image: imageFiles,
        prompt: input.prompt,
        size: '2048x2048',
        quality,
        // NOTE: as of gpt-image-2 launch (2026-04-21), the "thinking" mode parameter
        // name is still settling in the SDK. Pass via generic `reasoning` field if
        // set; fall back to omitting it (standard mode) if SDK rejects. See spec
        // "Open Questions" section.
        ...(thinking ? { reasoning: { effort: 'medium' } } : {}),
      } as any);

      const imageBase64 = response.data?.[0]?.b64_json;
      if (imageBase64) {
        return { imageBase64 };
      }

      logger.warn({ provider: 'openai' }, 'OpenAI response contained no b64_json');
      return { blockedReason: 'Image generation returned no data.' };
    } catch (err: any) {
      if (isContentPolicyBlock(err)) {
        const reason = err?.message || err?.error?.message || 'Content policy block';
        logger.warn({ provider: 'openai', reason }, 'OpenAI content policy block');
        return { blockedReason: `[OpenAI] ${reason}` };
      }
      // Transient and permanent errors both re-throw; worker's isTransientError
      // classifies them by message.
      throw err;
    }
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check-types`
Expected: PASS. If the `toFile` import or `reasoning` field trip TS on the installed SDK version, prefer a typed workaround over `any`, but the single `as any` on the request body is acceptable given the spec's SDK-surface open question.

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/lib/illustrators/openai.ts
git commit -m "feat(workers): add OpenAIProvider using gpt-image-2"
```

---

## Task 4: Build the provider factory with startup validation

**Files:**

- Create: `apps/workers/src/lib/illustrators/index.ts`

- [ ] **Step 1: Create the factory**

Create `apps/workers/src/lib/illustrators/index.ts`:

```ts
import pino from 'pino';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import type { IllustrationProvider, IllustrationProviderName } from './types.js';

export type { IllustrationProvider, IllustrationInput, IllustrationOutput } from './types.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

let cachedProvider: IllustrationProvider | null = null;

function readProviderName(): IllustrationProviderName {
  const raw = (process.env.ILLUSTRATION_PROVIDER ?? 'gemini').toLowerCase();
  if (raw !== 'gemini' && raw !== 'openai') {
    throw new Error(`Unknown ILLUSTRATION_PROVIDER "${raw}". Expected "gemini" or "openai".`);
  }
  return raw;
}

/**
 * Returns the illustration provider selected by ILLUSTRATION_PROVIDER.
 * Memoized — the SDK client is reused across jobs in the same worker process.
 * Throws synchronously on misconfiguration so a misdeployed worker fails at
 * startup (via the first call) rather than on first job.
 */
export function getIllustrator(): IllustrationProvider {
  if (cachedProvider) return cachedProvider;

  const name = readProviderName();
  cachedProvider = name === 'openai' ? new OpenAIProvider() : new GeminiProvider();
  logger.info(
    {
      provider: cachedProvider.name,
      quality: process.env.OPENAI_IMAGE_QUALITY ?? '(default)',
      thinking: process.env.OPENAI_THINKING ?? 'false',
    },
    'Illustration provider selected',
  );
  return cachedProvider;
}
```

- [ ] **Step 2: Wire startup validation into the worker entrypoint**

Read `apps/workers/src/index.ts` and add a single line near the top of the startup sequence (after dotenv, before BullMQ workers are instantiated) to trigger provider construction and fail fast on bad config:

```ts
import { getIllustrator } from './lib/illustrators/index.js';
// ...
getIllustrator(); // Validate provider config at startup; throws on misconfiguration.
```

Place it after env is loaded but before any queue processor starts. Exact location depends on the file — put it in the same block where other startup invariants are checked.

- [ ] **Step 3: Type-check**

Run: `npm run check-types`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/workers/src/lib/illustrators/index.ts apps/workers/src/index.ts
git commit -m "feat(workers): provider factory with startup validation"
```

---

## Task 5: Integrate the illustrator into the worker (story-page call)

**Files:**

- Modify: `apps/workers/src/workers/illustration-generation.worker.ts`

- [ ] **Step 1: Add illustrator import and remove GoogleGenAI import**

At the top of `apps/workers/src/workers/illustration-generation.worker.ts`:

Replace:

```ts
import { GoogleGenAI } from '@google/genai';
```

with:

```ts
import { getIllustrator } from '../lib/illustrators/index.js';
import type { IllustrationInput } from '../lib/illustrators/index.js';
```

- [ ] **Step 2: Remove the in-function Gemini client initialization**

Find (around line 128–131):

```ts
// Initialize Google AI
const ai = new GoogleGenAI({
  apiKey: process.env.GOOGLE_API_KEY,
});
```

Replace with:

```ts
const illustrator = getIllustrator();
```

- [ ] **Step 3: Remove the `GOOGLE_API_KEY` precondition check**

Find (around line 109–111):

```ts
if (!process.env.GOOGLE_API_KEY) {
  throw new Error('Google API key not configured');
}
```

Delete these lines. The provider constructor now enforces its own key requirement and the startup-validation call in Task 4 catches missing keys before any job runs.

- [ ] **Step 4: Replace the story-page Gemini call**

Find the try block starting around line 399 (`logger.info({ jobId: job.id, pageId, pageNumber }, 'Calling Gemini 3.1 Flash Image API...');`) and extending through the `generatedImageBase64 = imagePart.inlineData.data;` / moderation-block branch around line 458.

Replace the entire block from `logger.info({ ... }, 'Calling Gemini 3.1 Flash Image API...');` through the end of the success/no-image-data branch (just before the `} catch (apiError: any) {`) with:

```ts
logger.info(
  { jobId: job.id, pageId, pageNumber, provider: illustrator.name },
  'Calling illustration provider...',
);
console.log(
  `[IllustrationWorker] Calling ${illustrator.name} for page ${pageNumber} with ${styleReferenceBuffers.length} style ref(s)...`,
);

const illustrationInput: IllustrationInput = {
  contentImage: { buffer: contentImageBuffer, mimeType: contentImageMimeType },
  styleRefs: styleReferenceBuffers,
  prompt: textPrompt,
};

const result = await illustrator.generate(illustrationInput);

logger.info(
  { jobId: job.id, pageId, pageNumber, provider: illustrator.name },
  'Received response from illustration provider.',
);
console.log(`[IllustrationWorker] ${illustrator.name} response received for page ${pageNumber}`);

if (result.imageBase64) {
  generatedImageBase64 = result.imageBase64;
  logger.info({ jobId: job.id, pageId, pageNumber }, 'Extracted generated image data.');
} else {
  moderationBlocked = true;
  moderationReasonText = result.blockedReason ?? 'Image generation returned no data.';
  logger.warn(
    {
      jobId: job.id,
      pageId,
      pageNumber,
      attempt: contentPolicyAttempt + 1,
      maxAttempts: MAX_CONTENT_POLICY_RETRIES + 1,
      reason: moderationReasonText,
    },
    'Illustration provider reported content block or no image data.',
  );
}
```

The existing `} catch (apiError: any) {` block (error classification, content-policy detection, retry loop) remains unchanged below this — it still catches thrown errors from `illustrator.generate()` exactly as it caught them from `ai.models.generateContent()`.

- [ ] **Step 5: Type-check**

Run: `npm run check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/workers/src/workers/illustration-generation.worker.ts
git commit -m "feat(workers): route story-page illustration through provider interface"
```

---

## Task 6: Replace the cover illustration call

**Files:**

- Modify: `apps/workers/src/workers/illustration-generation.worker.ts`

- [ ] **Step 1: Replace the cover call block**

Find the cover-illustration block (around lines 613–706). Specifically, replace the section from `const coverPrompt = [` (~line 646) through the end of the `if (coverImagePart?.inlineData?.data) { ... } else { ... }` block that handles no-data (~line 700).

Replace with:

```ts
const coverInput: IllustrationInput = {
  contentImage: { buffer: contentImageBuffer, mimeType: contentImageMimeType },
  styleRefs: coverRefBuffers,
  prompt: coverTextPrompt,
};

const coverResult = await illustrator.generate(coverInput);

if (coverResult.imageBase64) {
  let coverBuffer = Buffer.from(coverResult.imageBase64, 'base64');

  // Upscale for print
  coverBuffer = await upscaleForPrint(coverBuffer);

  // Apply logo overlay to cover illustration
  coverBuffer = await addLogoToTitlePage(coverBuffer);

  // Upload cover illustration to Cloudinary
  const coverUpload = await new Promise<any>((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          folder: `storywink/${bookId}/generated`,
          public_id: `cover_illustration`,
          overwrite: true,
          tags: [`book:${bookId}`, `cover`, `style:${styleKey}`],
          resource_type: 'image',
        },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      )
      .end(coverBuffer);
  });

  if (coverUpload?.secure_url) {
    await prisma.book.update({
      where: { id: bookId },
      data: { coverImageUrl: coverUpload.secure_url },
    });
    console.log(
      `[IllustrationWorker] Cover illustration generated and stored: ${coverUpload.secure_url}`,
    );
    logger.info(
      { jobId: job.id, bookId, coverUrl: coverUpload.secure_url },
      'Cover illustration stored in Book.coverImageUrl',
    );
  }
} else {
  logger.warn(
    { jobId: job.id, bookId, pageNumber, reason: coverResult.blockedReason },
    'Cover illustration generation returned no image data',
  );
}
```

The surrounding try/catch (the outer `try { ... } catch (coverError: any) {` block and the cover-style reference fetching logic above it) remains unchanged.

- [ ] **Step 2: Type-check**

Run: `npm run check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/workers/illustration-generation.worker.ts
git commit -m "feat(workers): route cover illustration through provider interface"
```

---

## Task 7: Extend transient-error classification for OpenAI

**Files:**

- Modify: `apps/workers/src/workers/illustration-generation.worker.ts`

- [ ] **Step 1: Update isTransientError**

Find the `isTransientError` function (lines 20–44) and add OpenAI-specific transient markers to the `transientPatterns` array. Replace the entire function with:

```ts
function isTransientError(error: Error): boolean {
  const message = error.message.toLowerCase();
  const transientPatterns = [
    'fetch failed',
    'etimedout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'socket hang up',
    'network error',
    'timeout',
    'aborted',
    'unavailable',
    '503',
    'internal error',
    'deadline exceeded',
    'rate limit',
    '429',
    'quota exceeded',
    'resource exhausted',
    // Image processing errors (retry-able)
    'sharp',
    // OpenAI transient markers (gpt-image-2)
    'rate_limit_exceeded',
    'server_error',
    '500',
    '502',
    '504',
    'engine overloaded',
  ];
  // Non-transient OpenAI errors: billing / account issues should fail fast.
  const nonTransientPatterns = ['insufficient_quota', 'invalid_api_key', 'account_deactivated'];
  if (nonTransientPatterns.some((p) => message.includes(p))) return false;
  return transientPatterns.some((pattern) => message.includes(pattern));
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check-types`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/workers/src/workers/illustration-generation.worker.ts
git commit -m "feat(workers): classify OpenAI transient vs permanent errors"
```

---

## Task 8: Full verification pass

- [ ] **Step 1: Repo-wide type-check**

Run from repo root: `npm run check-types`
Expected: PASS across all workspaces.

- [ ] **Step 2: Lint**

Run from repo root: `npm run lint`
Expected: PASS. Fix any rule violations introduced by the new files (prefer fixing over disabling rules).

- [ ] **Step 3: Format check**

Run from repo root: `npm run format`
Expected: PASS, or auto-formatting applied with no diff.

- [ ] **Step 4: Build the workers app**

Run: `cd apps/workers && npm run build`
Expected: `dist/index.js` generated without errors.

- [ ] **Step 5: Verify no stale GoogleGenAI import**

Run: `grep -rn "GoogleGenAI\|@google/genai" apps/workers/src/workers/illustration-generation.worker.ts`
Expected: no matches. (`@google/genai` still imported by `gemini.ts` — that is intentional.)

- [ ] **Step 6: Verify interface is used in both call sites**

Run: `grep -n "illustrator.generate" apps/workers/src/workers/illustration-generation.worker.ts`
Expected: exactly 2 matches (story page, cover).

- [ ] **Step 7: Commit any formatting adjustments**

```bash
git add -A
git status
# If any formatter auto-fix was applied:
git commit -m "chore: formatting after illustrator refactor"
# If nothing to commit, skip.
```

---

## Task 9: Update documentation

**Files:**

- Modify: `apps/workers/CLAUDE.md`
- Modify: `CLAUDE.md` (root)

- [ ] **Step 1: Update workers CLAUDE.md stack line**

In `apps/workers/CLAUDE.md`, replace:

```markdown
- Gemini 3 Pro Image for illustrations
```

with:

```markdown
- Gemini 3.1 Flash Image or OpenAI gpt-image-2 for illustrations (selected via ILLUSTRATION_PROVIDER env)
```

And add a new section at the end of the file:

```markdown
## Illustration Providers

The illustrator worker supports two image models, selected at startup by `ILLUSTRATION_PROVIDER`:

- `gemini` (default) — `gemini-3.1-flash-image-preview` via `@google/genai`. Requires `GOOGLE_API_KEY`.
- `openai` — `gpt-image-2` via `openai` SDK (`images.edit` endpoint). Requires `OPENAI_API_KEY`. Optional `OPENAI_IMAGE_QUALITY` (low/medium/high/auto, default high) and `OPENAI_THINKING` (true/false, default false).

Provider implementations live in `src/lib/illustrators/`. Each implements the `IllustrationProvider` interface. The worker calls `illustrator.generate()` — it does not know which provider is running.

Flipping the env var on Railway redeploys the workers service and takes effect immediately. Rollback is a single variable change.
```

- [ ] **Step 2: Update root CLAUDE.md**

In the root `CLAUDE.md`, replace:

```markdown
AI-powered platform transforming photos into personalized children's picture books. Uses GPT-5.1 for story generation and Gemini 3 Pro Image for illustrations.
```

with:

```markdown
AI-powered platform transforming photos into personalized children's picture books. Uses GPT-5.1 for story generation. Illustrations use Gemini 3.1 Flash Image or OpenAI gpt-image-2, selectable via the `ILLUSTRATION_PROVIDER` env var on the workers service.
```

- [ ] **Step 3: Commit**

```bash
git add apps/workers/CLAUDE.md CLAUDE.md
git commit -m "docs: document illustrator provider flag"
```

---

## Task 10: Manual staging smoke test (human-run)

This task is **not automatable** — it runs against live Railway infra and produces real Cloudinary uploads. Execute it when the code changes are deployed to staging.

- [ ] **Step 1: Deploy to staging with provider=gemini**

Push the branch, wait for Railway staging to redeploy workers service.
In Railway staging variables for `workers`: confirm `ILLUSTRATION_PROVIDER` is **unset or `gemini`**, `GOOGLE_API_KEY` present.

Create a test book in staging, let it finish generating. Confirm pages render exactly as they did on main. No behavior change expected.

- [ ] **Step 2: Add OpenAI config and flip flag**

In Railway staging, on the `workers` service:

- Set `OPENAI_API_KEY` to a valid key.
- Set `ILLUSTRATION_PROVIDER=openai`.
- Leave `OPENAI_IMAGE_QUALITY` unset (defaults to `high`).
- Leave `OPENAI_THINKING` unset (defaults to `false`).

Wait for auto-redeploy. Tail logs:

```bash
railway logs --service workers
```

Expected at startup: one log line matching `Illustration provider selected` with `provider: 'openai'`.

- [ ] **Step 3: Generate a test book with gpt-image-2**

Use the same source photos as Step 1's control book. Let the book fully finish (all story pages + cover).

Verify:

- [ ] All pages have `generatedImageUrl` populated in DB.
- [ ] Cover has `Book.coverImageUrl` set with logo overlay visible.
- [ ] Cloudinary folder `storywink/<bookId>/generated/` contains one image per page plus `cover_illustration`.
- [ ] No pages stuck in `FLAGGED` unless content genuinely violated policy.
- [ ] Style consistency across pages (same model applied to all).

- [ ] **Step 4: Side-by-side quality comparison**

Generate the same book on both providers using the same source photos. Compare:

- Character-identity consistency across pages.
- Style-reference fidelity.
- Cover text legibility (gpt-image-2 should be noticeably better here — this is its headline improvement).
- Overall "looks like a real children's book" impression.

- [ ] **Step 5: Rollback test**

In Railway staging, change `ILLUSTRATION_PROVIDER` back to `gemini`. Wait for redeploy. Generate one more test book. Confirm behavior is identical to Step 1 — full rollback via env var alone, no code revert.

- [ ] **Step 6: Document findings**

Write a short note in the PR description summarizing:

- Did gpt-image-2 output justify ~5-8× per-image cost?
- Any content-policy blocks encountered?
- Decision: flip production or keep on Gemini.

No commit required for this task — findings live in the PR.

---

## Rollback

At any point after merge, setting `ILLUSTRATION_PROVIDER=gemini` (or unsetting it) on the Railway `workers` service reverts to the prior image model with no code change. The OpenAI provider code remains in the repo, dormant.

If a code revert is required, `git revert` the "feat(workers): route story-page illustration through provider interface" and "feat(workers): route cover illustration through provider interface" commits — those are the only behavior-changing integration points.

# gpt-image-2 Illustrator Provider — Design

**Date:** 2026-04-22
**Author:** via Claude Code brainstorming
**Status:** Draft — awaiting approval

## Summary

Add OpenAI `gpt-image-2` (released 2026-04-21) as an alternative illustration provider alongside the current `gemini-3.1-flash-image-preview`. Selection happens at worker startup via an env flag so we can A/B test and roll back instantly without a code deploy.

## Goals

- Ship a runtime-switchable image model for the illustrator worker.
- Preserve all existing behavior: QC retry loop, content-policy retry loop, BullMQ transient retry, upscale-to-print, logo overlay on covers, Cloudinary upload, DB updates.
- Keep visual consistency: story-page and cover illustrations always use the same provider within a single book.
- Isolate provider-specific code behind a small interface so each provider is independently testable.

## Non-Goals

- Not touching the story-writer worker (GPT-5.1 text generation). Unrelated system.
- Not building a generic multi-provider platform. Two providers, clean strategy pattern, nothing more.
- Not changing Prisma schema. Nothing persisted about which provider generated an image.
- Not changing the prompt template in `packages/shared/src/prompts/illustration/` — the same prompt is used for both providers.
- Not adding per-call-type provider routing (story vs. cover). One flag, both move together.

## Architecture

### New module: `apps/workers/src/lib/illustrators/`

```
apps/workers/src/lib/illustrators/
  index.ts              # getIllustrator() factory, reads env, returns instance
  types.ts              # IllustrationProvider interface + shared types
  gemini.ts             # GeminiProvider (extracted from current worker)
  openai.ts             # OpenAIProvider (new)
```

### Interface

```ts
export interface IllustrationInput {
  contentImage: { buffer: Buffer; mimeType: string };
  styleRefs: Array<{ buffer: Buffer; mimeType: string }>;
  prompt: string;
  // Providers decide how to encode these; gemini uses inlineData, openai uses multipart files.
}

export interface IllustrationOutput {
  // Mutually exclusive — either image OR a block reason, never both.
  imageBase64?: string;
  blockedReason?: string; // content policy or safety block
}

export interface IllustrationProvider {
  name: 'gemini' | 'openai';
  generate(input: IllustrationInput): Promise<IllustrationOutput>;
}
```

Provider methods throw on transient/unexpected errors (network, 5xx, malformed response). They return `{ blockedReason }` for content-policy blocks. The worker's existing retry logic distinguishes these two cases today and will continue to.

### Factory

```ts
// apps/workers/src/lib/illustrators/index.ts
export function getIllustrator(): IllustrationProvider {
  const provider = process.env.ILLUSTRATION_PROVIDER ?? 'gemini';
  if (provider === 'openai') return new OpenAIProvider();
  if (provider === 'gemini') return new GeminiProvider();
  throw new Error(`Unknown ILLUSTRATION_PROVIDER: ${provider}`);
}
```

Factory is called **once at worker startup** (not per-job) — the resulting instance is reused for every job in that process. Flipping the flag requires a worker redeploy, which is fine because Railway env changes auto-redeploy.

### Worker changes (`illustration-generation.worker.ts`)

- Remove direct `GoogleGenAI` import and the two inline `ai.models.generateContent(...)` calls (~lines 434–458 for story page, ~lines 654–699 for cover).
- Replace with `illustrator.generate({ contentImage, styleRefs, prompt })`.
- Keep everything else: fetch loop for images, prompt construction, moderation branching, QC loop, upscale, Cloudinary upload, logo overlay, DB updates, BullMQ error classification.
- `isTransientError` gains OpenAI-specific markers: `rate_limit_exceeded`, `insufficient_quota` (NOT transient — fail fast), OpenAI 5xx codes.

### Gemini provider implementation

Straight lift-and-shift from current worker lines ~400–458. Reads `GOOGLE_API_KEY`. No behavior change.

### OpenAI provider implementation

- SDK: `openai` v6.25 (already in deps).
- Endpoint: `client.images.edit` (the `/v1/images/edits` endpoint — accepts multiple input images, which we need for content photo + style refs).
- Request shape:
  ```ts
  const response = await client.images.edit({
    model: 'gpt-image-2',
    image: [contentImageFile, ...styleRefFiles],  // content photo first, style refs after
    prompt,
    size: '2048x2048',
    quality: process.env.OPENAI_IMAGE_QUALITY ?? 'high',    // low | medium | high | auto
    // Thinking mode: controlled by OPENAI_THINKING=true|false
    // At time of writing, SDK surface for thinking is tentative; if the param
    // name shifts post-release, resolve by checking the installed SDK types.
    // Default thinking=false to avoid per-image reasoning token cost.
  });
  const imageBase64 = response.data?.[0]?.b64_json;
  ```
- Buffers are converted to `File`-like objects via `openai.toFile(buffer, filename, { type: mimeType })`.
- Image ordering matters: content photo MUST be first (mirrors the Gemini ordering and prompt expectations).
- Content-policy detection: OpenAI returns a 400 with `error.code === 'moderation_blocked'` or `'content_policy_violation'`. Catch, return `{ blockedReason }` — don't throw.
- Missing `b64_json` in response → return `{ blockedReason: 'Image generation returned no data' }`.

### New environment variables

| Var | Values | Default | Scope |
|---|---|---|---|
| `ILLUSTRATION_PROVIDER` | `gemini` \| `openai` | `gemini` | workers service |
| `OPENAI_API_KEY` | secret | — | workers service (required when provider=openai) |
| `OPENAI_IMAGE_QUALITY` | `low` \| `medium` \| `high` \| `auto` | `high` | workers service |
| `OPENAI_THINKING` | `true` \| `false` | `false` | workers service |

Validation: at worker startup, if `ILLUSTRATION_PROVIDER=openai` and `OPENAI_API_KEY` is missing, throw immediately with a clear message — fail fast, don't wait for the first job.

## Data Flow (unchanged except for one seam)

```
Job arrives → fetch content image → fetch style refs → build prompt
           → illustrator.generate(...)  ← ONLY PROVIDER-SPECIFIC SEAM
           → (if blocked) retry up to 3x with jitter → mark FLAGGED
           → (if success) upscale → upload to Cloudinary → update Page
           → (if title page) repeat with cover refs → logo overlay → update Book.coverImageUrl
```

## Error Handling

| Scenario | Current (Gemini) | New (OpenAI) | Worker behavior |
|---|---|---|---|
| Network / 5xx / timeout | throws, transient | throws, transient | BullMQ retries |
| Rate limit (429) | throws, transient | throws, transient | BullMQ retries |
| Content policy block | empty response → return `{blockedReason}` | 400 `moderation_blocked` → return `{blockedReason}` | Content-policy retry loop (3x), then FLAGGED |
| Missing image data | return `{blockedReason}` | return `{blockedReason}` | Same as above |
| Invalid API key | throws | throws | Job fails, not retried (non-transient error message) |
| Quota exhausted | throws, transient per current patterns | `insufficient_quota` → throw non-transient | Fail fast — retrying won't help |

## Testing

- Unit tests per provider: mock the SDK, assert that `generate()` returns the expected shape for (a) success, (b) content-policy block, (c) transient error (throws).
- Worker-level integration: existing tests around retry/QC logic keep passing — they only see the interface, not the provider.
- Manual staging smoke test: flip `ILLUSTRATION_PROVIDER=openai` in staging, create a test book, verify all 10 pages + cover render, check Cloudinary uploads, spot-check style fidelity against a Gemini-generated control book.

## Rollout

1. **PR merge, provider=gemini everywhere.** Zero behavior change. Just the abstraction + new provider code sitting dormant.
2. **Staging env flip to openai.** Generate 2–3 real books. Compare side-by-side against Gemini outputs for the same source photos. Evaluate: style fidelity, character identity consistency, cover text legibility, cost per book.
3. **Production decision point.** If GPT output quality justifies the ~5–8× cost increase per image (estimated ~$1 → ~$5–7 per book), flip production. Otherwise keep Gemini and revisit after OpenAI pricing changes.
4. **Rollback path.** Single Railway variable change (`ILLUSTRATION_PROVIDER=gemini`) auto-redeploys workers with previous behavior. No code revert needed.

## Cost Estimate (per book, 10 story pages + 1 cover = 11 API calls)

| Provider | Per-image (2K high) | Per-book |
|---|---|---|
| Gemini 3.1 Flash Image (current) | ~$0.08 | ~$0.88 |
| gpt-image-2 (standard mode) | ~$0.42 | ~$4.60 |
| gpt-image-2 (thinking mode) | ~$0.60+ | ~$6.60+ |

## Open Questions / Risks

- **OpenAI SDK surface for thinking mode**: the `reasoning` / `thinking` param name may not be finalized across all SDK versions on day-1 of release. Implementation task will verify the installed v6.25 SDK's actual parameter name and add a TODO to upgrade SDK if needed.
- **Style-reference fidelity**: gpt-image-2's interpretation of style-reference images may differ from Gemini's. Mitigation: the env flag is the mitigation — we can observe and rollback.
- **Cover logo overlay**: `addLogoToTitlePage` operates on the PNG buffer after generation. Provider-agnostic, no change needed.

## Files Touched (forecast)

- `apps/workers/src/lib/illustrators/{index,types,gemini,openai}.ts` — new.
- `apps/workers/src/workers/illustration-generation.worker.ts` — two call sites replaced, Google SDK import removed.
- `apps/workers/src/lib/illustrators/*.test.ts` — new unit tests.
- No changes to `packages/shared`, `apps/web`, `apps/api`, or Prisma schema.

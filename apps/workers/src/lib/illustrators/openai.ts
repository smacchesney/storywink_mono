import OpenAI, { toFile } from 'openai';
import pino from 'pino';
import { IMAGE_OPENAI_TIMEOUT_MS } from '../../config/models.js';
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

// Default stays on the launch id. OPENAI_IMAGE_MODEL exists so a newer image
// model (verified against the live /v1/models endpoint at flip time) is an env
// flip with instant rollback — the same operational pattern as
// GEMINI_IMAGE_MODEL and ILLUSTRATION_PROVIDER. Never hardcode an unverified id.
const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2';

export class OpenAIProvider implements IllustrationProvider {
  readonly name = 'openai' as const;
  readonly modelId: string;
  private readonly client: OpenAI;
  private readonly quality: QualityLevel;
  private readonly thinking: boolean;

  /**
   * `quality` override serves the QC escalation ladder (gpt-image-2 at
   * medium for a page's final re-render); without it OPENAI_IMAGE_QUALITY
   * applies as before.
   *
   * `modelId` override serves the escalation ladder too (a gpt- escalation id
   * from ILLUSTRATION_ESCALATION_MODEL); without it OPENAI_IMAGE_MODEL / the
   * launch default applies.
   */
  constructor(opts?: { quality?: QualityLevel; modelId?: string }) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when ILLUSTRATION_PROVIDER=openai');
    }
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: IMAGE_OPENAI_TIMEOUT_MS,
    });
    this.quality = opts?.quality ?? readQuality();
    this.thinking = readThinking();
    this.modelId = opts?.modelId || process.env.OPENAI_IMAGE_MODEL || DEFAULT_OPENAI_IMAGE_MODEL;
  }

  async generate(input: IllustrationInput): Promise<IllustrationOutput> {
    const filenameFor = (mime: string, index: number) => {
      const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
      return `ref-${index}.${ext}`;
    };

    // Content photo MUST be first, then character refs (sheets / interior
    // render), then style refs — mirrors Gemini ordering and the prompt's
    // role-by-position line.
    const characterRefs = input.characterRefs ?? [];
    const imageFiles = await Promise.all([
      toFile(input.contentImage.buffer, filenameFor(input.contentImage.mimeType, 0), {
        type: input.contentImage.mimeType,
      }),
      ...characterRefs.map((ref, idx) =>
        toFile(ref.buffer, filenameFor(ref.mimeType, idx + 1), { type: ref.mimeType }),
      ),
      ...input.styleRefs.map((ref, idx) =>
        toFile(ref.buffer, filenameFor(ref.mimeType, characterRefs.length + idx + 1), {
          type: ref.mimeType,
        }),
      ),
    ]);

    const { quality, thinking } = this;

    try {
      const { data: response, response: raw } = await this.client.images
        .edit({
          model: this.modelId,
          image: imageFiles,
          prompt: input.prompt,
          size: '2048x2048',
          quality,
          // NOTE: as of gpt-image-2 launch (2026-04-21), the "thinking" mode parameter
          // name is still settling in the SDK. Pass via generic `reasoning` field if
          // set; fall back to omitting it (standard mode) if SDK rejects.
          ...(thinking ? { reasoning: { effort: 'medium' } } : {}),
        } as any)
        .withResponse();

      // Rate-limit headroom (headers may be absent) — the observability input
      // for raising ILLUSTRATION_CONCURRENCY safely.
      const remainingImages = raw.headers.get('x-ratelimit-remaining-images');
      const remainingTokens = raw.headers.get('x-ratelimit-remaining-tokens');
      if (remainingImages !== null || remainingTokens !== null) {
        logger.info(
          {
            provider: 'openai',
            ...(remainingImages !== null ? { remainingImages } : {}),
            ...(remainingTokens !== null ? { remainingTokens } : {}),
          },
          'OpenAI images rate-limit headroom',
        );
      }

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

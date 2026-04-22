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
        // set; fall back to omitting it (standard mode) if SDK rejects.
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

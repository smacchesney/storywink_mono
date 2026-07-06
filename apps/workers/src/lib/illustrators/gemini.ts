import { GoogleGenAI } from '@google/genai';
import pino from 'pino';
import type { IllustrationInput, IllustrationOutput, IllustrationProvider } from './types.js';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

// Default stays on the production-proven preview id. GEMINI_IMAGE_MODEL exists
// so the GA migration (gemini-3.1-flash-image) is an env flip with instant
// rollback — the same operational pattern as ILLUSTRATION_PROVIDER.
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';

export class GeminiProvider implements IllustrationProvider {
  readonly name = 'gemini' as const;
  readonly modelId: string;
  private readonly client: GoogleGenAI;

  /**
   * `modelId` override serves the QC escalation ladder (e.g.
   * gemini-3-pro-image for a page's final re-render); without it the
   * env/default selection applies.
   */
  constructor(opts?: { modelId?: string }) {
    if (!process.env.GOOGLE_API_KEY) {
      throw new Error('GOOGLE_API_KEY is required when ILLUSTRATION_PROVIDER=gemini');
    }
    this.client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
    this.modelId = opts?.modelId || process.env.GEMINI_IMAGE_MODEL || DEFAULT_GEMINI_IMAGE_MODEL;
  }

  async generate(input: IllustrationInput): Promise<IllustrationOutput> {
    // Order matters: content image first, then character refs (sheets /
    // interior render), then style refs, then text prompt. Prompts in
    // packages/shared name each image's role by this position.
    const contents = [
      {
        inlineData: {
          mimeType: input.contentImage.mimeType,
          data: input.contentImage.buffer.toString('base64'),
        },
      },
      ...(input.characterRefs ?? []).map((ref) => ({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.buffer.toString('base64'),
        },
      })),
      ...input.styleRefs.map((ref) => ({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.buffer.toString('base64'),
        },
      })),
      { text: input.prompt },
    ];

    const result = await this.client.models.generateContent({
      model: this.modelId,
      contents,
      config: {
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          aspectRatio: '1:1',
          imageSize: '2K',
        },
      },
    });

    const imagePart = result?.candidates?.[0]?.content?.parts?.find(
      (part: any) => part.inlineData,
    );

    if (imagePart?.inlineData?.data) {
      return { imageBase64: imagePart.inlineData.data };
    }

    logger.warn({ provider: 'gemini' }, 'Gemini response contained no image data');
    return {
      blockedReason: 'Image generation failed or blocked by content policy (no image data in response).',
    };
  }
}

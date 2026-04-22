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

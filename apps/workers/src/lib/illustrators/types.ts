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
  /**
   * Character reference images (validated turnaround sheets; on cover calls
   * also the approved interior render). Sent BETWEEN the content photo and
   * the style refs — neither SDK has typed reference fields, so this
   * role-labeled ordering (named by position in the prompt) IS the reference
   * mechanism. The prompt builder must be told the counts so its role line
   * matches this ordering.
   */
  characterRefs?: IllustrationImageInput[];
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
   * Exact model id sent to the provider API (e.g. "gemini-3.1-flash-image-preview",
   * "gpt-image-2"). Stamped onto Page.lastRenderModel at render time so QC rows
   * are attributable — the finalize worker cannot infer which model drew a page.
   */
  readonly modelId: string;
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

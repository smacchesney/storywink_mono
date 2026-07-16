import pino from 'pino';
import { providerNameForModel } from '../escalation.js';
import { GeminiProvider } from './gemini.js';
import { OpenAIProvider } from './openai.js';
import type { IllustrationProvider, IllustrationProviderName } from './types.js';

export type {
  IllustrationProvider,
  IllustrationInput,
  IllustrationImageInput,
  IllustrationOutput,
} from './types.js';

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
      model: cachedProvider.modelId,
      quality: process.env.OPENAI_IMAGE_QUALITY ?? '(default)',
      thinking: process.env.OPENAI_THINKING ?? 'false',
    },
    'Illustration provider selected',
  );
  return cachedProvider;
}

const escalationProviders = new Map<string, IllustrationProvider>();

/**
 * Returns a provider for a single escalated render (QC escalation ladder):
 * gpt-* model ids run on OpenAI at quality medium; anything else is a Gemini
 * model id passed straight through. Memoized per model id, independent of the
 * default provider cache. Throws when the target provider's API key is
 * missing — the caller falls back to the default illustrator.
 */
export function getEscalationIllustrator(model: string): IllustrationProvider {
  const cached = escalationProviders.get(model);
  if (cached) return cached;

  const provider =
    providerNameForModel(model) === 'openai'
      ? // Pass the resolved gpt- id through so ILLUSTRATION_ESCALATION_MODEL
        // actually reaches the provider (constructor default would otherwise
        // silently win). Escalation still runs OpenAI at quality medium.
        new OpenAIProvider({ quality: 'medium', modelId: model })
      : new GeminiProvider({ modelId: model });
  escalationProviders.set(model, provider);
  logger.info(
    { provider: provider.name, model: provider.modelId },
    'Escalation illustration provider created',
  );
  return provider;
}

let cachedGeminiFallback: IllustrationProvider | null = null;

/**
 * Gemini provider used ONLY for the dark per-page content-policy fallback
 * (ILLUSTRATION_OPENAI_FALLBACK_GEMINI). Runs the GA/env Gemini image model
 * (GEMINI_IMAGE_MODEL / default), independent of the primary-provider cache so
 * it stays available even when ILLUSTRATION_PROVIDER=openai. Memoized; throws
 * when GOOGLE_API_KEY is missing — the caller treats that as "no fallback".
 */
export function getGeminiFallbackIllustrator(): IllustrationProvider {
  if (cachedGeminiFallback) return cachedGeminiFallback;
  cachedGeminiFallback = new GeminiProvider();
  return cachedGeminiFallback;
}

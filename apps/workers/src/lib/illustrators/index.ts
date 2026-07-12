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
      ? new OpenAIProvider({ quality: 'medium' })
      : new GeminiProvider({ modelId: model });
  escalationProviders.set(model, provider);
  logger.info(
    { provider: provider.name, model: provider.modelId },
    'Escalation illustration provider created',
  );
  return provider;
}

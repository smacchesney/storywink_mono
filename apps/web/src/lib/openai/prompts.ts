// Re-export from shared package
export {
  STORY_GENERATION_SYSTEM_PROMPT as systemPrompt,
  createVisionStoryGenerationPrompt,
} from '@storywink/shared';

export type {
  StoryGenerationInput,
  StoryPageResponse,
  StoryResponse,
  WinkifyStoryResponse, // Backwards compatibility alias
} from '@storywink/shared';
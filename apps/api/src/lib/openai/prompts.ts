// Re-export from shared package
export {
  createVisionStoryGenerationPrompt,
  STORY_GENERATION_SYSTEM_PROMPT as systemPrompt,
} from "@storywink/shared";

export type {
  StoryGenerationInput,
  StoryPageResponse,
  StoryResponse,
  WinkifyStoryResponse, // Backwards compatibility alias
} from "@storywink/shared";

import OpenAI from 'openai';

// Ensure the API key is provided via environment variables
if (!process.env.OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY environment variable');
}

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  // You can add other default configurations here if needed
});

export default openai;

// Optional: Define reusable functions for specific API calls below
// e.g., function generateStoryText(...) { ... } 
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { db as prisma } from '@/lib/db';
import { BookStatus } from '@prisma/client';
import { z } from 'zod';
import OpenAI from 'openai';
import logger from '@/lib/logger';
import {
  STORY_GENERATION_SYSTEM_PROMPT,
} from '@storywink/shared/prompts/story';
import {
  optimizeCloudinaryUrlForVision,
  convertHeicToJpeg,
} from '@storywink/shared/utils';

const requestSchema = z.object({
  bookId: z.string().cuid(),
  pageId: z.string().cuid(),
});

// Simplified JSON schema for single-page response
const SINGLE_PAGE_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    text: {
      type: 'string',
      description: 'The story text for this page (2-4 sentences, max 50 words)',
    },
    illustrationNotes: {
      type: ['string', 'null'],
      description: 'Visual effects suggestion for the illustration, or null if none',
    },
  },
  required: ['text', 'illustrationNotes'],
  additionalProperties: false,
} as const;

/**
 * POST /api/generate/story/page
 * Regenerates story text for a single page with surrounding context.
 * Used when a user replaces a flagged photo and needs new text.
 */
export async function POST(req: NextRequest) {
  try {
    const { dbUser, clerkId } = await getAuthenticatedUser();

    const body = await req.json();
    const { bookId, pageId } = requestSchema.parse(body);

    // Fetch book with all pages for context
    const book = await prisma.book.findUnique({
      where: { id: bookId, userId: dbUser.id },
      select: {
        id: true,
        title: true,
        status: true,
        language: true,
        artStyle: true,
        childName: true,
        additionalCharacters: true,
        coverAssetId: true,
        pages: {
          orderBy: { index: 'asc' },
          include: {
            asset: { select: { url: true, thumbnailUrl: true } },
          },
        },
      },
    });

    if (!book) {
      return NextResponse.json({ error: 'Book not found or access denied.' }, { status: 404 });
    }

    if (book.status !== BookStatus.PARTIAL) {
      return NextResponse.json(
        { error: `Single-page text generation only available for PARTIAL books (current: ${book.status})` },
        { status: 409 }
      );
    }

    // Find the target page
    const targetPage = book.pages.find((p) => p.id === pageId);
    if (!targetPage) {
      return NextResponse.json({ error: 'Page not found in this book.' }, { status: 404 });
    }

    // Get the photo URL for the target page
    const photoUrl = targetPage.asset?.thumbnailUrl || targetPage.asset?.url || targetPage.originalImageUrl;
    if (!photoUrl) {
      return NextResponse.json({ error: 'Page has no photo to generate text from.' }, { status: 400 });
    }

    // Get surrounding pages for narrative context (exclude title page)
    const storyPages = book.pages.filter((p) => p.assetId !== book.coverAssetId);
    const targetIndex = storyPages.findIndex((p) => p.id === pageId);

    const prevPages = storyPages.slice(Math.max(0, targetIndex - 2), targetIndex);
    const nextPages = storyPages.slice(targetIndex + 1, targetIndex + 3);

    // Build context strings
    const prevContext = prevPages
      .filter((p) => p.text)
      .map((p) => `Page ${p.pageNumber}: "${p.text}"`)
      .join('\n');

    const nextContext = nextPages
      .filter((p) => p.text)
      .map((p) => `Page ${p.pageNumber}: "${p.text}"`)
      .join('\n');

    // Build character instruction
    let characterInfo = '';
    if (book.childName) {
      characterInfo = `The main character is named "${book.childName}".`;
      const chars = book.additionalCharacters as Array<{ name: string; relationship: string }> | null;
      if (chars && chars.length > 0) {
        const charList = chars.map((c) => `"${c.name}" (${c.relationship})`).join(', ');
        characterInfo += ` Other characters: ${charList}.`;
      }
    }

    const language = book.language || 'en';
    const languageInstruction = language === 'ja'
      ? 'Write the story text in Japanese (hiragana preferred for young children). Use simple, warm language.'
      : 'Write the story text in English.';

    // Build the prompt
    const promptText = [
      `You are writing page ${targetPage.pageNumber} of a children's picture book titled "${book.title || 'My Special Story'}".`,
      characterInfo,
      languageInstruction,
      '',
      prevContext ? `## Story so far (previous pages):\n${prevContext}` : '## This is near the beginning of the story.',
      '',
      `## Your task:`,
      `Write story text for page ${targetPage.pageNumber} based on the photo provided. Write 2-4 sentences (max 50 words). The text should feel warm, playful, and natural when read aloud to a toddler.`,
      '',
      nextContext ? `## What comes after (for continuity):\n${nextContext}` : '## This is near the end of the story.',
      '',
      `Also provide brief illustrationNotes describing any visual effects or mood for the illustrator (e.g., "warm golden light", "splashing water droplets"), or null if the photo speaks for itself.`,
    ].join('\n');

    // Prepare image URL for vision
    const optimizedUrl = optimizeCloudinaryUrlForVision(convertHeicToJpeg(photoUrl));

    // Call OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const result = await openai.responses.create({
      model: 'gpt-5-mini',
      instructions: STORY_GENERATION_SYSTEM_PROMPT,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_image', image_url: optimizedUrl, detail: 'high' as const },
            { type: 'input_text', text: promptText },
          ],
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'single_page_story',
          strict: true,
          schema: SINGLE_PAGE_RESPONSE_SCHEMA as Record<string, unknown>,
        },
      },
    });

    const responseText = result.output_text;
    if (!responseText) {
      logger.error({ bookId, pageId }, 'API: No text in LLM response for single-page generation');
      return NextResponse.json({ error: 'Failed to generate story text' }, { status: 500 });
    }

    const parsed = JSON.parse(responseText) as { text: string; illustrationNotes: string | null };

    // Update the page with generated text
    await prisma.page.update({
      where: { id: pageId },
      data: {
        text: parsed.text,
        illustrationNotes: parsed.illustrationNotes,
        textConfirmed: false,
      },
    });

    logger.info(
      { clerkId, dbUserId: dbUser.id, bookId, pageId, textLength: parsed.text.length },
      'API: Single-page text generated successfully'
    );

    return NextResponse.json({
      text: parsed.text,
      illustrationNotes: parsed.illustrationNotes,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: 'Invalid request data', details: error.errors }, { status: 400 });
    }

    if (
      error instanceof Error &&
      (error.message.includes('not authenticated') ||
        error.message.includes('ID mismatch') ||
        error.message.includes('primary email not found'))
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.error({ error }, 'API: Error in single-page text generation');
    return NextResponse.json({ error: 'Failed to generate story text' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { z } from 'zod';
import { db as prisma } from '@/lib/db';
import logger from '@/lib/logger';
import { getAuthenticatedUser } from '@/lib/db/ensureUser';
import { avatarsEnabled, storyHelperEnabled } from '@/lib/avatars';
import { checkRateLimit } from '@/lib/rateLimit';
import { AVATAR_STORY_PAGE_LENGTHS, PREMISE_MAX_CHARS } from '@/lib/avatar-story';
import {
  sanitizeStoryProposal,
  STORY_PROPOSAL_SYSTEM_PROMPT,
  buildStoryProposalPrompt,
} from '@/lib/story-helper';

// Perception tier — the same gpt-5-mini the detect route runs on.
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-5-mini';

// Server-written funnel row (NOT a client track() event, so it is not in
// CLIENT_EVENT_NAMES). The workers' weekly cleanup strips its props after 30
// days — the string is duplicated there because the shared package is frozen
// for X11 v1.
const STORY_PROPOSAL_EVENT = 'story_proposal';

const proposeRequestSchema = z.object({
  cast: z
    .array(
      z.object({
        name: z.string().max(120),
        kind: z.enum(['CHILD', 'ADULT', 'PET', 'TOY']),
        isStar: z.boolean(),
      }),
    )
    .min(1)
    .max(6),
  premise: z.string().trim().min(1).max(PREMISE_MAX_CHARS),
  pageLength: z
    .number()
    .int()
    .refine((n): n is (typeof AVATAR_STORY_PAGE_LENGTHS)[number] =>
      (AVATAR_STORY_PAGE_LENGTHS as readonly number[]).includes(n),
    ),
  language: z.enum(['en', 'ja']).default('en'),
});

// Strict json_schema: NO min/max keywords (strict mode rejects them). Plain
// strings and an unbounded string array, every property required,
// additionalProperties false. Every bound lives in sanitizeStoryProposal.
const STORY_PROPOSAL_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    storyline: { type: 'string' },
    alternates: { type: 'array', items: { type: 'string' } },
  },
  required: ['storyline', 'alternates'],
  additionalProperties: false,
} as const;

/**
 * D3: proposal-only story helper. One gpt-5-mini call turns the parent's raw
 * spark into a recognisable storyline plus two alternates. Text only — no
 * photos, no character storage, no worker changes. The whole surface is
 * fail-open at the caller: any non-2xx here makes the wizard skip to length
 * with the raw premise.
 */
export async function POST(request: NextRequest) {
  if (!avatarsEnabled() || !storyHelperEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const { dbUser } = await getAuthenticatedUser();

    // A money route (one gpt-5-mini call) — cap the burst UNCONDITIONALLY, like
    // detect and the rendition route. 20/hr is far above any real parent, and
    // checkRateLimit itself fails open if Redis is unreachable.
    const rl = await checkRateLimit(`story-propose:${dbUser.id}`, 20, 3600);
    if (!rl.allowed) {
      logger.warn({ dbUserId: dbUser.id }, 'Rate limit exceeded: story propose');
      return NextResponse.json(
        { error: "You're going very quickly. Please wait a little while and try again." },
        { status: 429 },
      );
    }

    const parsed = proposeRequestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const input = parsed.data;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
      model: ANALYSIS_MODEL,
      input: [
        { role: 'system', content: [{ type: 'input_text', text: STORY_PROPOSAL_SYSTEM_PROMPT }] },
        { role: 'user', content: [{ type: 'input_text', text: buildStoryProposalPrompt(input) }] },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'story_proposal',
          strict: true,
          schema: STORY_PROPOSAL_RESPONSE_SCHEMA as unknown as Record<string, unknown>,
        },
      },
    });

    // Model output is untrusted — every bound is enforced here, not in the schema.
    const proposal = sanitizeStoryProposal(JSON.parse(response.output_text));
    if (!proposal.storyline) {
      // A blank storyline is useless to the parent — let the caller fail open.
      return NextResponse.json({ error: 'No proposal' }, { status: 502 });
    }

    // Persist for tuning (request + sanitized result). Server-side create, so
    // it is not gated by the client-event allowlist; retention-swept after 30d.
    void prisma.appEvent
      .create({
        data: {
          name: STORY_PROPOSAL_EVENT,
          userId: dbUser.id,
          props: {
            cast: input.cast,
            premise: input.premise,
            pageLength: input.pageLength,
            language: input.language,
            storyline: proposal.storyline,
            alternates: proposal.alternates,
          },
        },
      })
      .catch((error) =>
        logger.warn({ error }, 'Story proposal telemetry write failed (non-fatal)'),
      );

    return NextResponse.json(proposal);
  } catch (error) {
    logger.error({ error }, 'Story proposal failed');
    return NextResponse.json({ error: 'Could not sketch story ideas' }, { status: 500 });
  }
}

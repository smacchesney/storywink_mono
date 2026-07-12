/**
 * POST /api/checkout/print
 *
 * Creates a Stripe Checkout session for ordering a printed book.
 * Collects shipping address and payment in one step.
 *
 * Phase 1: Singapore & Malaysia only.
 */

import { printPageCounts } from '@storywink/shared/collage';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { z } from 'zod';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { getUserLocale } from '@/i18n/locale';
import logger from '@/lib/logger';
import {
  coolifyImageUrl,
  getAllowedCountries,
  buildStripeShippingOptions,
  trackEvent,
  PRINT_PRICING,
} from '@storywink/shared';
import Stripe from 'stripe';

// Zod schema for request body validation
const checkoutSchema = z.object({
  bookId: z.string().cuid(),
  quantity: z.number().int().min(1).max(10).default(1),
});

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = checkoutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.errors },
        { status: 400 },
      );
    }

    const { bookId, quantity: qty } = parsed.data;

    // Fetch book with page count
    const book = await prisma.book.findFirst({
      where: {
        id: bookId,
        userId: user.id,
        status: { in: ['COMPLETED', 'PARTIAL'] },
      },
      include: {
        pages: {
          where: { isTitlePage: true },
          select: { generatedImageUrl: true },
          take: 1,
        },
        _count: {
          select: { pages: true },
        },
      },
    });

    if (!book) {
      return NextResponse.json(
        { error: 'Book not found or not ready for printing' },
        { status: 404 },
      );
    }

    // Pricing. Collage-aware page count so PrintOrder metadata matches the
    // PDF the worker will actually ship.
    const printedPageCount = printPageCounts(
      book._count.pages,
      process.env.COLLAGE_PAGES_ENABLED === 'true',
    ).interiorPages;
    const printCostCents = PRINT_PRICING.RETAIL_PRICE_CENTS;

    // Get cover image URL (prefer dedicated cover illustration)
    const coverImageUrl = book.coverImageUrl || book.pages[0]?.generatedImageUrl;
    const optimizedCoverUrl = coverImageUrl ? coolifyImageUrl(coverImageUrl) : undefined;

    // Build base URL for success/cancel
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Get allowed countries and shipping options from shared config
    const allowedCountries =
      getAllowedCountries() as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[];
    const shippingOptions = buildStripeShippingOptions();

    // Stripe's hosted page renders in the language the app already speaks.
    const locale = await getUserLocale();

    // Create Stripe Checkout session
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email || undefined,
      locale: locale === 'ja' ? 'ja' : 'auto',
      // Couriers call recipients for SG/MY delivery; without this Lulu
      // receives a placeholder phone number.
      phone_number_collection: {
        enabled: true,
      },
      shipping_address_collection: {
        allowed_countries: allowedCountries,
      },
      shipping_options: shippingOptions,
      line_items: [
        {
          price_data: {
            currency: PRINT_PRICING.CURRENCY,
            product_data: {
              name: `${book.title || 'Untitled Book'} - Printed Book`,
              description: `${printedPageCount} page children's book (8.5" x 8.5")`,
              images: optimizedCoverUrl ? [optimizedCoverUrl] : [],
            },
            unit_amount: printCostCents,
          },
          quantity: qty,
        },
      ],
      success_url: `${baseUrl}/orders/{CHECKOUT_SESSION_ID}/success`,
      cancel_url: `${baseUrl}/library`,
      metadata: {
        bookId: book.id,
        userId: user.id,
        quantity: qty.toString(),
        pageCount: printedPageCount.toString(),
        bookTitle: book.title || 'Untitled Book',
      },
    });

    await trackEvent(
      prisma,
      {
        name: 'print_checkout_started',
        userId: user.id,
        bookId: book.id,
        props: { quantity: qty },
      },
      logger,
    );

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    logger.error({ error }, 'Checkout session error');
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}

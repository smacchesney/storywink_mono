/**
 * POST /api/checkout/print
 *
 * Creates a Stripe Checkout session for ordering a printed book.
 * Collects shipping address and payment in one step.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { stripe, SHIPPING_OPTIONS, calculatePrintCost } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { coolifyImageUrl } from '@storywink/shared';

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const { userId: clerkUserId } = await auth();
    if (!clerkUserId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { clerkId: clerkUserId },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { bookId, quantity = 1, shippingOption = 'STANDARD' } = body;

    if (!bookId) {
      return NextResponse.json(
        { error: 'bookId is required' },
        { status: 400 }
      );
    }

    // Validate quantity
    const qty = Math.min(Math.max(1, quantity), 10);

    // Validate shipping option
    if (!['STANDARD', 'EXPRESS'].includes(shippingOption)) {
      return NextResponse.json(
        { error: 'Invalid shipping option' },
        { status: 400 }
      );
    }

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
        { status: 404 }
      );
    }

    // Calculate pricing
    const pageCount = book._count.pages;
    const printCostCents = calculatePrintCost(pageCount);

    // Get cover image URL
    const coverImageUrl = book.pages[0]?.generatedImageUrl;
    const optimizedCoverUrl = coverImageUrl ? coolifyImageUrl(coverImageUrl) : undefined;

    // Build base URL for success/cancel
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email || undefined,
      shipping_address_collection: {
        allowed_countries: ['US'],
      },
      shipping_options: [
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: SHIPPING_OPTIONS.STANDARD.rate,
              currency: 'usd',
            },
            display_name: SHIPPING_OPTIONS.STANDARD.name,
            delivery_estimate: {
              minimum: { unit: 'business_day', value: SHIPPING_OPTIONS.STANDARD.deliveryMin },
              maximum: { unit: 'business_day', value: SHIPPING_OPTIONS.STANDARD.deliveryMax },
            },
          },
        },
        {
          shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: {
              amount: SHIPPING_OPTIONS.EXPRESS.rate,
              currency: 'usd',
            },
            display_name: SHIPPING_OPTIONS.EXPRESS.name,
            delivery_estimate: {
              minimum: { unit: 'business_day', value: SHIPPING_OPTIONS.EXPRESS.deliveryMin },
              maximum: { unit: 'business_day', value: SHIPPING_OPTIONS.EXPRESS.deliveryMax },
            },
          },
        },
      ],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${book.title || 'Untitled Book'} - Printed Book`,
              description: `${pageCount} page children's book (8.5" x 8.5")`,
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
        pageCount: pageCount.toString(),
        bookTitle: book.title || 'Untitled Book',
      },
    });

    return NextResponse.json({
      sessionId: session.id,
      url: session.url,
    });
  } catch (error) {
    console.error('Checkout session error:', error);
    return NextResponse.json(
      { error: 'Failed to create checkout session' },
      { status: 500 }
    );
  }
}

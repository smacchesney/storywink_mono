/**
 * POST /api/webhooks/stripe
 *
 * Handles Stripe webhook events, primarily checkout.session.completed.
 * Creates PrintOrder records and triggers PDF generation + Lulu submission.
 */

import { NextRequest, NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import Stripe from 'stripe';

// Disable body parsing - we need the raw body for signature verification
export const runtime = 'nodejs';

async function handleCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const metadata = session.metadata;

  if (!metadata?.bookId || !metadata?.userId) {
    console.error('Missing metadata in checkout session:', session.id);
    return;
  }

  const bookId = metadata.bookId;
  const userId = metadata.userId;
  const quantity = parseInt(metadata.quantity || '1', 10);
  const pageCount = parseInt(metadata.pageCount || '0', 10);

  // Get shipping address from collected_information or customer_details
  // Note: In Stripe API 2025+, shipping is in collected_information
  const collectedShipping = (session as Stripe.Checkout.Session & {
    collected_information?: {
      shipping_details?: {
        name?: string;
        address?: Stripe.Address;
      };
    };
  }).collected_information?.shipping_details;

  const shippingAddress = collectedShipping?.address;

  if (!shippingAddress) {
    console.error('No shipping address in checkout session:', session.id);
    return;
  }

  // Determine shipping level based on selected option
  const shippingCost = session.shipping_cost;
  let shippingLevel = 'MAIL'; // default
  if (shippingCost && shippingCost.amount_total && shippingCost.amount_total >= 1500) {
    shippingLevel = 'EXPEDITED';
  }

  // Create PrintOrder record
  const printOrder = await prisma.printOrder.create({
    data: {
      userId,
      bookId,
      quantity,
      status: 'PAYMENT_COMPLETED',
      pageCount,
      stripeSessionId: session.id,
      stripePaymentId: typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id,
      totalAmount: session.amount_total || 0, // Total in cents
      currency: session.currency?.toUpperCase() || 'USD',
      shippingName: collectedShipping?.name || '',
      shippingStreet1: shippingAddress.line1 || '',
      shippingStreet2: shippingAddress.line2 || undefined,
      shippingCity: shippingAddress.city || '',
      shippingState: shippingAddress.state || '',
      shippingPostcode: shippingAddress.postal_code || '',
      shippingCountry: shippingAddress.country || 'US',
      shippingPhone: session.customer_details?.phone || undefined,
      contactEmail: session.customer_details?.email || session.customer_email || '',
    },
  });

  console.log('Created PrintOrder:', printOrder.id, 'for session:', session.id);

  // TODO: Trigger PDF generation and Lulu submission asynchronously
  // This could be done via a queue job or background process
  // For now, we'll log that this needs to happen
  console.log('PrintOrder ready for fulfillment:', {
    orderId: printOrder.id,
    bookId,
    quantity,
    shippingLevel,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing stripe-signature header' },
      { status: 400 }
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not configured');
    return NextResponse.json(
      { error: 'Webhook secret not configured' },
      { status: 500 }
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err);
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    );
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      // Only process if payment is successful
      if (session.payment_status === 'paid') {
        await handleCheckoutSessionCompleted(session);
      }
      break;
    }

    case 'checkout.session.async_payment_succeeded': {
      // Handle async payment methods (e.g., bank transfers)
      const session = event.data.object as Stripe.Checkout.Session;
      await handleCheckoutSessionCompleted(session);
      break;
    }

    case 'checkout.session.async_payment_failed': {
      // Handle failed async payments
      const session = event.data.object as Stripe.Checkout.Session;
      console.log('Async payment failed for session:', session.id);
      break;
    }

    default:
      // Unexpected event type
      console.log(`Unhandled event type: ${event.type}`);
  }

  return NextResponse.json({ received: true });
}

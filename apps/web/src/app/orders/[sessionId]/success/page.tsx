/**
 * Order Success Page
 *
 * Displayed after successful Stripe Checkout completion.
 * Shows order confirmation and next steps.
 */

import { Suspense } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getTranslations } from 'next-intl/server';
import { getStripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { coolifyImageUrl, PRINT_PRICING, SHIPPING_TIERS } from '@storywink/shared';
import { formatMoney } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Storydust } from '@/components/ui/storydust';
import { ScallopEdge } from '@/components/ui/scallop-edge';
import { CheckCircle, ArrowRight, Package } from 'lucide-react';

interface PageProps {
  params: Promise<{
    sessionId: string;
  }>;
}

async function OrderSuccessContent({ sessionId }: { sessionId: string }) {
  const tOrders = await getTranslations('orders');

  // Authenticate user
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    redirect('/sign-in');
  }

  // Get user from database
  const user = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
  });

  if (!user) {
    redirect('/sign-in');
  }

  // Database-first approach: Get the print order first (webhook already created it)
  // This ensures we can show confirmation even if Stripe API fails
  const printOrder = await prisma.printOrder.findFirst({
    where: {
      stripeSessionId: sessionId,
      userId: user.id,
    },
    include: {
      book: {
        include: {
          pages: {
            where: { isTitlePage: true },
            select: { generatedImageUrl: true },
            take: 1,
          },
        },
      },
    },
  });

  // Try to retrieve the checkout session from Stripe for additional details
  // Note: shipping_details is NOT expandable - it's a direct property
  let session = null;
  try {
    session = await getStripe().checkout.sessions.retrieve(sessionId, {
      expand: ['line_items'],
    });
  } catch (error) {
    console.error('Failed to retrieve checkout session:', error);
    // Continue with database data - don't redirect
  }

  // Verify authorization: either session belongs to user, or print order exists for user
  const sessionUserId = session?.metadata?.userId;
  if (!printOrder && sessionUserId !== user.id) {
    // Neither database nor Stripe confirms this user owns this order
    redirect('/library');
  }

  // Get book details from database or Stripe metadata
  const bookId = printOrder?.bookId || session?.metadata?.bookId;
  const bookTitle = printOrder?.book?.title || session?.metadata?.bookTitle || 'Your Book';
  const quantity = printOrder?.quantity || parseInt(session?.metadata?.quantity || '1', 10);

  // Get cover image from the included book data (prefer dedicated cover illustration)
  let coverImageUrl: string | null = null;
  if (printOrder?.book) {
    coverImageUrl =
      printOrder.book.coverImageUrl || printOrder.book.pages[0]?.generatedImageUrl || null;
  } else if (bookId) {
    // Fallback: fetch book separately if not in printOrder
    const book = await prisma.book.findFirst({
      where: { id: bookId, userId: user.id },
      include: {
        pages: {
          where: { isTitlePage: true },
          select: { generatedImageUrl: true },
          take: 1,
        },
      },
    });
    coverImageUrl = book?.coverImageUrl || book?.pages[0]?.generatedImageUrl || null;
  }

  // Format price - prefer Stripe session, fallback to database
  const totalAmountCents = session?.amount_total || printOrder?.totalAmount;
  const currency = session?.currency || printOrder?.currency || PRINT_PRICING.CURRENCY;
  const totalAmount = totalAmountCents ? formatMoney(totalAmountCents, currency) : 'N/A';

  // Delivery window derives from the shipping config so this copy can never
  // drift from what Stripe quoted at checkout.
  const shippingTier = SHIPPING_TIERS.SINGAPORE_MALAYSIA;

  // Brand restyle: the just-paid moment stays in Storywink's coral-and-cream
  // world (matches the progress screen's warm radial background).
  return (
    <div className="bg-waiting min-h-screen px-4 py-12">
      <div className="mx-auto max-w-lg">
        {/* Success Icon */}
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-20 w-20 items-center justify-center rounded-full bg-coral/10">
            <CheckCircle className="h-10 w-10 text-coral" />
          </div>
          <h1 className="mb-2 font-playful text-2xl font-bold text-[#1a1a1a]">
            {tOrders('confirmedTitle')}
          </h1>
          <p className="text-gray-600">{tOrders('confirmedBody')}</p>
        </div>

        {/* Order Details Card — cream keepsake card with a scalloped top edge */}
        <div className="relative mb-6 overflow-hidden rounded-xl bg-cream p-6 pt-8 shadow-lg">
          <ScallopEdge className="absolute inset-x-0 top-0 opacity-40" />
          {/* Book Info */}
          <div className="mb-6 flex gap-4">
            {coverImageUrl && (
              <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
                <Image
                  src={coolifyImageUrl(coverImageUrl)}
                  alt={bookTitle}
                  fill
                  sizes="96px"
                  className="object-cover"
                />
              </div>
            )}
            <div className="flex-grow">
              <h2 className="mb-1 font-playful text-lg font-semibold text-ink">{bookTitle}</h2>
              <p className="mb-1 text-sm text-gray-500">
                {tOrders('quantityLabel', { count: quantity })}
              </p>
              <p className="text-sm font-medium text-coral">
                {tOrders('totalLabel', { amount: totalAmount })}
              </p>
            </div>
          </div>

          {/* Order Number */}
          {printOrder && (
            <div className="border-t pt-4">
              <p className="text-sm text-gray-500">{tOrders('orderNumberLabel')}</p>
              <p className="font-mono text-sm font-medium">
                {printOrder.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          )}
        </div>

        {/* Next Steps */}
        <div className="mb-6 rounded-xl bg-white p-6 shadow-lg">
          <h3 className="mb-4 font-semibold text-[#1a1a1a]">{tOrders('printingTitle')}</h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-coral/10">
                  <Package className="h-4 w-4 text-coral" />
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500">
                  {tOrders('printingBody', {
                    min: shippingTier.deliveryDaysMin,
                    max: shippingTier.deliveryDaysMax,
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Link href="/library" className="block">
            <Button
              className="w-full bg-coral py-6 font-playful text-white hover:bg-coral/90"
              size="lg"
            >
              {tOrders('backToLibrary')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
          <Link href="/orders" className="block">
            <Button variant="outline" className="w-full py-6" size="lg">
              {tOrders('trackYourOrder')}
            </Button>
          </Link>
        </div>

        {/* Help Text */}
        <p className="mt-6 text-center text-sm text-gray-500">
          {tOrders('helpPrompt')}{' '}
          <a href="mailto:support@storywink.ai" className="text-coral hover:underline">
            {tOrders('contactSupport')}
          </a>
        </p>
      </div>
    </div>
  );
}

export default async function OrderSuccessPage({ params }: PageProps) {
  const { sessionId } = await params;
  const tOrders = await getTranslations('orders');

  return (
    <Suspense
      fallback={
        <div className="bg-waiting flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-12">
          <Storydust variant="twinkle" size="card" />
          <p className="font-playful text-[var(--ink-soft)]">{tOrders('settingUp')}</p>
        </div>
      }
    >
      <OrderSuccessContent sessionId={sessionId} />
    </Suspense>
  );
}

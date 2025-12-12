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
import { stripe } from '@/lib/stripe';
import { prisma } from '@/lib/prisma';
import { coolifyImageUrl } from '@storywink/shared';
import { Button } from '@/components/ui/button';
import { CheckCircle, ArrowRight, Package, Mail } from 'lucide-react';

interface PageProps {
  params: Promise<{
    sessionId: string;
  }>;
}

async function OrderSuccessContent({ sessionId }: { sessionId: string }) {
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

  // Retrieve the checkout session from Stripe
  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items', 'shipping_details'],
    });
  } catch (error) {
    console.error('Failed to retrieve checkout session:', error);
    redirect('/library');
  }

  // Verify the session belongs to this user
  const metadata = session.metadata;
  if (metadata?.userId !== user.id) {
    redirect('/library');
  }

  // Get book details
  const bookId = metadata?.bookId;
  const bookTitle = metadata?.bookTitle || 'Your Book';
  const quantity = parseInt(metadata?.quantity || '1', 10);

  let coverImageUrl: string | null = null;
  if (bookId) {
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
    coverImageUrl = book?.pages[0]?.generatedImageUrl || null;
  }

  // Get the print order
  const printOrder = await prisma.printOrder.findFirst({
    where: {
      stripeSessionId: sessionId,
      userId: user.id,
    },
  });

  // Format price
  const totalAmount = session.amount_total
    ? `$${(session.amount_total / 100).toFixed(2)}`
    : 'N/A';

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-50 to-white py-12 px-4">
      <div className="max-w-lg mx-auto">
        {/* Success Icon */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 mb-4">
            <CheckCircle className="w-10 h-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Order Confirmed!
          </h1>
          <p className="text-gray-600">
            Thank you for your order. We&apos;re preparing your book for printing.
          </p>
        </div>

        {/* Order Details Card */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          {/* Book Info */}
          <div className="flex gap-4 mb-6">
            {coverImageUrl && (
              <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
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
              <h2 className="font-semibold text-lg text-gray-900 mb-1">
                {bookTitle}
              </h2>
              <p className="text-sm text-gray-500 mb-1">
                Quantity: {quantity}
              </p>
              <p className="text-sm font-medium text-[#F76C5E]">
                Total: {totalAmount}
              </p>
            </div>
          </div>

          {/* Order Number */}
          {printOrder && (
            <div className="border-t pt-4">
              <p className="text-sm text-gray-500">Order Number</p>
              <p className="font-mono text-sm font-medium">
                {printOrder.id.slice(0, 8).toUpperCase()}
              </p>
            </div>
          )}
        </div>

        {/* Next Steps */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">What&apos;s Next?</h3>
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <Mail className="w-4 h-4 text-blue-600" />
                </div>
              </div>
              <div>
                <p className="font-medium text-gray-900">Confirmation Email</p>
                <p className="text-sm text-gray-500">
                  You&apos;ll receive an email confirmation shortly.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center">
                  <Package className="w-4 h-4 text-orange-600" />
                </div>
              </div>
              <div>
                <p className="font-medium text-gray-900">Printing & Shipping</p>
                <p className="text-sm text-gray-500">
                  Your book will be printed and shipped within 2-3 business days.
                  We&apos;ll email you tracking info when it ships.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="space-y-3">
          <Link href="/library" className="block">
            <Button
              className="w-full bg-[#F76C5E] hover:bg-[#E55A4C] text-white py-6"
              size="lg"
            >
              Back to Library
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </Link>
        </div>

        {/* Help Text */}
        <p className="text-center text-sm text-gray-500 mt-6">
          Questions about your order?{' '}
          <a href="mailto:support@storywink.ai" className="text-[#F76C5E] hover:underline">
            Contact Support
          </a>
        </p>
      </div>
    </div>
  );
}

export default async function OrderSuccessPage({ params }: PageProps) {
  const { sessionId } = await params;

  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-b from-green-50 to-white py-12 px-4 flex items-center justify-center">
          <div className="animate-pulse text-gray-500">Loading order details...</div>
        </div>
      }
    >
      <OrderSuccessContent sessionId={sessionId} />
    </Suspense>
  );
}

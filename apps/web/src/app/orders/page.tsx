/**
 * Orders page
 *
 * Every print order the parent has placed, each with a three-step journey
 * (Confirmed → Printing → Shipped + tracking link). The Lulu status poller
 * moves these forward; this page just tells the story gently.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { getTranslations } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { Button } from '@/components/ui/button';
import { OrderCard, type OrderCardData } from '@/components/orders/order-card';
import { ArrowRight } from 'lucide-react';

export default async function OrdersPage() {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    redirect('/sign-in');
  }

  const user = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
  });
  if (!user) {
    redirect('/sign-in');
  }

  const t = await getTranslations('orders');

  const printOrders = await prisma.printOrder.findMany({
    where: {
      userId: user.id,
      // Abandoned checkouts never became orders; don't show them.
      status: { not: 'PENDING_PAYMENT' },
    },
    orderBy: { createdAt: 'desc' },
    include: {
      book: {
        select: {
          title: true,
          coverImageUrl: true,
          pages: {
            where: { isTitlePage: true },
            select: { generatedImageUrl: true },
            take: 1,
          },
        },
      },
    },
  });

  const orders: OrderCardData[] = printOrders.map((order) => ({
    id: order.id,
    status: order.status,
    quantity: order.quantity,
    totalAmount: order.totalAmount,
    currency: order.currency,
    trackingUrl: order.trackingUrl,
    createdAt: order.createdAt,
    bookTitle: order.book?.title ?? null,
    coverImageUrl: order.book?.coverImageUrl || order.book?.pages[0]?.generatedImageUrl || null,
  }));

  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="mx-auto max-w-lg">
        <header className="mb-8 text-center">
          <h1 className="font-playful text-3xl text-ink">{t('title')}</h1>
          {orders.length > 0 && <p className="mt-2 text-muted-foreground">{t('subtitle')}</p>}
        </header>

        {orders.length === 0 ? (
          <div className="rounded-xl border border-cream-deep bg-white p-8 text-center shadow-sm">
            <p className="mb-2 font-playful text-xl text-ink">{t('emptyTitle')}</p>
            <p className="mb-6 text-muted-foreground">{t('emptyBody')}</p>
            <Link href="/library">
              <Button className="bg-coral font-playful text-white hover:bg-coral-hover">
                {t('emptyCta')}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        )}

        <p className="mt-8 text-center text-sm text-muted-foreground">
          {t('helpPrompt')}{' '}
          <a
            href="mailto:support@storywink.ai"
            className="text-coral-ink underline underline-offset-2 hover:text-coral"
          >
            {t('contactSupport')}
          </a>
        </p>
      </div>
    </div>
  );
}

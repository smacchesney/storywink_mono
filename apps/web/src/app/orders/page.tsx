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
    coverImageUrl:
      order.book?.coverImageUrl || order.book?.pages[0]?.generatedImageUrl || null,
  }));

  return (
    <div className="min-h-screen bg-cream py-10 px-4">
      <div className="max-w-lg mx-auto">
        <header className="mb-8 text-center">
          <h1 className="font-playful text-3xl text-ink">{t('title')}</h1>
          {orders.length > 0 && (
            <p className="text-muted-foreground mt-2">{t('subtitle')}</p>
          )}
        </header>

        {orders.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm border border-cream-deep p-8 text-center">
            <p className="font-playful text-xl text-ink mb-2">{t('emptyTitle')}</p>
            <p className="text-muted-foreground mb-6">{t('emptyBody')}</p>
            <Link href="/library">
              <Button className="bg-coral hover:bg-coral-hover text-white font-playful">
                {t('emptyCta')}
                <ArrowRight className="w-4 h-4 ml-1.5" />
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

        <p className="text-center text-sm text-muted-foreground mt-8">
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

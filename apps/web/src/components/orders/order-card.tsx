import Image from 'next/image';
import { getLocale, getTranslations } from 'next-intl/server';
import { ExternalLink, LifeBuoy } from 'lucide-react';
import { coolifyImageUrl } from '@storywink/shared';
import { formatMoney } from '@/lib/format';
import { OrderTimeline, type OrderTimelineStep } from './order-timeline';

export interface OrderCardData {
  id: string;
  status: string;
  quantity: number;
  totalAmount: number | null;
  currency: string;
  trackingUrl: string | null;
  createdAt: Date;
  bookTitle: string | null;
  coverImageUrl: string | null;
}

/** Highest timeline step this order has reached. */
function timelineStep(status: string): OrderTimelineStep {
  switch (status) {
    case 'IN_PRODUCTION':
      return 2;
    case 'SHIPPED':
    case 'DELIVERED':
      return 3;
    default:
      // PAYMENT_COMPLETED / SUBMITTED_TO_LULU — confirmed, waiting on Lulu.
      return 1;
  }
}

const ATTENTION_STATUSES = new Set(['FAILED', 'CANCELLED']);

export async function OrderCard({ order }: { order: OrderCardData }) {
  const t = await getTranslations('orders');
  const locale = await getLocale();

  const orderNumber = order.id.slice(0, 8).toUpperCase();
  const title = order.bookTitle?.trim() || t('untitledBook');
  const orderedOn = new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(order.createdAt);
  const needsAttention = ATTENTION_STATUSES.has(order.status);
  const supportHref = `mailto:support@storywink.ai?subject=${encodeURIComponent(`Order ${orderNumber}`)}`;

  return (
    <article className="rounded-xl border border-cream-deep bg-white p-5 shadow-sm sm:p-6">
      {/* Book + order facts */}
      <div className="flex gap-4">
        <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg bg-cream sm:h-20 sm:w-20">
          {order.coverImageUrl ? (
            <Image
              src={coolifyImageUrl(order.coverImageUrl)}
              alt={t('coverAlt', { title })}
              fill
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>
              📖
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-playful text-lg text-ink">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('orderNumber', { number: orderNumber })} · {t('orderedOn', { date: orderedOn })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('quantityLabel', { count: order.quantity })}
            {order.totalAmount !== null && (
              <>
                {' · '}
                <span className="font-medium text-coral-ink">
                  {t('totalLabel', { amount: formatMoney(order.totalAmount, order.currency) })}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Journey or gentle help panel */}
      {needsAttention ? (
        <div className="mt-5 rounded-lg bg-coral-soft p-4">
          <p className="flex items-center gap-2 font-medium text-ink">
            <LifeBuoy className="h-4 w-4 text-coral-ink" aria-hidden />
            {t('attentionTitle')}
          </p>
          <p className="mt-1 text-sm text-ink/80">{t('attentionBody')}</p>
          <a
            href={supportHref}
            className="mt-2 inline-block text-sm font-medium text-coral-ink underline underline-offset-2 hover:text-coral"
          >
            support@storywink.ai
          </a>
        </div>
      ) : (
        <div className="mt-6">
          <OrderTimeline
            currentStep={timelineStep(order.status)}
            labels={{
              confirmed: t('stepConfirmed'),
              printing: t('stepPrinting'),
              shipped: t('stepShipped'),
            }}
          />
          {order.trackingUrl && timelineStep(order.status) === 3 && (
            <div className="mt-4 text-center">
              <a
                href={order.trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-coral-ink underline underline-offset-2 hover:text-coral"
              >
                {t('trackPackage')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

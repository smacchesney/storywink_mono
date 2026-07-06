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
    <article className="bg-white rounded-xl shadow-sm border border-cream-deep p-5 sm:p-6">
      {/* Book + order facts */}
      <div className="flex gap-4">
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-cream flex-shrink-0">
          {order.coverImageUrl ? (
            <Image
              src={coolifyImageUrl(order.coverImageUrl)}
              alt={t('coverAlt', { title })}
              fill
              sizes="80px"
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl" aria-hidden>
              📖
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="font-playful text-lg text-ink truncate">{title}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('orderNumber', { number: orderNumber })} · {t('orderedOn', { date: orderedOn })}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
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
          <p className="font-medium text-ink flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-coral-ink" aria-hidden />
            {t('attentionTitle')}
          </p>
          <p className="text-sm text-ink/80 mt-1">{t('attentionBody')}</p>
          <a
            href={supportHref}
            className="inline-block mt-2 text-sm font-medium text-coral-ink underline underline-offset-2 hover:text-coral"
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
                <ExternalLink className="w-3.5 h-3.5" aria-hidden />
              </a>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

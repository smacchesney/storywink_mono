'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Storydust } from '@/components/ui/storydust';
import { Button } from '@/components/ui/button';
import useMediaQuery from '@/hooks/useMediaQuery';
import logger from '@/lib/logger';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';
import { QuantitySelector } from './QuantitySelector';
import { coolifyImageUrl, PRINT_PRICING, SHIPPING_TIERS } from '@storywink/shared';
import { formatMoney } from '@/lib/format';

export interface PrintOrderBook {
  id: string;
  title: string | null;
  coverImageUrl: string | null;
  pageCount: number;
}

interface PrintOrderSheetProps {
  book: PrintOrderBook;
  isOpen: boolean;
  onClose: () => void;
}

// Panel content (shared between Sheet and Drawer)
function PanelContent({ book, onClose }: { book: PrintOrderBook; onClose: () => void }) {
  const t = useTranslations('print');
  const tc = useTranslations('common');
  const [quantity, setQuantity] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bookPrice = PRINT_PRICING.RETAIL_PRICE_CENTS;
  const subtotal = bookPrice * quantity;
  // Flat per-order shipping — the same tier Stripe applies at checkout.
  const shippingTier = SHIPPING_TIERS.SINGAPORE_MALAYSIA;
  const total = subtotal + shippingTier.priceCents;
  const currency = PRINT_PRICING.CURRENCY;

  const handleCheckout = async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Create checkout session
      const response = await fetch('/api/checkout/print', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          bookId: book.id,
          quantity,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create checkout session');
      }

      // Redirect to Stripe Checkout URL
      if (data.url) {
        window.location.href = data.url;
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (err) {
      // Raw error text goes to the log, never to the parent. Failure is
      // pre-Stripe-redirect, so "nothing was charged" holds.
      logger.error({ err }, 'Print checkout failed to start');
      setError(t('checkoutError'));
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Book preview */}
      <div className="px-4 py-4">
        <div className="flex gap-4">
          {/* Cover image */}
          <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-gray-100">
            {book.coverImageUrl ? (
              <Image
                src={coolifyImageUrl(book.coverImageUrl)}
                alt={book.title || t('untitledBook')}
                fill
                sizes="80px"
                className="object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-gray-400">
                {t('noCover')}
              </div>
            )}
          </div>
          {/* Book details */}
          <div className="min-w-0 flex-grow">
            <h3 className="truncate text-base font-semibold">{book.title || t('untitledBook')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('pageCount', { count: book.pageCount })}
            </p>
            <p className="mt-1 text-sm font-medium text-coral">
              {t('perBook', { price: formatMoney(bookPrice, currency) })}
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="mx-4 border-t" />

      {/* Quantity selector */}
      <div className="px-4 py-4">
        <label className="mb-2 block text-sm font-medium">{t('quantity')}</label>
        <QuantitySelector quantity={quantity} onChange={setQuantity} min={1} max={10} />
      </div>

      {/* Spacer */}
      <div className="flex-grow" />

      {/* Footer with total and checkout button */}
      <DrawerFooter className="border-t pt-4">
        {/* Price summary */}
        <div className="mb-1 space-y-1">
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('subtotal', { count: quantity })}</span>
            <span>{formatMoney(subtotal, currency)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>{t('shipping')}</span>
            <span>{formatMoney(shippingTier.priceCents, currency)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">{t('total')}</span>
            <span className="text-lg font-bold">{formatMoney(total, currency)}</span>
          </div>
        </div>
        <p className="mb-3 text-xs text-muted-foreground">
          {t('arrives', {
            min: shippingTier.deliveryDaysMin,
            max: shippingTier.deliveryDaysMax,
          })}
        </p>

        {error && <p className="mb-2 text-center text-sm text-red-600">{error}</p>}

        <Button
          onClick={handleCheckout}
          disabled={isLoading}
          className="w-full bg-coral py-6 text-base font-semibold text-white hover:bg-[#E55A4C]"
        >
          {isLoading ? (
            <>
              <Storydust variant="twinkle" size="inline" className="mr-2 text-white" />
              {t('startingCheckout')}
            </>
          ) : (
            t('checkout', { price: formatMoney(total, currency) })
          )}
        </Button>

        <Button variant="ghost" onClick={onClose} className="w-full">
          {tc('cancel')}
        </Button>

        <p className="mt-2 text-center text-xs text-muted-foreground">{t('shipsTo')}</p>
      </DrawerFooter>
    </div>
  );
}

export function PrintOrderSheet({ book, isOpen, onClose }: PrintOrderSheetProps) {
  const t = useTranslations('print');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(open) => !open && onClose()}
        modal={false}
        shouldScaleBackground={false}
      >
        <DrawerContent className="fixed right-0 left-auto mt-0 h-full w-[380px] rounded-none border-l">
          <DrawerHeader>
            <DrawerTitle>{t('title')}</DrawerTitle>
            <DrawerDescription>{t('subtitle')}</DrawerDescription>
          </DrawerHeader>
          <PanelContent book={book} onClose={onClose} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="z-[70] flex h-[85vh] flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>{t('subtitle')}</SheetDescription>
        </SheetHeader>
        <PanelContent book={book} onClose={onClose} />
      </SheetContent>
    </Sheet>
  );
}

export default PrintOrderSheet;

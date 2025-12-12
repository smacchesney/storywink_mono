"use client";

import React, { useState } from 'react';
import Image from 'next/image';
import { Loader2, Truck, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import useMediaQuery from '@/hooks/useMediaQuery';
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
import { coolifyImageUrl } from '@storywink/shared';

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

type ShippingOption = 'STANDARD' | 'EXPRESS';

const SHIPPING_OPTIONS = {
  STANDARD: {
    label: 'Standard Shipping',
    description: '7-14 business days',
    price: 500, // cents
    icon: Truck,
  },
  EXPRESS: {
    label: 'Express Shipping',
    description: '3-5 business days',
    price: 1500, // cents
    icon: Zap,
  },
} as const;

// Estimated print cost calculation (should match server-side)
function calculateEstimatedPrintCost(pageCount: number): number {
  const baseCost = 500; // $5.00 base
  const perPage = 50;   // $0.50 per page
  const minPrice = 1000; // $10.00 minimum
  const cost = baseCost + (pageCount * perPage);
  return Math.max(cost, minPrice);
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Panel content (shared between Sheet and Drawer)
function PanelContent({
  book,
  onClose,
}: {
  book: PrintOrderBook;
  onClose: () => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [shippingOption, setShippingOption] = useState<ShippingOption>('STANDARD');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const printCost = calculateEstimatedPrintCost(book.pageCount);
  const shippingCost = SHIPPING_OPTIONS[shippingOption].price;
  const totalEstimate = (printCost * quantity) + shippingCost;

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
          shippingOption,
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
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Book preview */}
      <div className="px-4 py-4">
        <div className="flex gap-4">
          {/* Cover image */}
          <div className="relative w-20 h-20 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
            {book.coverImageUrl ? (
              <Image
                src={coolifyImageUrl(book.coverImageUrl)}
                alt={book.title || 'Book cover'}
                fill
                sizes="80px"
                className="object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
                No cover
              </div>
            )}
          </div>
          {/* Book details */}
          <div className="flex-grow min-w-0">
            <h3 className="font-semibold text-base truncate">
              {book.title || 'Untitled Book'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {book.pageCount} pages
            </p>
            <p className="text-sm font-medium text-[#F76C5E] mt-1">
              {formatPrice(printCost)} per book
            </p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="border-t mx-4" />

      {/* Quantity selector */}
      <div className="px-4 py-4">
        <label className="block text-sm font-medium mb-2">Quantity</label>
        <QuantitySelector
          quantity={quantity}
          onChange={setQuantity}
          min={1}
          max={10}
        />
      </div>

      {/* Divider */}
      <div className="border-t mx-4" />

      {/* Shipping options */}
      <div className="px-4 py-4 flex-grow">
        <label className="block text-sm font-medium mb-3">Shipping</label>
        <div className="space-y-2">
          {(Object.entries(SHIPPING_OPTIONS) as [ShippingOption, typeof SHIPPING_OPTIONS[ShippingOption]][]).map(
            ([key, option]) => {
              const Icon = option.icon;
              const isSelected = shippingOption === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setShippingOption(key)}
                  className={cn(
                    'w-full flex items-center justify-between p-3 rounded-lg border-2 transition-all',
                    isSelected
                      ? 'border-[#F76C5E] bg-orange-50'
                      : 'border-gray-200 hover:border-gray-300'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        'w-4 h-4 rounded-full border-2 flex items-center justify-center',
                        isSelected ? 'border-[#F76C5E]' : 'border-gray-300'
                      )}
                    >
                      {isSelected && (
                        <div className="w-2 h-2 rounded-full bg-[#F76C5E]" />
                      )}
                    </div>
                    <Icon className={cn('h-4 w-4', isSelected ? 'text-[#F76C5E]' : 'text-gray-500')} />
                    <div className="text-left">
                      <p className="font-medium text-sm">{option.label}</p>
                      <p className="text-xs text-muted-foreground">{option.description}</p>
                    </div>
                  </div>
                  <span className="font-semibold text-sm">{formatPrice(option.price)}</span>
                </button>
              );
            }
          )}
        </div>
      </div>

      {/* Footer with total and checkout button */}
      <DrawerFooter className="border-t pt-4">
        {/* Price summary */}
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm text-muted-foreground">Estimated Total</span>
          <span className="text-lg font-bold">{formatPrice(totalEstimate)}</span>
        </div>

        {error && (
          <p className="text-sm text-red-600 mb-2 text-center">{error}</p>
        )}

        <Button
          onClick={handleCheckout}
          disabled={isLoading}
          className="w-full bg-[#F76C5E] hover:bg-[#E55A4C] text-white py-6 text-base font-semibold"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Loading...
            </>
          ) : (
            <>Checkout {formatPrice(totalEstimate)}</>
          )}
        </Button>

        <Button variant="ghost" onClick={onClose} className="w-full">
          Cancel
        </Button>

        <p className="text-xs text-muted-foreground text-center mt-2">
          Tax calculated at checkout. Ships to US only.
        </p>
      </DrawerFooter>
    </div>
  );
}

export function PrintOrderSheet({ book, isOpen, onClose }: PrintOrderSheetProps) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false} shouldScaleBackground={false}>
        <DrawerContent className="h-full w-[380px] mt-0 fixed right-0 left-auto rounded-none border-l">
          <DrawerHeader>
            <DrawerTitle>Order Print</DrawerTitle>
            <DrawerDescription>Get a physical copy of your book</DrawerDescription>
          </DrawerHeader>
          <PanelContent book={book} onClose={onClose} />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col p-0">
        <SheetHeader className="px-4 pt-4 pb-2">
          <SheetTitle>Order Print</SheetTitle>
          <SheetDescription>Get a physical copy of your book</SheetDescription>
        </SheetHeader>
        <PanelContent book={book} onClose={onClose} />
      </SheetContent>
    </Sheet>
  );
}

export default PrintOrderSheet;

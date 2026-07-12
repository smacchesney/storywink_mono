'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface QuantitySelectorProps {
  quantity: number;
  onChange: (quantity: number) => void;
  min?: number;
  max?: number;
  className?: string;
}

export function QuantitySelector({
  quantity,
  onChange,
  min = 1,
  max = 10,
  className,
}: QuantitySelectorProps) {
  const t = useTranslations('print');
  const handleDecrement = () => {
    if (quantity > min) {
      onChange(quantity - 1);
    }
  };

  const handleIncrement = () => {
    if (quantity < max) {
      onChange(quantity + 1);
    }
  };

  return (
    <div className={cn('flex items-center gap-3', className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleDecrement}
        disabled={quantity <= min}
        className="h-9 w-9 rounded-full"
        aria-label={t('decreaseQuantity')}
      >
        <Minus className="h-4 w-4" />
      </Button>

      <span className="w-8 text-center text-lg font-semibold tabular-nums">{quantity}</span>

      <Button
        type="button"
        variant="outline"
        size="icon"
        onClick={handleIncrement}
        disabled={quantity >= max}
        className="h-9 w-9 rounded-full"
        aria-label={t('increaseQuantity')}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default QuantitySelector;

/**
 * Stripe Client Configuration
 *
 * Server-side Stripe SDK for creating checkout sessions and handling webhooks.
 * Uses lazy initialization to avoid build-time errors when env vars aren't available.
 */

import Stripe from 'stripe';

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-11-17.clover',
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Fixed shipping rates (simpler than dynamic Lulu rates)
 */
export const SHIPPING_OPTIONS = {
  STANDARD: {
    rate: 500, // $5.00 in cents
    name: 'Standard Shipping',
    deliveryMin: 7,
    deliveryMax: 14,
    luluLevel: 'MAIL',
  },
  EXPRESS: {
    rate: 1500, // $15.00 in cents
    name: 'Express Shipping',
    deliveryMin: 3,
    deliveryMax: 5,
    luluLevel: 'EXPEDITED',
  },
} as const;

/**
 * Estimated print cost per page (in cents)
 * Based on Lulu's pricing for 8.5x8.5 saddle-stitch
 */
export const PRINT_PRICING = {
  BASE_COST_CENTS: 500, // $5.00 base cost
  PER_PAGE_CENTS: 50,   // $0.50 per page
  MIN_PRICE_CENTS: 1000, // $10.00 minimum
  MAX_PAGES: 80,
} as const;

/**
 * Calculate estimated print cost based on page count
 */
export function calculatePrintCost(pageCount: number): number {
  const cost = PRINT_PRICING.BASE_COST_CENTS + (pageCount * PRINT_PRICING.PER_PAGE_CENTS);
  return Math.max(cost, PRINT_PRICING.MIN_PRICE_CENTS);
}

/**
 * Money formatting for parent-facing surfaces.
 *
 * Stripe amounts arrive in the currency's smallest unit. SGD is branded
 * "S$" across the app; Intl's narrow symbol renders it as a bare "$",
 * which reads as USD on the money screens — so brand symbols win.
 */

// Stripe zero-decimal currencies: amounts are already in whole units.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

const BRAND_SYMBOLS: Record<string, string> = {
  sgd: 'S$',
};

export function formatMoney(amountInSmallestUnit: number, currency: string): string {
  const code = currency.toLowerCase();
  const zeroDecimal = ZERO_DECIMAL_CURRENCIES.has(code);
  const amount = zeroDecimal ? amountInSmallestUnit : amountInSmallestUnit / 100;

  const symbol = BRAND_SYMBOLS[code];
  if (symbol) {
    return `${symbol}${amount.toFixed(zeroDecimal ? 0 : 2)}`;
  }

  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code.toUpperCase(),
    }).format(amount);
  } catch {
    // Unknown ISO code — show it rather than crash a money screen.
    return `${code.toUpperCase()} ${amount.toFixed(zeroDecimal ? 0 : 2)}`;
  }
}

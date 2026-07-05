import { describe, it, expect } from 'vitest';
import { formatMoney } from './format';

describe('formatMoney', () => {
  it('brands SGD as S$ regardless of case', () => {
    expect(formatMoney(5500, 'sgd')).toBe('S$55.00');
    expect(formatMoney(5500, 'SGD')).toBe('S$55.00');
  });

  it('formats non-round cent amounts', () => {
    expect(formatMoney(3550, 'sgd')).toBe('S$35.50');
    expect(formatMoney(5, 'sgd')).toBe('S$0.05');
  });

  it('treats zero-decimal currencies as whole units', () => {
    // Stripe sends JPY amounts in yen, not hundredths.
    expect(formatMoney(5500, 'jpy')).toBe('¥5,500');
  });

  it('falls back to Intl for known non-branded currencies', () => {
    expect(formatMoney(5500, 'usd')).toBe('$55.00');
  });

  it('never throws on unknown currency codes', () => {
    expect(formatMoney(5500, 'xxx-not-real')).toBe('XXX-NOT-REAL 55.00');
  });
});

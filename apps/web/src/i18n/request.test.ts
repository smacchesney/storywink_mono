import { describe, it, expect } from 'vitest';
import { deepMergeMessages } from './request';

describe('deepMergeMessages', () => {
  it('keeps base keys that the override catalog is missing', () => {
    const merged = deepMergeMessages(
      { review: { title: 'Title page', edit: 'Edit' } },
      { review: { title: 'タイトルページ' } },
    );
    expect(merged).toEqual({
      review: { title: 'タイトルページ', edit: 'Edit' },
    });
  });

  it('keeps whole namespaces missing from the override catalog', () => {
    const merged = deepMergeMessages(
      { orders: { loading: 'Fetching your order…' }, footer: { terms: 'Terms' } },
      { footer: { terms: '利用規約' } },
    );
    expect(merged).toEqual({
      orders: { loading: 'Fetching your order…' },
      footer: { terms: '利用規約' },
    });
  });

  it('prefers override leaves over base leaves at every depth', () => {
    const merged = deepMergeMessages(
      { a: { b: { c: 'en', d: 'en' } } },
      { a: { b: { c: 'ja' } } },
    );
    expect(merged).toEqual({ a: { b: { c: 'ja', d: 'en' } } });
  });

  it('does not mutate either input catalog', () => {
    const base = { ns: { key: 'en' } };
    const override = { ns: { other: 'ja' } };
    deepMergeMessages(base, override);
    expect(base).toEqual({ ns: { key: 'en' } });
    expect(override).toEqual({ ns: { other: 'ja' } });
  });
});

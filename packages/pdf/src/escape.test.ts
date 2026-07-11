import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape.js';
import { generateTextPageHtml, generateDedicationPageHtml } from './pages.js';
import type { Page } from './types.js';

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`Tom & Jerry <3 "quotes" 'apostrophes'`)).toBe(
      'Tom &amp; Jerry &lt;3 &quot;quotes&quot; &#39;apostrophes&#39;'
    );
  });

  it('passes plain text through byte-identical', () => {
    expect(escapeHtml('Splish, splash, one more splash!')).toBe(
      'Splish, splash, one more splash!'
    );
  });
});

describe('PDF page HTML escaping', () => {
  it('escapes markup in page text instead of injecting it', () => {
    const page = {
      text: 'Mia says <script>alert(1)</script> & giggles',
      pageNumber: 2,
    } as unknown as Page;
    const html = generateTextPageHtml(page, 'en');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; giggles');
  });

  it('escapes markup in the dedication child name', () => {
    const html = generateDedicationPageHtml('<img src=x onerror=alert(1)>', 'Test Book', 'en');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

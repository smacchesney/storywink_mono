import { afterEach, describe, expect, it } from 'vitest';
import { buildReadyEmail, emailBaseUrl, escapeHtml, readyEmailEnabled } from './email.helpers.js';

const ENV_KEYS = [
  'READY_EMAIL_ENABLED',
  'RESEND_API_KEY',
  'APP_BASE_URL',
  'NEXT_PUBLIC_APP_URL',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('readyEmailEnabled', () => {
  it('defaults OFF', () => {
    expect(readyEmailEnabled()).toBe(false);
  });

  it('requires BOTH the flag and a Resend key', () => {
    process.env.READY_EMAIL_ENABLED = 'true';
    expect(readyEmailEnabled()).toBe(false);
    process.env.RESEND_API_KEY = 're_test';
    expect(readyEmailEnabled()).toBe(true);
    delete process.env.READY_EMAIL_ENABLED;
    expect(readyEmailEnabled()).toBe(false);
  });
});

describe('emailBaseUrl', () => {
  it('prefers APP_BASE_URL, then NEXT_PUBLIC_APP_URL, then production', () => {
    expect(emailBaseUrl()).toBe('https://storywink.ai');
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.storywink.ai';
    expect(emailBaseUrl()).toBe('https://staging.storywink.ai');
    process.env.APP_BASE_URL = 'http://localhost:3000';
    expect(emailBaseUrl()).toBe('http://localhost:3000');
  });
});

describe('escapeHtml', () => {
  it('escapes markup-significant characters', () => {
    expect(escapeHtml(`<b>"Mia & Max's Day"</b>`)).toBe(
      '&lt;b&gt;&quot;Mia &amp; Max&#39;s Day&quot;&lt;/b&gt;',
    );
  });
});

describe('buildReadyEmail', () => {
  const base = {
    title: "Mia's Big Day",
    bookId: 'book-123',
    baseUrl: 'https://storywink.ai',
  };

  it('builds the COMPLETED variant in English', () => {
    const email = buildReadyEmail({ ...base, status: 'COMPLETED', language: 'en' });
    expect(email.subject).toBe("Mia's Big Day is ready — open your book");
    expect(email.html).toContain('https://storywink.ai/book/book-123/preview');
    expect(email.html).toContain('Open your book');
    expect(email.html).toContain('#F76C5E');
  });

  it('builds the PARTIAL variant in English', () => {
    const email = buildReadyEmail({ ...base, status: 'PARTIAL', language: 'en' });
    expect(email.subject).toBe('Ready to read — a few pages need one more look');
    expect(email.html).toContain('one more look');
    expect(email.html).toContain('/book/book-123/preview');
  });

  it('localizes by book language (ja)', () => {
    const completed = buildReadyEmail({ ...base, status: 'COMPLETED', language: 'ja' });
    expect(completed.subject).toBe("「Mia's Big Day」ができあがりました");
    expect(completed.html).toContain('えほんをひらく');

    const partial = buildReadyEmail({ ...base, status: 'PARTIAL', language: 'ja' });
    expect(partial.subject).toBe("「Mia's Big Day」が読めるようになりました");
  });

  it('falls back to English for unknown languages', () => {
    const email = buildReadyEmail({ ...base, status: 'COMPLETED', language: 'fr' });
    expect(email.subject).toContain('is ready');
  });

  it('escapes HTML in the title inside the body', () => {
    const email = buildReadyEmail({
      ...base,
      title: '<script>alert(1)</script>',
      status: 'COMPLETED',
      language: 'en',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
  });

  it('does not double up slashes when baseUrl has a trailing slash', () => {
    const email = buildReadyEmail({
      ...base,
      baseUrl: 'https://storywink.ai/',
      status: 'COMPLETED',
      language: 'en',
    });
    expect(email.html).toContain('https://storywink.ai/book/book-123/preview');
    expect(email.html).not.toContain('ai//book');
  });
});

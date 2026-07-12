/**
 * Ready email (READY_EMAIL_ENABLED) — pure template helpers.
 *
 * The finalize worker sends ONE "your book is ready" email per book, only
 * while the flag is on AND a Resend key exists. Two variants keep the promise
 * honest on every terminal status that is readable: COMPLETED ("open your
 * book") and PARTIAL ("ready to read — a few pages need one more look").
 * FAILED books never email — the in-app retry flow owns that moment.
 *
 * Templates are plain warm HTML in the brand voice (near-black text, coral
 * button), localized by Book.language (en/ja — ja lines are logged in
 * docs/ja-review.md for native review). No framework: email clients want
 * inline styles. Everything here is deterministic and dependency-free.
 */

const BRAND_CORAL = '#F76C5E';
const BRAND_INK = '#1a1a1a';

/** Workers env flag — default OFF; the Resend key is also required. */
export function readyEmailEnabled(): boolean {
  return process.env.READY_EMAIL_ENABLED === 'true' && !!process.env.RESEND_API_KEY;
}

/** Web origin the email's button links to. */
export function emailBaseUrl(): string {
  return process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://storywink.ai';
}

export type ReadyEmailStatus = 'COMPLETED' | 'PARTIAL';

export interface ReadyEmailContent {
  subject: string;
  html: string;
}

/** Minimal HTML escaping for user-controlled strings (the book title). */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface TemplateStrings {
  subject: (title: string) => string;
  heading: string;
  body: (title: string) => string;
  button: string;
  footer: string;
}

const TEMPLATES: Record<'en' | 'ja', Record<ReadyEmailStatus, TemplateStrings>> = {
  en: {
    COMPLETED: {
      subject: (title) => `${title} is ready — open your book`,
      heading: 'It’s ready!',
      body: (title) => `Every page of “${title}” is illustrated and waiting for you.`,
      button: 'Open your book',
      footer: 'Made for you by Storywink.ai',
    },
    PARTIAL: {
      subject: () => 'Ready to read — a few pages need one more look',
      heading: 'Ready to read',
      body: (title) =>
        `“${title}” is ready to read. A couple of pages need one more look — you can finish them up with a tap.`,
      button: 'Read what’s ready',
      footer: 'Made for you by Storywink.ai',
    },
  },
  ja: {
    COMPLETED: {
      subject: (title) => `「${title}」ができあがりました`,
      heading: 'できあがりました！',
      body: (title) => `「${title}」のすべてのページにイラストが入りました。ひらいてみてください。`,
      button: 'えほんをひらく',
      footer: 'Storywink.ai より',
    },
    PARTIAL: {
      subject: (title) => `「${title}」が読めるようになりました`,
      heading: 'もう読みはじめられます',
      body: (title) =>
        `「${title}」は読みはじめられます。いくつかのページは、あとすこしで完成します。アプリからかんたんに仕上げられます。`,
      button: 'えほんをひらく',
      footer: 'Storywink.ai より',
    },
  },
};

export interface BuildReadyEmailParams {
  status: ReadyEmailStatus;
  title: string;
  bookId: string;
  /** Book.language ("en" | "ja"; anything else falls back to en). */
  language: string;
  baseUrl: string;
}

/**
 * Builds the subject and HTML body for the ready email. The link lands on the
 * book preview; Clerk's middleware already bounces signed-out users through
 * sign-in and back.
 */
export function buildReadyEmail(params: BuildReadyEmailParams): ReadyEmailContent {
  const locale = params.language === 'ja' ? 'ja' : 'en';
  const strings = TEMPLATES[locale][params.status];
  const safeTitle = escapeHtml(params.title);
  const link = `${params.baseUrl.replace(/\/$/, '')}/book/${params.bookId}/preview`;

  const html = `
<div style="margin:0;padding:32px 16px;background-color:#FFF7F0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <div style="max-width:480px;margin:0 auto;background-color:#ffffff;border-radius:16px;padding:32px;">
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${BRAND_INK};">${strings.heading}</p>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${BRAND_INK};">${strings.body(safeTitle)}</p>
    <a href="${link}" style="display:inline-block;background-color:${BRAND_CORAL};color:#ffffff;text-decoration:none;font-size:16px;font-weight:700;padding:12px 24px;border-radius:9999px;">${strings.button}</a>
    <p style="margin:32px 0 0;font-size:13px;color:#8a8a8a;">${strings.footer}</p>
  </div>
</div>`.trim();

  return { subject: strings.subject(params.title), html };
}

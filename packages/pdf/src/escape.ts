/**
 * Minimal HTML escaping for user-controlled strings interpolated into the
 * Puppeteer page HTML (story text, child name, book title). The PDF HTML is
 * built with template literals, so anything unescaped is live markup.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Filename for the browser-side download of an exported book PDF.
 *
 * Unlike the Content-Disposition header (see `pdf-export.ts`), the anchor
 * `download` attribute takes unicode as-is, so Japanese titles survive
 * untouched; only characters that break filesystems are stripped.
 */
export function pdfDownloadFileName(title: string | null | undefined): string {
  const base = (title || '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Reserved on Windows ('/' everywhere); collapse to spaces, not nothing,
    // so "cats/dogs" stays readable as "cats dogs".
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows rejects trailing dots and spaces before the extension.
    .replace(/[. ]+$/g, '');
  return `${base || 'book'}.pdf`;
}

import { PAGE_TEXT } from '@storywink/shared/constants';
import type { BookWithPages, Page } from './types.js';
import {
  PAGE_WIDTH_WITH_BLEED_IN,
  PAGE_HEIGHT_WITH_BLEED_IN,
  DEDICATION_MASCOT_URL,
  ENDING_MASCOT_URL,
  BACK_COVER_MASCOT_URL,
  optimizeForPrint,
  storyFontFamily,
  brandingFontFamily,
} from './constants.js';

/**
 * Kind of interior page, used by tests to assert page order without parsing
 * the rendered HTML. Each descriptor is paired 1:1 with an entry in the HTML
 * array so the two stay in lockstep.
 */
export type InteriorPageKind =
  | 'title'
  | 'dedication'
  | 'text'
  | 'illustration'
  | 'ending'
  | 'backCover'
  | 'blank';

export interface InteriorPage {
  kind: InteriorPageKind;
  /** Rendered HTML for this page. */
  html: string;
  /** Source page number for text/illustration/title pages (undefined otherwise). */
  pageNumber?: number;
}

// ---------------------------------------------------------------------------
// Individual page HTML generators (identical across the former web/workers
// copies — this is now the single source of truth).
// ---------------------------------------------------------------------------

/** Full-bleed illustration page. */
export function generateIllustrationPageHtml(page: Page): string {
  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    background-color: white;
  `;
  const imageStyle = `
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: center center;
  `;

  return `
    <div class="page" style="${pageStyle}">
      ${
        page.generatedImageUrl
          ? `<img src="${optimizeForPrint(page.generatedImageUrl)}" alt="Page ${page.pageNumber} Illustration" style="${imageStyle}" />`
          : '<div style="display:flex; align-items:center; justify-content:center; height:100%;">Image not generated</div>'
      }
    </div>
  `;
}

/** Text-only page with centered story text. */
export function generateTextPageHtml(page: Page, language: string): string {
  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    background-color: white;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  const textStyle = `
    font-family: ${storyFontFamily(language)};
    font-size: 36px;
    color: #1a1a1a;
    text-align: center;
    line-height: 1.5;
    max-width: 70%;
    word-wrap: break-word;
    word-break: ${language === 'ja' ? 'auto-phrase' : 'normal'};
  `;

  const text = page.text || '';

  return `
    <div class="page" style="${pageStyle}">
      <p style="${textStyle}">${text}</p>
    </div>
  `;
}

/**
 * Dedication page (PDF page 1, right-hand / recto).
 * "This book was made especially for" + child's name in coral + mascot.
 */
export function generateDedicationPageHtml(
  childName: string | null,
  bookTitle: string,
  language: string
): string {
  const displayName = childName || bookTitle || 'You';
  const texts = PAGE_TEXT[language as keyof typeof PAGE_TEXT] || PAGE_TEXT.en;
  const fontFamily = brandingFontFamily(language);

  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    background-color: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

  // Japanese: "この えほんは [name] のために つくりました"
  // English: "This book was made / especially for / [name]"
  const dedicationHtml =
    language === 'ja'
      ? `<p style="font-family: ${fontFamily}; font-size: 32px; color: #1a1a1a; line-height: 1.4; margin: 0 0 0.15in 0;">
        ${texts.dedicationLine1}
      </p>
      <p style="font-family: ${fontFamily}; font-size: 52px; color: #F76C5E; line-height: 1.3; margin: 0 0 0.15in 0; font-weight: bold;">
        ${displayName}
      </p>
      <p style="font-family: ${fontFamily}; font-size: 32px; color: #1a1a1a; line-height: 1.4; margin: 0;">
        ${texts.dedicationLine2}
      </p>`
      : `<p style="font-family: ${fontFamily}; font-size: 32px; color: #1a1a1a; line-height: 1.4; margin: 0 0 0.15in 0;">
        ${texts.dedicationLine1}<br>${texts.dedicationLine2}
      </p>
      <p style="font-family: ${fontFamily}; font-size: 52px; color: #F76C5E; line-height: 1.3; margin: 0; font-weight: bold;">
        ${displayName}
      </p>`;

  return `
    <div class="page" style="${pageStyle}">
      <div style="text-align: center; max-width: 70%;">
        ${dedicationHtml}
      </div>
      <img
        src="${DEDICATION_MASCOT_URL}"
        alt="Storywink mascot"
        style="
          position: absolute;
          bottom: 0.5in;
          right: 0.5in;
          height: 15%;
          width: auto;
          object-fit: contain;
        "
      />
    </div>
  `;
}

/** Ending page. "The End / Until next time, [name]!" with mascot. */
export function generateEndingPageHtml(
  childName: string | null,
  bookTitle: string,
  language: string
): string {
  const displayName = childName || bookTitle || 'You';
  const texts = PAGE_TEXT[language as keyof typeof PAGE_TEXT] || PAGE_TEXT.en;
  const fontFamily = brandingFontFamily(language);

  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    background-color: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

  return `
    <div class="page" style="${pageStyle}">
      <div style="text-align: center; max-width: 70%;">
        <p style="
          font-family: ${fontFamily};
          font-size: 42px;
          color: #1a1a1a;
          line-height: 1.3;
          margin: 0 0 0.2in 0;
          font-weight: bold;
        ">${texts.endingTitle}</p>
        <p style="
          font-family: ${fontFamily};
          font-size: 28px;
          color: #1a1a1a;
          line-height: 1.4;
          margin: 0 0 0.1in 0;
        ">${texts.endingLine}</p>
        <p style="
          font-family: ${fontFamily};
          font-size: 48px;
          color: #F76C5E;
          line-height: 1.3;
          margin: 0;
          font-weight: bold;
        ">${displayName}!</p>
      </div>
      <img
        src="${ENDING_MASCOT_URL}"
        alt="Storywink mascot"
        style="
          margin-top: 0.4in;
          height: 15%;
          width: auto;
          object-fit: contain;
        "
      />
    </div>
  `;
}

/**
 * Back cover page (user PDF only).
 * White background with centered "Storywink.ai" branding and mascot below.
 */
export function generateBackCoverPageHtml(): string {
  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    background-color: white;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
  `;

  return `
    <div class="page" style="${pageStyle}">
      <div style="
        font-family: 'Excalifont', cursive, sans-serif;
        font-size: 48px;
        color: #1a1a1a;
        text-align: center;
        font-weight: bold;
      ">
        <span>Storywin</span><span style="color: #F76C5E;">k.ai</span>
      </div>
      <img
        src="${BACK_COVER_MASCOT_URL}"
        alt="Storywink mascot"
        style="
          margin-top: 0.4in;
          height: 12%;
          width: auto;
          object-fit: contain;
        "
      />
    </div>
  `;
}

/** Blank filler page for Lulu page count padding. */
export function generateBlankPageHtml(): string {
  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    page-break-after: always;
    background-color: white;
  `;

  return `<div class="page" style="${pageStyle}"></div>`;
}

// ---------------------------------------------------------------------------
// Page assembly (pure — no browser). This is the unit tested by the golden
// tests: it decides page ORDER, pairing, padding, and title/back-cover
// inclusion.
// ---------------------------------------------------------------------------

export interface AssembleInteriorOptions {
  titlePage?: Page;
  includeBackCover?: boolean;
  padToFour?: boolean;
}

/**
 * Builds the ordered array of interior page descriptors for a book.
 *
 * Lulu path (defaults): dedication (recto) → [text (verso) + illustration
 * (recto)] × N story pages → ending → padded to a multiple of 4. Title page
 * excluded (it lives on the cover spread).
 *
 * User export path: titlePage → dedication → pairs → ending → back cover, no
 * padding.
 *
 * All pages participate as story pages; the caller decides whether to pass a
 * `titlePage` (never both included as a story pair AND as the cover — that is
 * the caller's responsibility, matching the pre-unification behaviour).
 */
export function assembleInteriorPages(
  bookData: BookWithPages,
  options?: AssembleInteriorOptions
): InteriorPage[] {
  const { titlePage, includeBackCover = false, padToFour = true } = options ?? {};
  const language = bookData.language || 'en';

  const sortedPages = [...bookData.pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const pages: InteriorPage[] = [];

  // Title page (user PDF only) — full-bleed illustration as first page.
  if (titlePage) {
    pages.push({
      kind: 'title',
      html: generateIllustrationPageHtml(titlePage),
      pageNumber: titlePage.pageNumber,
    });
  }

  // Dedication page (recto).
  pages.push({
    kind: 'dedication',
    html: generateDedicationPageHtml(bookData.childName, bookData.title, language),
  });

  // Story pages: text (verso) + illustration (recto) pairs.
  for (const page of sortedPages) {
    pages.push({ kind: 'text', html: generateTextPageHtml(page, language), pageNumber: page.pageNumber });
    pages.push({ kind: 'illustration', html: generateIllustrationPageHtml(page), pageNumber: page.pageNumber });
  }

  // Ending page.
  pages.push({
    kind: 'ending',
    html: generateEndingPageHtml(bookData.childName, bookData.title, language),
  });

  // Back cover (user PDF only).
  if (includeBackCover) {
    pages.push({ kind: 'backCover', html: generateBackCoverPageHtml() });
  }

  // Pad to multiple of 4 for Lulu saddle stitch (skipped for user PDF).
  if (padToFour) {
    const remainder = pages.length % 4;
    if (remainder !== 0) {
      const paddingNeeded = 4 - remainder;
      for (let i = 0; i < paddingNeeded; i++) {
        pages.push({ kind: 'blank', html: generateBlankPageHtml() });
      }
    }
  }

  return pages;
}

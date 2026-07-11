/**
 * The real-moments collage: keepsake page(s) at the back of the book showing
 * the ORIGINAL photos as a polaroid scatter. Geometry comes from the shared
 * slot engine so the flipbook renders the identical layout on screen.
 *
 * Print sources come from the Asset relation (full-resolution originals) —
 * Page.originalImageUrl can be a 200px thumbnail and must never reach print.
 */
import { PAGE_TEXT } from '@storywink/shared/constants';
import { collageSlots, planCollage, MAX_COLLAGE_PHOTOS } from '@storywink/shared/collage';
import type { CollageSlot } from '@storywink/shared/collage';
import type { BookWithPages, ImageUrlTransform } from './types.js';
import {
  PAGE_WIDTH_WITH_BLEED_IN,
  PAGE_HEIGHT_WITH_BLEED_IN,
  ENDING_MASCOT_URL,
  CORAL_COLOR,
  brandingFontFamily,
} from './constants.js';
import { escapeHtml } from './escape.js';

export interface CollagePhoto {
  url: string;
}

/**
 * The photos eligible for the collage, in story order: PHOTO pages (bridges
 * have no source photo) whose Asset relation is loaded and carries the
 * full-resolution original URL.
 */
export function collectCollagePhotos(bookData: BookWithPages): CollagePhoto[] {
  return [...bookData.pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .filter((page) => page.source !== 'BRIDGE')
    .map((page) => page.asset?.url)
    .filter((url): url is string => !!url)
    .map((url) => ({ url }));
}

/**
 * Cloudinary transform for one polaroid window: exact-size square fill crop,
 * face-centered, JPEG for verbatim PDF embedding, never upscaled (c_lfill).
 * Already sized — collage cells are exempt from the page-level
 * imageUrlTransform (chaining a w_2048 rewrite after this would upscale).
 */
export function collageCellUrl(url: string, windowIn: number): string {
  if (!url.includes('/image/upload/')) return url;
  const px = Math.round(windowIn * 300);
  return url.replace(
    '/upload/',
    `/upload/f_jpg,q_auto:good,c_lfill,w_${px},h_${px},g_auto:faces/`
  );
}

/** "July 2026" / "2026年7月" subline under the heading. */
export function collageSubline(createdAt: Date, language: string): string {
  const d = new Date(createdAt);
  if (language === 'ja') return `${d.getFullYear()}年${d.getMonth() + 1}月`;
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** A small hand-drawn coral heart — the page's single brand accent. */
const CORAL_HEART_SVG = `<svg width="26" height="24" viewBox="0 0 26 24" xmlns="http://www.w3.org/2000/svg" style="vertical-align: middle; margin-left: 0.12in;"><path d="M13 21C9 17 2.5 12.5 2.5 7.5 2.5 4.4 5 2.5 7.6 2.5 9.7 2.5 11.9 3.8 13 6 14.1 3.8 16.3 2.5 18.4 2.5 21 2.5 23.5 4.4 23.5 7.5 23.5 12.5 17 17 13 21Z" fill="${CORAL_COLOR}" opacity="0.9"/></svg>`;

export interface CollagePageOptions {
  /** Photos for THIS page (already chunked by the caller). */
  photos: CollagePhoto[];
  /** Heading + subline render only on the first collage page. */
  withHeading: boolean;
  /** Mascot cameo renders only on the last collage page. */
  withMascot: boolean;
  language: string;
  createdAt: Date;
  /** Applied to the mascot only (photo cells build their own sized URLs). */
  imageUrlTransform?: ImageUrlTransform;
}

/** One collage page: off-white ground, polaroid scatter, restrained branding. */
export function generateCollagePageHtml(options: CollagePageOptions): string {
  const { photos, withHeading, withMascot, language, createdAt, imageUrlTransform } = options;
  const texts = PAGE_TEXT[language as keyof typeof PAGE_TEXT] || PAGE_TEXT.en;
  const title = (texts as { collageTitle?: string }).collageTitle ?? PAGE_TEXT.en.collageTitle;
  const fontFamily = brandingFontFamily(language);
  const slots = collageSlots(photos.length);

  const pageStyle = `
    width: ${PAGE_WIDTH_WITH_BLEED_IN}in;
    height: ${PAGE_HEIGHT_WITH_BLEED_IN}in;
    position: relative;
    overflow: hidden;
    page-break-after: always;
    background-color: #FFFDF8;
  `;

  const headingHtml = withHeading
    ? `
      <div style="position: absolute; top: 0.55in; left: 0; width: 100%; text-align: center;">
        <p style="font-family: ${fontFamily}; font-size: 40px; color: #1a1a1a; margin: 0; font-weight: bold;">${escapeHtml(title)}${CORAL_HEART_SVG}</p>
        <p style="font-family: ${fontFamily}; font-size: 20px; color: #8a8a8a; margin: 0.08in 0 0 0;">${escapeHtml(collageSubline(createdAt, language))}</p>
      </div>`
    : '';

  const polaroids = photos
    .map((photo, i) => {
      const slot: CollageSlot = slots[i];
      const outerW = slot.windowIn + 0.3; // 0.15in frame each side
      const outerH = slot.windowIn + 0.15 + 0.55; // top frame + caption chin
      const left = slot.xIn - outerW / 2;
      const top = slot.yIn - slot.windowIn / 2 - 0.15;
      return `
      <div style="
        position: absolute;
        left: ${left.toFixed(3)}in;
        top: ${top.toFixed(3)}in;
        width: ${outerW.toFixed(3)}in;
        height: ${outerH.toFixed(3)}in;
        background-color: white;
        padding: 0.15in 0.15in 0.55in 0.15in;
        box-sizing: border-box;
        box-shadow: 0 3px 10px rgba(0,0,0,0.18);
        transform: rotate(${slot.rotationDeg}deg);
      ">
        <img src="${collageCellUrl(photo.url, slot.windowIn)}" alt="" style="
          display: block;
          width: ${slot.windowIn.toFixed(3)}in;
          height: ${slot.windowIn.toFixed(3)}in;
          object-fit: cover;
        " />
      </div>`;
    })
    .join('\n');

  const mascotHtml = withMascot
    ? `
      <img
        src="${imageUrlTransform ? imageUrlTransform(ENDING_MASCOT_URL) : ENDING_MASCOT_URL}"
        alt="Storywink mascot"
        style="
          position: absolute;
          bottom: 0.45in;
          right: 0.5in;
          height: 9%;
          width: auto;
          object-fit: contain;
        "
      />`
    : '';

  return `
    <div class="page" style="${pageStyle}">
      ${headingHtml}
      ${polaroids}
      ${mascotHtml}
    </div>
  `;
}

/**
 * All collage pages for a book: photos chunked per the shared plan, heading
 * on the first page, mascot on the last. Empty when no eligible photos.
 */
export function generateCollagePagesHtml(
  bookData: BookWithPages,
  imageUrlTransform?: ImageUrlTransform
): string[] {
  const photos = collectCollagePhotos(bookData);
  const plan = planCollage(photos.length);
  if (plan.perPage.length === 0) return [];
  const kept = photos.slice(0, MAX_COLLAGE_PHOTOS);
  const language = bookData.language || 'en';
  const createdAt = bookData.createdAt ?? new Date(0);

  const pages: string[] = [];
  let offset = 0;
  plan.perPage.forEach((count, pageIndex) => {
    pages.push(
      generateCollagePageHtml({
        photos: kept.slice(offset, offset + count),
        withHeading: pageIndex === 0,
        withMascot: pageIndex === plan.perPage.length - 1,
        language,
        createdAt,
        imageUrlTransform,
      })
    );
    offset += count;
  });
  return pages;
}

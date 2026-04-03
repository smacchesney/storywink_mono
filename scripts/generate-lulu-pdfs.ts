#!/usr/bin/env tsx
/**
 * Generate Lulu interior + cover PDFs locally for inspection.
 *
 * Usage: npx tsx scripts/generate-lulu-pdfs.ts <bookId>
 * Output: .docs/lulu-interior-<bookId>.pdf, .docs/lulu-cover-<bookId>.pdf
 *
 * Requires: DATABASE_URL env var (or fetches from Supabase via MCP).
 * For one-off use, book data can be passed inline.
 */

import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FONT_PATH = join(process.cwd(), 'apps/web/public/fonts/Excalifont-Regular.woff2');

// Lulu specs
const PAGE_W = 8.75;
const PAGE_H = 8.75;
const COVER_W = 17.25;
const COVER_H = 8.75;
const PANEL_W = COVER_W / 2;
const DPI = 300;
const CORAL = '#F76C5E';

// Mascots
const DEDICATION_MASCOT = 'https://res.cloudinary.com/storywink/image/upload/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png';
const ENDING_MASCOT = 'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.54_PM_sxcasb.png';
const BACK_COVER_MASCOT = 'https://res.cloudinary.com/storywink/image/upload/v1772291378/Screenshot_2026-02-28_at_10.57.29_PM_qwoqr0.png';

interface PageData {
  pageNumber: number;
  assetId: string;
  text: string | null;
  generatedImageUrl: string | null;
  isTitlePage: boolean;
}

interface BookData {
  id: string;
  title: string;
  childName: string | null;
  coverAssetId: string | null;
  pages: PageData[];
}

function optimizeForPrint(url: string | null | undefined): string {
  if (!url) return '';
  if (!url.includes('/image/upload/')) return url;
  return url.replace('/upload/', '/upload/f_auto,q_auto:best/');
}

function loadFontBase64(): string {
  try {
    return readFileSync(FONT_PATH).toString('base64');
  } catch {
    console.warn('Could not load Excalifont');
    return '';
  }
}

function fontFaceCSS(b64: string): string {
  if (!b64) return '';
  return `@font-face {
    font-family: 'Excalifont';
    src: url(data:font/woff2;base64,${b64}) format('woff2');
    font-weight: normal; font-style: normal;
  }`;
}

function pageDiv(style: string, content: string): string {
  return `<div class="page" style="width:${PAGE_W}in;height:${PAGE_H}in;position:relative;overflow:hidden;page-break-after:always;background-color:white;${style}">${content}</div>`;
}

function illustrationPage(imageUrl: string | null): string {
  if (!imageUrl) return pageDiv('', '<div style="display:flex;align-items:center;justify-content:center;height:100%">Image not generated</div>');
  return pageDiv('', `<img src="${optimizeForPrint(imageUrl)}" style="display:block;width:100%;height:100%;object-fit:cover;object-position:center" />`);
}

function textPage(text: string): string {
  return pageDiv('display:flex;align-items:center;justify-content:center',
    `<p style="font-family:'Excalifont',cursive,sans-serif;font-size:36px;color:#1a1a1a;text-align:center;line-height:1.5;max-width:70%;word-wrap:break-word">${text}</p>`);
}

function dedicationPage(name: string): string {
  return pageDiv('display:flex;flex-direction:column;align-items:center;justify-content:center', `
    <div style="text-align:center;max-width:70%">
      <p style="font-family:'Excalifont',cursive,sans-serif;font-size:32px;color:#1a1a1a;line-height:1.4;margin:0 0 0.15in 0">This book was made<br>especially for</p>
      <p style="font-family:'Excalifont',cursive,sans-serif;font-size:52px;color:${CORAL};line-height:1.3;margin:0;font-weight:bold">${name}</p>
    </div>
    <img src="${DEDICATION_MASCOT}" style="position:absolute;bottom:0.5in;right:0.5in;height:15%;width:auto;object-fit:contain" />
  `);
}

function endingPage(name: string): string {
  return pageDiv('display:flex;flex-direction:column;align-items:center;justify-content:center', `
    <div style="text-align:center;max-width:70%">
      <p style="font-family:'Excalifont',cursive,sans-serif;font-size:42px;color:#1a1a1a;line-height:1.3;margin:0 0 0.2in 0;font-weight:bold">The End</p>
      <p style="font-family:'Excalifont',cursive,sans-serif;font-size:28px;color:#1a1a1a;line-height:1.4;margin:0 0 0.1in 0">Until next time,</p>
      <p style="font-family:'Excalifont',cursive,sans-serif;font-size:48px;color:${CORAL};line-height:1.3;margin:0;font-weight:bold">${name}!</p>
    </div>
    <img src="${ENDING_MASCOT}" style="margin-top:0.4in;height:15%;width:auto;object-fit:contain" />
  `);
}

function blankPage(): string {
  return `<div class="page" style="width:${PAGE_W}in;height:${PAGE_H}in;page-break-after:always;background-color:white"></div>`;
}

// Book data fetched from Supabase
const BOOK: BookData = {
  id: 'cmm6imevk000xmy0du8ozmjos',
  title: 'Kai at Universal',
  childName: 'Kai',
  coverAssetId: 'cmm6imee60004my0dbab34qfv',
  pages: [
    { pageNumber: 1, assetId: 'cmm6imee60004my0dbab34qfv', text: null, generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295126/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_1.png', isTitlePage: true },
    { pageNumber: 2, assetId: 'cmm6imeen0006my0dzc2m1bt8', text: 'Kai climbs into the dark ride with Dada. Click, click, the bar goes down. Kai holds on tight. \u201cReady, Dada?\u201d he says. The car goes\u2026 RUMBLE, RATTLE, ROLL!', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295101/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_2.png', isTitlePage: false },
    { pageNumber: 3, assetId: 'cmm6imeg2000emy0dqlerpy17', text: 'Outside, rain goes drip-drop, drip-drop. Kai in his raincoat sees big costume people. Kai looks up, up, up. They look down, down, down. Everyone smiles.', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295111/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_3.png', isTitlePage: false },
    { pageNumber: 4, assetId: 'cmm6imeey0008my0di8j7oxpa', text: 'Click! A big group picture! Kai stands in the middle with Mama and Dada. The brave show people make strong muscles. Kai makes tiny strong muscles too. Grrr!', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295160/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_4.png', isTitlePage: false },
    { pageNumber: 5, assetId: 'cmm6imefp000cmy0d7ref0445', text: 'Inside, Kai sees a giant dinosaur skeleton. Its teeth look chompy-chomp-chomp! Kai\u2019s mouth makes a big O. \u201cROAR!\u201d he says. The restaurant echoes back, \u201cRoooar\u2026\u201d', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295162/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_5.png', isTitlePage: false },
    { pageNumber: 6, assetId: 'cmm6imefc000amy0d6w6ou7mq', text: 'Kai finds a silly monster game. The monster\u2019s mouth is full of bright balls. \u201cChomp chomp, I\u2019m hungry!\u201d Kai says in a monster voice and rolls another ball inside.', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295209/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_6.png', isTitlePage: false },
    { pageNumber: 7, assetId: 'cmm6imege000gmy0d3t9z7gf9', text: 'Now Kai stands by a huge colorful cannon. He pushes the handle with both hands. \u201cBoom?\u201d he whispers. \u201cBOOM!\u201d he shouts, giggling.', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295219/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_7.png', isTitlePage: false },
    { pageNumber: 8, assetId: 'cmm6imeh3000kmy0d1qzs2haz', text: 'Round and round the ride goes. Kai and Mama sit together in the orange car. \u201cUp, please!\u201d Kai calls. The floor shakes, \u201cclack-clack-clack.\u201d', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295208/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_8.png', isTitlePage: false },
    { pageNumber: 9, assetId: 'cmm6imegr000imy0d8ajvo8qa', text: 'WHOOSH! The flying cups lift into the air. Purple, orange, and green zoom past. Kai feels his tummy wiggle and laughs, \u201cWheee!\u201d', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295271/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_9.png', isTitlePage: false },
    { pageNumber: 10, assetId: 'cmm6imehf000mmy0dzothnvkk', text: 'Kai sits on a giant red chair. His feet don\u2019t touch the floor! Presents peek out of big boxes beside him. \u201cIs this Santa\u2019s chair?\u201d he whispers.', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295270/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_10.png', isTitlePage: false },
    { pageNumber: 11, assetId: 'cmm6imehs000omy0dbj34qc4t', text: 'Robots are everywhere! Kai walks past the big metal building and looks up, up, up. A huge yellow robot guards the sign. Kai hugs his toy tight.', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295272/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_11.png', isTitlePage: false },
    { pageNumber: 12, assetId: 'cmm6imei5000qmy0duuoahz47', text: 'Red lights flash. A giant robot steps out. \u201cStomp, stomp,\u201d goes the floor. Kai holds Mama\u2019s arm but keeps watching. His eyes say, \u201cWow.\u201d', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295316/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_12.png', isTitlePage: false },
    { pageNumber: 13, assetId: 'cmm6imeii000smy0drmdw53xw', text: 'Now it\u2019s picture time with the huge robot. Mama holds Kai. Dada reaches in close. The robot stands behind them, clangy and strong. Kai feels brave in the middle.', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295314/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_13.png', isTitlePage: false },
    { pageNumber: 14, assetId: 'cmm6imeiv000umy0ddbno7yjx', text: 'Night lights turn the street purple and green. Kai eats cold, sweet ice cream by the bright red truck. Lick, lick, lick\u2026 what a yummy end to his Universal day.', generatedImageUrl: 'https://res.cloudinary.com/storywink/image/upload/v1772295327/storywink/cmm6imevk000xmy0du8ozmjos/generated/page_14.png', isTitlePage: false },
  ],
};

async function main() {
  const book = BOOK;
  const fontB64 = loadFontBase64();
  const fontCSS = fontFaceCSS(fontB64);

  const titlePage = book.pages.find(p => p.assetId === book.coverAssetId);
  const storyPages = book.pages.filter(p => p.assetId !== book.coverAssetId);
  const displayName = book.childName || book.title || 'You';

  console.log(`Book: "${book.title}" — ${book.pages.length} total pages`);
  console.log(`Title page: page ${titlePage?.pageNumber ?? 'NOT FOUND'}`);
  console.log(`Story pages: ${storyPages.length}`);

  mkdirSync(join(process.cwd(), '.docs'), { recursive: true });

  // ========== INTERIOR PDF ==========
  console.log('\n--- Generating Interior PDF ---');

  let interiorPages: string[] = [];
  interiorPages.push(dedicationPage(displayName));
  for (const p of storyPages) {
    interiorPages.push(textPage(p.text || ''));
    interiorPages.push(illustrationPage(p.generatedImageUrl));
  }
  interiorPages.push(endingPage(displayName));

  // Pad to multiple of 4
  const remainder = interiorPages.length % 4;
  if (remainder !== 0) {
    const pad = 4 - remainder;
    for (let i = 0; i < pad; i++) interiorPages.push(blankPage());
  }

  console.log(`Interior pages: ${interiorPages.length} (padded to multiple of 4)`);

  const interiorHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${fontCSS} body{margin:0;padding:0}</style></head><body>${interiorPages.join('\n')}</body></html>`;

  console.log('Launching Chrome for interior...');
  let browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  let page = await browser.newPage();
  await page.setViewport({ width: Math.round(PAGE_W * DPI), height: Math.round(PAGE_H * DPI), deviceScaleFactor: 1 });
  await page.setContent(interiorHtml, { waitUntil: 'networkidle0' });

  console.log('Waiting for images to load...');
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img'));
    await Promise.all(imgs.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    }));
  });

  console.log('Rendering interior PDF...');
  const interiorPdf = await page.pdf({
    width: `${PAGE_W}in`, height: `${PAGE_H}in`,
    printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' },
    preferCSSPageSize: false,
  });
  await browser.close();

  const interiorPath = join(process.cwd(), `.docs/lulu-interior-${book.id}.pdf`);
  writeFileSync(interiorPath, Buffer.from(interiorPdf));
  console.log(`Interior PDF saved: ${interiorPath} (${(interiorPdf.length / 1024 / 1024).toFixed(1)} MB)`);

  // ========== COVER PDF ==========
  console.log('\n--- Generating Cover PDF ---');

  const coverImageUrl = titlePage?.generatedImageUrl || book.pages[0]?.generatedImageUrl;

  const coverHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    ${fontCSS}
    html,body{margin:0;padding:0;width:${COVER_W}in;height:${COVER_H}in;overflow:hidden}
    *{page-break-inside:avoid;page-break-before:avoid;page-break-after:avoid;break-inside:avoid;break-before:avoid;break-after:avoid}
  </style></head><body>
    <div style="width:${COVER_W}in;height:${COVER_H}in;display:flex;flex-direction:row;margin:0;padding:0">
      <!-- Back Cover (Left) -->
      <div style="width:${PANEL_W}in;height:${COVER_H}in;background-color:white;display:flex;flex-direction:column;justify-content:center;align-items:center;box-sizing:border-box">
        <div style="font-family:'Excalifont',cursive,sans-serif;font-size:48px;color:#1a1a1a;text-align:center;font-weight:bold">
          <span>Storywin</span><span style="color:${CORAL}">k.ai</span>
        </div>
        <img src="${BACK_COVER_MASCOT}" style="margin-top:0.4in;height:12%;width:auto;object-fit:contain" />
      </div>
      <!-- Front Cover (Right) -->
      <div style="width:${PANEL_W}in;height:${COVER_H}in;overflow:hidden">
        ${coverImageUrl
          ? `<img src="${optimizeForPrint(coverImageUrl)}" style="width:100%;height:100%;object-fit:cover;object-position:center" />`
          : `<div style="display:flex;align-items:center;justify-content:center;height:100%;background:#f0f0f0"><span style="font-size:48px;color:#666">Cover not available</span></div>`}
      </div>
    </div>
  </body></html>`;

  console.log('Launching Chrome for cover...');
  browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  page = await browser.newPage();
  await page.setViewport({ width: Math.round(COVER_W * DPI), height: Math.round(COVER_H * DPI), deviceScaleFactor: 1 });
  await page.setContent(coverHtml, { waitUntil: 'networkidle0' });

  console.log('Waiting for images to load...');
  await page.evaluate(async () => {
    const imgs = Array.from(document.querySelectorAll('img'));
    await Promise.all(imgs.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });
    }));
  });

  console.log('Rendering cover PDF...');
  const coverPdf = await page.pdf({
    width: `${COVER_W}in`, height: `${COVER_H}in`,
    printBackground: true, margin: { top: '0', right: '0', bottom: '0', left: '0' },
    preferCSSPageSize: false,
  });
  await browser.close();

  const coverPath = join(process.cwd(), `.docs/lulu-cover-${book.id}.pdf`);
  writeFileSync(coverPath, Buffer.from(coverPdf));
  console.log(`Cover PDF saved: ${coverPath} (${(coverPdf.length / 1024 / 1024).toFixed(1)} MB)`);

  console.log('\n=== Done ===');
  console.log(`Interior: ${interiorPath}`);
  console.log(`Cover:    ${coverPath}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

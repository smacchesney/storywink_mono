#!/usr/bin/env node
/**
 * Diagnose a book in the production database
 * Run with: railway run --service workers npx tsx scripts/diagnose-production-book.ts <bookId>
 */

import { PrismaClient } from '@storywink/database';

const prisma = new PrismaClient();

async function diagnoseProductionBook(bookId: string) {
  console.log('='.repeat(80));
  console.log(`Diagnosing Production Book: ${bookId}`);
  console.log('='.repeat(80));

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          isTitlePage: true,
          assetId: true,
          text: true,
          generatedImageUrl: true,
          moderationStatus: true,
          moderationReason: true,
          index: true,
        },
      },
    },
  });

  if (!book) {
    console.log(`❌ Book not found: ${bookId}`);
    process.exit(1);
  }

  console.log(`\n📚 Book Summary:`);
  console.log(`  - Title: ${book.title || '(untitled)'}`);
  console.log(`  - Status: ${book.status}`);
  console.log(`  - Page Length Setting: ${book.pageLength}`);
  console.log(`  - Cover Asset ID: ${book.coverAssetId || 'NOT SET'}`);
  console.log(`  - Total Pages in DB: ${book.pages.length}`);
  console.log(`  - Created: ${book.createdAt.toISOString()}`);

  // Calculate statistics
  const titlePages = book.pages.filter(p => p.isTitlePage);
  const storyPages = book.pages.filter(p => !p.isTitlePage);
  const pagesWithText = book.pages.filter(p => p.text && p.text.trim().length > 0);
  const pagesWithImages = book.pages.filter(p => p.generatedImageUrl);
  const titlePagesCalculated = book.pages.filter(p => p.assetId === book.coverAssetId);

  console.log(`\n📊 Page Statistics:`);
  console.log(`  - Title Pages (by flag): ${titlePages.length}`);
  console.log(`  - Title Pages (by coverAssetId): ${titlePagesCalculated.length}`);
  console.log(`  - Story Pages: ${storyPages.length}`);
  console.log(`  - Pages With Text: ${pagesWithText.length}`);
  console.log(`  - Pages With Images: ${pagesWithImages.length}`);

  console.log(`\n📄 Page Details:`);
  console.log('─'.repeat(80));

  for (const page of book.pages) {
    const isCalculatedTitle = page.assetId === book.coverAssetId;
    const hasText = page.text && page.text.trim().length > 0;
    const mismatch = page.isTitlePage !== isCalculatedTitle;

    console.log(`\nPage ${page.pageNumber} (index: ${page.index}):`);
    console.log(`  - ID: ${page.id}`);
    console.log(`  - Asset ID: ${page.assetId}`);
    console.log(`  - isTitlePage (DB): ${page.isTitlePage}`);
    console.log(`  - isTitlePage (calc): ${isCalculatedTitle} ${mismatch ? '⚠️ MISMATCH' : ''}`);
    console.log(`  - Has Text: ${hasText ? 'YES' : 'NO'} (${page.text?.length || 0} chars)`);

    if (hasText && page.text) {
      console.log(`  - Text: "${page.text.substring(0, 60)}${page.text.length > 60 ? '...' : ''}"`);
    } else {
      console.log(`  - Text: [EMPTY] ${!page.isTitlePage ? '⚠️ STORY PAGE WITHOUT TEXT!' : ''}`);
    }

    console.log(`  - Has Image: ${page.generatedImageUrl ? 'YES' : 'NO'}`);
    console.log(`  - Moderation: ${page.moderationStatus}`);

    if (page.moderationReason) {
      console.log(`  - Reason: ${page.moderationReason.substring(0, 80)}${page.moderationReason.length > 80 ? '...' : ''}`);
    }
  }

  // Identify issues
  console.log(`\n🔍 Issues Detected:`);
  console.log('─'.repeat(80));

  const issues: string[] = [];

  if (titlePages.length !== titlePagesCalculated.length) {
    issues.push(`Title page count mismatch: ${titlePages.length} (flag) vs ${titlePagesCalculated.length} (calculated)`);
  }

  const storyPagesWithoutText = storyPages.filter(p => !p.text || p.text.trim().length === 0);
  if (storyPagesWithoutText.length > 0) {
    issues.push(`${storyPagesWithoutText.length} story page(s) without text: ${storyPagesWithoutText.map(p => p.pageNumber).join(', ')}`);
  }

  const pagesWithMismatch = book.pages.filter(p => (p.assetId === book.coverAssetId) !== p.isTitlePage);
  if (pagesWithMismatch.length > 0) {
    issues.push(`${pagesWithMismatch.length} page(s) with isTitlePage mismatch: ${pagesWithMismatch.map(p => p.pageNumber).join(', ')}`);
  }

  if (book.pages.length !== book.pageLength) {
    issues.push(`Page count mismatch: expected ${book.pageLength}, got ${book.pages.length}`);
  }

  if (issues.length === 0) {
    console.log('✅ No issues detected');
  } else {
    issues.forEach((issue, i) => {
      console.log(`${i + 1}. ⚠️  ${issue}`);
    });
  }

  console.log('\n' + '='.repeat(80));
}

const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: npx tsx scripts/diagnose-production-book.ts <bookId>');
  console.error('   Or: railway run --service workers npx tsx scripts/diagnose-production-book.ts <bookId>');
  process.exit(1);
}

diagnoseProductionBook(bookId)
  .then(() => {
    console.log('\n✅ Diagnostic complete\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  });

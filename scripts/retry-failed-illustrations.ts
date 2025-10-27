#!/usr/bin/env tsx
/**
 * Retry failed illustration generation for specific pages
 *
 * Usage: npx tsx scripts/retry-failed-illustrations.ts <bookId> <pageId1> <pageId2> ...
 * Example: npx tsx scripts/retry-failed-illustrations.ts cmh50jkn10044r10diijrjdq7 cmh50jknq0049r10d6atahwv7
 */

import prisma from '../packages/database/src/index.js';

const bookId = process.argv[2];
const pageIds = process.argv.slice(3);

if (!bookId || pageIds.length === 0) {
  console.error('Usage: npx tsx scripts/retry-failed-illustrations.ts <bookId> <pageId1> <pageId2> ...');
  console.error('');
  console.error('To retry all failed pages for book cmh50jkn10044r10diijrjdq7:');
  console.error('npx tsx scripts/retry-failed-illustrations.ts cmh50jkn10044r10diijrjdq7 cmh50jknq0049r10d6atahwv7 cmh50jknq004ar10dr24ksk0c cmh50jknq004br10dmuekvtli cmh50jknq004dr10ddc6wz4k4');
  process.exit(1);
}

console.log(`Resetting failed pages for book ${bookId}...`);
console.log(`Page IDs: ${pageIds.join(', ')}`);

async function resetFailedPages() {
  try {
    // Reset moderation status to allow retry
    const result = await prisma.page.updateMany({
      where: {
        bookId,
        id: { in: pageIds },
        moderationStatus: 'FAILED'
      },
      data: {
        moderationStatus: 'PENDING',
        moderationReason: null
      }
    });

    console.log(`✓ Reset ${result.count} pages to PENDING status`);

    // Fetch the updated pages
    const pages = await prisma.page.findMany({
      where: {
        bookId,
        id: { in: pageIds }
      },
      select: {
        id: true,
        pageNumber: true,
        moderationStatus: true,
        text: true,
        isTitlePage: true
      },
      orderBy: { pageNumber: 'asc' }
    });

    console.log('\nUpdated pages:');
    pages.forEach(p => {
      console.log(`  Page ${p.pageNumber}: ${p.moderationStatus} (${p.isTitlePage ? 'title' : 'story'}, ${p.text?.length || 0} chars)`);
    });

    console.log('\n✓ Pages reset successfully!');
    console.log('\nNext step: Trigger illustration generation via the API or web UI');
    console.log('The pages are now ready to be reprocessed by the current worker deployment.');

  } catch (error) {
    console.error('Error resetting pages:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

resetFailedPages();

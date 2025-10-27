import { PrismaClient } from '@storywink/database';

const prisma = new PrismaClient();

async function diagnoseBook(bookId: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Diagnosing Book: ${bookId}`);
  console.log('='.repeat(80));

  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        include: {
          asset: true,
        },
      },
    },
  });

  if (!book) {
    console.log(`❌ Book not found: ${bookId}`);
    return;
  }

  console.log(`\n📚 Book Info:`);
  console.log(`  - Title: ${book.title}`);
  console.log(`  - Status: ${book.status}`);
  console.log(`  - Cover Asset ID: ${book.coverAssetId}`);
  console.log(`  - Total Pages: ${book.pages.length}`);
  console.log(`  - Created: ${book.createdAt}`);

  console.log(`\n📄 Pages Analysis:`);
  console.log(`${'─'.repeat(80)}`);

  for (const page of book.pages) {
    const isTitlePage = page.assetId === book.coverAssetId;
    const hasText = page.text && page.text.trim().length > 0;
    const hasIllustration = !!page.generatedImageUrl;

    console.log(`\nPage ${page.pageNumber}:`);
    console.log(`  - Page ID: ${page.id}`);
    console.log(`  - Asset ID: ${page.assetId}`);
    console.log(`  - Is Title Page (calculated): ${isTitlePage}`);
    console.log(`  - Is Title Page (database): ${page.isTitlePage}`);
    console.log(`  - Has Text: ${hasText}`);
    console.log(`  - Text Length: ${page.text?.length || 0} chars`);
    console.log(`  - Text Preview: ${page.text ? page.text.substring(0, 50) + '...' : 'NO TEXT'}`);
    console.log(`  - Has Illustration: ${hasIllustration}`);
    console.log(`  - Moderation Status: ${page.moderationStatus}`);

    if (page.moderationReason) {
      console.log(`  - Moderation Reason: ${page.moderationReason.substring(0, 100)}`);
    }

    // Flag issues
    if (!isTitlePage && !hasText) {
      console.log(`  ⚠️  WARNING: Story page with no text!`);
    }
    if (isTitlePage !== page.isTitlePage) {
      console.log(`  ⚠️  MISMATCH: Calculated isTitlePage (${isTitlePage}) != Database (${page.isTitlePage})`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log(`Summary:`);
  console.log(`${'='.repeat(80)}`);

  const titlePages = book.pages.filter(p => p.assetId === book.coverAssetId);
  const storyPages = book.pages.filter(p => p.assetId !== book.coverAssetId);
  const pagesWithoutText = book.pages.filter(p => !p.text || p.text.trim().length === 0);
  const pagesWithIllustrations = book.pages.filter(p => p.generatedImageUrl);
  const mismatchedPages = book.pages.filter(p => (p.assetId === book.coverAssetId) !== p.isTitlePage);

  console.log(`  - Title Pages: ${titlePages.length}`);
  console.log(`  - Story Pages: ${storyPages.length}`);
  console.log(`  - Pages Without Text: ${pagesWithoutText.length}`);
  console.log(`  - Pages With Illustrations: ${pagesWithIllustrations.length}`);
  console.log(`  - Pages With isTitlePage Mismatch: ${mismatchedPages.length}`);

  if (pagesWithoutText.length > 0) {
    console.log(`\n  ⚠️  Pages without text: ${pagesWithoutText.map(p => p.pageNumber).join(', ')}`);
  }

  if (mismatchedPages.length > 0) {
    console.log(`\n  ⚠️  Pages with isTitlePage mismatch: ${mismatchedPages.map(p => p.pageNumber).join(', ')}`);
  }

  console.log(`\n${'='.repeat(80)}\n`);
}

const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: npx tsx scripts/diagnose-book.ts <bookId>');
  process.exit(1);
}

diagnoseBook(bookId)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

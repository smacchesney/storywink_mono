import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function debugBookPages(bookId: string) {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    include: {
      pages: {
        orderBy: { index: 'asc' },
        select: {
          id: true,
          pageNumber: true,
          index: true,
          isTitlePage: true,
          text: true,
          assetId: true,
          originalImageUrl: true,
        },
      },
    },
  });

  if (!book) {
    console.error(`Book not found: ${bookId}`);
    return;
  }

  console.log('\n=== BOOK DEBUG INFO ===');
  console.log(`Book ID: ${book.id}`);
  console.log(`Title: ${book.title || '(empty)'}`);
  console.log(`Status: ${book.status}`);
  console.log(`Page Length: ${book.pageLength}`);
  console.log(`Cover Asset ID: ${book.coverAssetId}`);
  console.log(`Total Pages in DB: ${book.pages.length}`);
  console.log('');

  console.log('=== PAGE DETAILS ===');
  book.pages.forEach((page) => {
    console.log(`\nPage ${page.pageNumber}:`);
    console.log(`  - ID: ${page.id}`);
    console.log(`  - Index: ${page.index}`);
    console.log(`  - Is Title Page: ${page.isTitlePage}`);
    console.log(`  - Asset ID: ${page.assetId}`);
    console.log(`  - Has Text: ${!!page.text} (${page.text?.length || 0} chars)`);
    console.log(`  - Text Preview: ${page.text?.substring(0, 50) || '(no text)'}...`);
    console.log(`  - Has Original Image: ${!!page.originalImageUrl}`);
  });

  console.log('\n=== ANALYSIS ===');
  const titlePages = book.pages.filter(p => p.isTitlePage);
  const storyPages = book.pages.filter(p => !p.isTitlePage);
  const pagesWithText = book.pages.filter(p => p.text && p.text.trim());
  const pagesWithoutText = book.pages.filter(p => !p.text || !p.text.trim());

  console.log(`Title Pages: ${titlePages.length} (should be 1)`);
  console.log(`Story Pages: ${storyPages.length} (should be ${book.pageLength - 1})`);
  console.log(`Pages With Text: ${pagesWithText.length}`);
  console.log(`Pages Without Text: ${pagesWithoutText.length}`);

  if (pagesWithoutText.length > 0) {
    console.log('\nPages missing text:');
    pagesWithoutText.forEach(p => {
      console.log(`  - Page ${p.pageNumber} (index ${p.index}, isTitlePage: ${p.isTitlePage})`);
    });
  }

  await prisma.$disconnect();
}

// Get bookId from command line
const bookId = process.argv[2];
if (!bookId) {
  console.error('Usage: tsx scripts/debug-book-pages.ts <bookId>');
  process.exit(1);
}

debugBookPages(bookId);

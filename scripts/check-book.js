import { prisma } from '@storywink/database';

async function main() {
  const bookId = 'cmi34mq6r000l6dcfww2ag46u';

  // Get book info
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      updatedAt: true
    }
  });

  console.log('='.repeat(80));
  console.log('BOOK STATUS:');
  console.log('='.repeat(80));
  console.log(JSON.stringify(book, null, 2));
  console.log('');

  // Get all pages
  const pages = await prisma.page.findMany({
    where: { bookId },
    orderBy: { pageNumber: 'asc' },
    select: {
      id: true,
      pageNumber: true,
      assetId: true,
      generatedImageUrl: true,
      moderationStatus: true,
      createdAt: true,
      updatedAt: true
    }
  });

  console.log('='.repeat(80));
  console.log('PAGES:');
  console.log('='.repeat(80));
  pages.forEach(page => {
    console.log(`Page ${page.pageNumber}:`);
    console.log(`  - ID: ${page.id}`);
    console.log(`  - Has Generated Image: ${!!page.generatedImageUrl}`);
    console.log(`  - Moderation Status: ${page.moderationStatus}`);
    console.log(`  - Updated: ${page.updatedAt.toISOString()}`);
  });

  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY:');
  console.log('='.repeat(80));
  const withImages = pages.filter(p => p.generatedImageUrl).length;
  console.log(`Total Pages: ${pages.length}`);
  console.log(`Pages with Generated Images: ${withImages}`);
  console.log(`Book Status: ${book?.status || 'unknown'}`);
  console.log('='.repeat(80));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

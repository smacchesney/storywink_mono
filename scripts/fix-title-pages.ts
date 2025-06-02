/**
 * Script to fix title page inconsistencies in existing data
 * Run this with: npx tsx scripts/fix-title-pages.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function fixTitlePageInconsistencies() {
  console.log('🔧 Starting title page consistency fix...');
  
  try {
    // Get all books with their pages
    const books = await prisma.book.findMany({
      include: {
        pages: {
          orderBy: { pageNumber: 'asc' },
        },
      },
    });

    console.log(`📚 Found ${books.length} books to check`);

    let totalUpdates = 0;

    for (const book of books) {
      console.log(`\n📖 Checking book ${book.id} (${book.title || 'Untitled'})`);
      
      const updates = [];
      let bookUpdates = 0;

      for (const page of book.pages) {
        // Determine what isTitlePage should be based on coverAssetId
        const shouldBeTitlePage = page.assetId === book.coverAssetId && page.assetId !== null;
        const currentIsTitlePage = page.isTitlePage;

        if (shouldBeTitlePage !== currentIsTitlePage) {
          console.log(`  ⚠️  Page ${page.pageNumber}: isTitlePage should be ${shouldBeTitlePage} but is ${currentIsTitlePage}`);
          
          updates.push(
            prisma.page.update({
              where: { id: page.id },
              data: { isTitlePage: shouldBeTitlePage },
            })
          );
          bookUpdates++;
        }
      }

      if (updates.length > 0) {
        console.log(`  🔄 Updating ${updates.length} pages for book ${book.id}`);
        await Promise.all(updates);
        totalUpdates += bookUpdates;
      } else {
        console.log(`  ✅ Book ${book.id} is already consistent`);
      }
    }

    console.log(`\n🎉 Migration completed!`);
    console.log(`📊 Total updates: ${totalUpdates} pages across ${books.length} books`);

  } catch (error) {
    console.error('❌ Error during migration:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
fixTitlePageInconsistencies()
  .catch((error) => {
    console.error('💥 Migration failed:', error);
    process.exit(1);
  });
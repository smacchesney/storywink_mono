import { PrismaClient } from '@storywink/database';

const prisma = new PrismaClient();

async function listRecentBooks() {
  const books = await prisma.book.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      _count: {
        select: { pages: true }
      }
    }
  });

  console.log('Recent Books (last 10):');
  console.log('='.repeat(80));
  books.forEach((book, index) => {
    console.log(`${index + 1}. ${book.title}`);
    console.log(`   ID: ${book.id}`);
    console.log(`   Status: ${book.status}`);
    console.log(`   Pages: ${book._count.pages}`);
    console.log(`   Created: ${book.createdAt.toISOString()}`);
    console.log('');
  });
}

listRecentBooks()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });

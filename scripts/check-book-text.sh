#!/bin/bash
# Quick check if a book's pages have text in production

if [ -z "$1" ]; then
  echo "Usage: ./scripts/check-book-text.sh <bookId>"
  exit 1
fi

BOOK_ID=$1

echo "Checking text status for book: $BOOK_ID"
echo "========================================"

railway run --service workers npx tsx -e "
import { PrismaClient } from '@storywink/database';
const prisma = new PrismaClient();

async function checkText() {
  const book = await prisma.book.findUnique({
    where: { id: '$BOOK_ID' },
    include: {
      pages: {
        orderBy: { pageNumber: 'asc' },
        select: {
          pageNumber: true,
          isTitlePage: true,
          text: true,
        }
      }
    }
  });

  if (!book) {
    console.log('Book not found');
    process.exit(1);
  }

  console.log('Book:', book.title);
  console.log('Status:', book.status);
  console.log('\\nPages:');
  book.pages.forEach(p => {
    const hasText = p.text && p.text.trim().length > 0;
    const textPreview = hasText ? p.text.substring(0, 50) + '...' : 'NO TEXT';
    console.log(\`  Page \${p.pageNumber}: isTitlePage=\${p.isTitlePage}, hasText=\${hasText}, text=\"\${textPreview}\"\`);
  });
}

checkText().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
"

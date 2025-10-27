#!/bin/bash
# Diagnose a book in production Railway database

if [ -z "$1" ]; then
  echo "Usage: ./scripts/diagnose-production-book.sh <bookId>"
  exit 1
fi

BOOK_ID=$1

echo "Querying production database for book: $BOOK_ID"
echo "=========================================="

# Use Railway CLI to execute query on production database
railway run --service workers npx prisma db execute --stdin <<EOF
SELECT
  b.id,
  b.title,
  b.status,
  b."createdAt",
  b."pageLength",
  b."coverAssetId",
  (SELECT COUNT(*) FROM "Page" WHERE "bookId" = b.id) as total_pages,
  (SELECT COUNT(*) FROM "Page" WHERE "bookId" = b.id AND "isTitlePage" = true) as title_pages,
  (SELECT COUNT(*) FROM "Page" WHERE "bookId" = b.id AND text IS NOT NULL AND text != '') as pages_with_text,
  (SELECT COUNT(*) FROM "Page" WHERE "bookId" = b.id AND "generatedImageUrl" IS NOT NULL) as pages_with_images
FROM "Book" b
WHERE b.id = '$BOOK_ID';
EOF

echo ""
echo "Page details:"
echo "=========================================="

railway run --service workers npx prisma db execute --stdin <<EOF
SELECT
  "pageNumber",
  "isTitlePage",
  "assetId",
  CASE WHEN text IS NULL THEN 'NULL'
       WHEN text = '' THEN 'EMPTY'
       ELSE LEFT(text, 50) || '...'
  END as text_preview,
  LENGTH(text) as text_length,
  CASE WHEN "generatedImageUrl" IS NULL THEN 'NO' ELSE 'YES' END as has_image,
  "moderationStatus"
FROM "Page"
WHERE "bookId" = '$BOOK_ID'
ORDER BY "pageNumber" ASC;
EOF

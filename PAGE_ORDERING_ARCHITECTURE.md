# Page Ordering and Text Association Architecture

## Overview

The Storywink application manages pages as individual records in the database, with text and illustrations tied to specific page records. This document explains how page ordering, text association, and reordering work throughout the system.

## Database Schema

### Page Model Structure
```prisma
model Page {
  id         String @id @default(cuid())
  bookId     String
  pageNumber Int      // 1-based sequential number
  index      Int      // 0-based ordering index
  
  assetId String?    // Links to uploaded photo
  asset   Asset?     @relation(fields: [assetId], references: [id])
  
  originalImageUrl  String?   // User's uploaded photo
  generatedImageUrl String?   // AI-generated illustration
  text              String?   // Story text for this page
  textConfirmed     Boolean?  // Whether text has been confirmed
  illustrationNotes String?   // Winkify mode notes
  
  isTitlePage Boolean @default(false)  // Is this the cover/title page?
  
  pageType         PageType  // SINGLE or SPREAD
  moderationStatus String   
  book             Book     @relation(fields: [bookId], references: [id])
}
```

### Key Fields for Ordering
- **`index`**: 0-based position in the book (cover = 0, first story page = 1, etc.)
- **`pageNumber`**: 1-based display number (cover = 1, first story page = 2, etc.)
- **`isTitlePage`**: Boolean flag for cover page (should match `assetId === book.coverAssetId`)

## Page Creation Flow

### 1. Initial Book Creation
**File**: `apps/web/src/app/api/book/create/route.ts`

When a book is created with uploaded photos:
```typescript
const pagesData = assetIds.map((assetId, index) => ({
  bookId: book.id,
  pageNumber: index + 1,      // 1-based
  index: index,               // 0-based
  assetId: assetId,
  originalImageUrl: asset.thumbnailUrl || asset.url,
  pageType: PageType.SINGLE,
  isTitlePage: index === 0,   // First photo becomes cover
}));
```

### 2. Adding Photos Later
**File**: `apps/web/src/app/api/cloudinary/notify/route.ts`

When new photos are added:
```typescript
// Get current page count
const bookPageCount = await tx.page.count({ where: { bookId } });

// Create new pages at the end
const newPage = await tx.page.create({
  data: {
    bookId,
    assetId: newAsset.id,
    pageNumber: bookPageCount + 1,  // Append at end
    index: bookPageCount,            // Next available index
    originalImageUrl: asset.thumbnailUrl || asset.url,
    pageType: 'SINGLE',
    isTitlePage: false,             // New photos are never title pages
  },
});
```

## Story Generation and Text Association

### How Text is Assigned to Pages
**File**: `apps/workers/src/workers/story-generation.worker.ts`

1. **Filter out cover page**:
```typescript
const storyPages = book.pages.filter(page => page.assetId !== book.coverAssetId);
```

2. **Generate story for remaining pages**:
```typescript
// Story pages are numbered 1, 2, 3... for the AI
storyPages.map((page, index) => ({
  pageId: page.id,
  pageNumber: index + 1,  // 1-based for AI prompt
  assetId: page.assetId,
  originalImageUrl: page.asset?.url
}))
```

3. **AI returns text mapped by position**:
```json
{
  "1": "Text for first story page",
  "2": "Text for second story page",
  "3": "Text for third story page"
}
```

4. **Text is saved to page records**:
```typescript
// Map AI response back to pages
storyPages.map((page, index) => {
  const storyPosition = index + 1;
  const text = aiResponse[storyPosition.toString()];
  
  return prisma.page.update({
    where: { id: page.id },
    data: { 
      text: text,
      textConfirmed: true
    }
  });
});
```

### Key Insight: Text Follows the Page Record
- Text is stored directly on the Page record
- When pages are reordered, the text moves with the page
- This ensures text always matches its associated photo

## Page Reordering

### Reorder Endpoint
**File**: `apps/web/src/app/api/book/[bookId]/reorder/route.ts`

The reorder endpoint updates page positions:
```typescript
pages.map(page => 
  tx.page.updateMany({
    where: { id: page.pageId, bookId: bookId },
    data: {
      index: page.index,
      pageNumber: page.index + 1,
      isTitlePage: page.index === 0,  // Page at index 0 becomes title
    }
  })
);
```

### Edit Page UI
**File**: `apps/web/src/app/create/[bookId]/edit/page.tsx`

The edit page shows pages differently:
1. **Filters out the cover page** for the storyboard grid
2. **Creates temporary display indices** (0-based for story pages)
3. **Re-inserts cover at index 0** when saving

```typescript
// Display logic
const filteredPages = bookData.pages
  .filter(page => page.assetId !== bookData.coverAssetId)
  .sort((a, b) => a.pageNumber - b.pageNumber);

// When saving reorder
const reorderedPages = [
  { pageId: coverPageId, index: 0 },  // Cover always first
  ...storyPages.map((page, idx) => ({ 
    pageId: page.id, 
    index: idx + 1  // Story pages start at index 1
  }))
];
```

## Title/Cover Page Logic

### Identifying Title Pages
**File**: `packages/shared/src/utils.ts`

```typescript
export function isTitlePage(
  pageAssetId: string | null, 
  bookCoverAssetId: string | null
): boolean {
  return pageAssetId === bookCoverAssetId && pageAssetId !== null;
}
```

### Cover Changes
When the book's `coverAssetId` changes:
1. The old cover page becomes a regular story page
2. The new cover page should be moved to index 0
3. The `isTitlePage` field needs updating via reorder

## Page Display and Sorting

### Review Page
**File**: `apps/web/src/app/create/review/page.tsx`

Pages are displayed in order by index:
```typescript
const sortedPages = [...fetchedBook.pages].sort((a, b) => a.index - b.index);
```

### Library View
**File**: `apps/web/src/app/library/page.tsx`

Books show pages ordered by `pageNumber`:
```typescript
pages: {
  orderBy: { pageNumber: 'asc' }
}
```

## Common Patterns and Gotchas

### 1. Index vs PageNumber
- **`index`**: 0-based, used for internal ordering
- **`pageNumber`**: 1-based, used for display
- Always: `pageNumber = index + 1`

### 2. Cover Page Filtering
Many components filter out the cover:
```typescript
pages.filter(page => page.assetId !== book.coverAssetId)
```

### 3. Text Association
- Text is **permanently linked** to its Page record
- Reordering pages **moves the text with them**
- To keep text in position, you'd need to copy text between pages

### 4. Story Generation Scope
- Story generation **excludes** the cover page
- Generated text uses 1-based numbering for story pages
- The AI doesn't know about the cover page

### 5. Page Count Considerations
- `book.pageLength`: Total expected pages (including cover)
- `storyPages.length`: Should equal `book.pageLength - 1`
- New photos increment the actual page count

## File Reference Guide

### Core Page Management Files
- **Page Creation**: 
  - `apps/web/src/app/api/book/create/route.ts`
  - `apps/web/src/app/api/cloudinary/notify/route.ts`
- **Page Reordering**: 
  - `apps/web/src/app/api/book/[bookId]/reorder/route.ts`
  - `apps/web/src/app/create/[bookId]/edit/page.tsx`
- **Story Generation**: 
  - `apps/workers/src/workers/story-generation.worker.ts`
- **Page Display**:
  - `apps/web/src/app/create/review/page.tsx`
  - `apps/web/src/components/create/review/PageCard.tsx`
- **Utilities**:
  - `packages/shared/src/utils.ts` (isTitlePage, categorizePages)

### Database Schema
- `packages/database/prisma/schema.prisma`

### Type Definitions
- `packages/shared/src/types.ts` (Page, Book, StoryboardPage types)

## Debugging Page Issues

### Check Page State
```sql
-- View all pages for a book in order
SELECT id, index, "pageNumber", "assetId", "isTitlePage", 
       LENGTH(text) as text_length, "textConfirmed"
FROM "Page" 
WHERE "bookId" = 'YOUR_BOOK_ID'
ORDER BY index;
```

### Common Issues
1. **"No text yet" on last page**: Story generation didn't create text for all pages
2. **Wrong text after reorder**: This is usually correct behavior - text follows its page
3. **Cover page in wrong position**: Check if `isTitlePage` matches `assetId === book.coverAssetId`
4. **Missing pages**: Compare `book.pageLength` with actual page count

## Future Improvements

1. **Link text to photos**: Add `sourceAssetId` to track which photo the text was generated for
2. **Text versioning**: Keep history of text changes when regenerating
3. **Flexible reordering**: Option to reorder pages while keeping text in position
4. **Better cover handling**: Explicit cover page type instead of relying on assetId matching
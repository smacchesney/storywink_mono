# Text-Page Association Fix Plan

## Problem Summary

When reordering pages or adding new photos, the story text is not correctly associated with pages, causing:
1. Text appearing on wrong pages after reordering
2. Last page showing "No text yet"
3. Confusion between visual order and database order

## Root Causes

### 1. Position-Based Text Assignment
- Story generation assigns text based on **position in filtered array** at generation time
- When pages are reordered, text stays with page records but visual order changes
- No link between text and the actual photo/asset

### 2. Index Misalignment
- Database: Cover page at index 0, story pages at indices 1+
- UI (edit page): Filters out cover, shows story pages with indices 0+
- This creates confusion when reordering

### 3. Page Count Mismatch
- Story generation creates text for N story pages (excluding cover)
- But the book might have N+1 total pages (including cover)
- Last page might not receive text if there's an off-by-one error

## Solution Approach

### Fix 1: Ensure Consistent Text Generation
Update the story generation worker to:
1. Log exact page counts and mappings
2. Ensure all story pages receive text
3. Handle edge cases where page count doesn't match expected

### Fix 2: Improve Reorder Logic
Update the reorder endpoint to:
1. Maintain consistent indexing
2. Properly handle cover page changes
3. Add option to preserve text associations

### Fix 3: Fix Edit Page Display
Update the edit page to:
1. Show actual database indices
2. Make it clear which page is the cover
3. Properly handle new photo additions

## Implementation Steps

### Step 1: Add Diagnostic Logging
First, add detailed logging to understand the exact issue:

```typescript
// In story-generation.worker.ts
logger.info({
  bookId,
  totalPages: book.pages.length,
  coverAssetId: book.coverAssetId,
  storyPagesCount: storyPages.length,
  expectedPageLength: book.pageLength,
  storyPageIds: storyPages.map(p => ({ id: p.id, index: p.index, pageNumber: p.pageNumber }))
}, 'Story generation page analysis');
```

### Step 2: Fix Page Count Validation
Ensure the story generation handles the correct number of pages:

```typescript
// Add validation
if (storyPages.length !== book.pageLength - 1) {
  logger.warn({
    bookId,
    storyPagesCount: storyPages.length,
    expectedStoryPages: book.pageLength - 1,
    bookPageLength: book.pageLength
  }, 'Page count mismatch - story pages vs expected');
}
```

### Step 3: Fix Reorder to Maintain Text Association
Add option to reorder while preserving text:

```typescript
// In reorder endpoint
const preserveText = req.body.preserveText ?? true;

if (preserveText) {
  // Create a map of pageId to text before reordering
  const textMap = new Map(
    existingPages.map(p => [p.id, { text: p.text, illustrationNotes: p.illustrationNotes }])
  );
  
  // After reordering, restore text to same pages
  updates = pages.map(page => ({
    where: { id: page.id },
    data: {
      index: page.index,
      pageNumber: page.pageNumber,
      isTitlePage: page.index === 0,
      // Restore original text
      text: textMap.get(page.id)?.text || page.text,
      illustrationNotes: textMap.get(page.id)?.illustrationNotes || page.illustrationNotes
    }
  }));
}
```

### Step 4: Fix "No Text" on Last Page
Check if the last page is being skipped:

```typescript
// In story-generation.worker.ts, after parsing response
const missingPages = storyPages.filter(page => 
  !Object.keys(parsedResponse).some(key => {
    const pageIndex = parseInt(key) - 1;
    return storyPages[pageIndex]?.id === page.id;
  })
);

if (missingPages.length > 0) {
  logger.error({
    bookId,
    missingPageIds: missingPages.map(p => p.id),
    missingPageNumbers: missingPages.map(p => p.pageNumber),
    responseKeys: Object.keys(parsedResponse)
  }, 'Some pages did not receive text');
}
```

### Step 5: Fix Edit Page Index Display
Update the edit page to show real indices:

```typescript
// Instead of creating temporary indices
const storyPagesWithRealIndices = bookData.pages
  .filter(page => page.assetId !== bookData.coverAssetId)
  .sort((a, b) => a.index - b.index)
  .map(page => ({
    ...page,
    displayIndex: page.index - 1, // Show 0-based index for story pages
    isCover: false
  }));
```

## Testing Plan

1. Create a book with 3 photos
2. Generate story - verify all pages have text
3. Reorder pages - verify text stays with correct photos
4. Add a new photo - verify existing text is preserved
5. Change cover - verify title page updates correctly

## Migration Strategy

For existing books with text issues:
1. Identify books where last page has no text
2. Re-run story generation for affected books
3. Add monitoring to catch future issues

## Success Metrics

- No more "No text yet" on last pages
- Text stays with correct photos after reordering
- Clear visual indication of page order in UI
- Consistent behavior when adding new photos
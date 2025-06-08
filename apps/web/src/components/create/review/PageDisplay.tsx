import React from 'react';
import { StoryboardPage } from '@storywink/shared';

interface PageDisplayProps {
  page: StoryboardPage;
  bookCoverAssetId: string | null;
  pageIndex: number;
  totalPages: number;
}

export function PageDisplay({ page, bookCoverAssetId, pageIndex, totalPages: _totalPages }: PageDisplayProps) {
  const isCoverPage = page.assetId === bookCoverAssetId;
  const displayPageNumber = isCoverPage ? 'Cover' : `Page ${pageIndex}`;
  
  return (
    <div className="page-display">
      <div className="page-header">
        <span className="page-number">{displayPageNumber}</span>
        {isCoverPage && <span className="cover-badge">Title Page</span>}
      </div>
      
      <div className="page-content">
        {page.originalImageUrl && (
          <img src={page.originalImageUrl} alt={`${displayPageNumber}`} />
        )}
        
        <div className="page-text">
          {isCoverPage ? (
            <p className="cover-text">This is your book's cover page</p>
          ) : (
            <p>{page.text || "No text yet."}</p>
          )}
        </div>
      </div>
      
      {!page.text && !isCoverPage && (
        <div className="no-text-warning">
          This page is missing text. Try regenerating the story.
        </div>
      )}
    </div>
  );
}
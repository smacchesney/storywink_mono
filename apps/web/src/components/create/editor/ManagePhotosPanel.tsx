"use client";

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { X, Plus, Camera } from 'lucide-react';
import { StoryboardPage, optimizeCloudinaryUrl, BOOK_CONSTRAINTS } from '@storywink/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import useMediaQuery from '@/hooks/useMediaQuery';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from '@/components/ui/drawer';

interface ManagePhotosPanelProps {
  isOpen: boolean;
  onClose: () => void;
  pages: StoryboardPage[];
  coverAssetId: string | null | undefined;
  onDeleteRequest: (pageId: string, isCover: boolean) => void;
  onAddPhotosClick: () => void;
  minPagesReached: boolean;
}

// Individual photo thumbnail with delete button
function PhotoThumbnail({
  page,
  isCover,
  onDeleteClick,
  canDelete,
}: {
  page: StoryboardPage;
  isCover: boolean;
  onDeleteClick: () => void;
  canDelete: boolean;
}) {
  const t = useTranslations('editor');
  const imageUrl = page.asset?.thumbnailUrl || (page.asset?.url ? optimizeCloudinaryUrl(page.asset.url) : null);

  return (
    <div className="relative aspect-square rounded-lg overflow-hidden bg-gray-100 group">
      {/* Photo */}
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={t('pageAlt', { n: page.pageNumber })}
          fill
          sizes="(max-width: 768px) 25vw, 80px"
          style={{ objectFit: 'cover' }}
          className="pointer-events-none"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-xs text-gray-400">
          {t('noImage')}
        </div>
      )}

      {/* Cover badge */}
      {isCover && (
        <div className="absolute bottom-1 left-1 z-10 bg-[#F76C5E] text-white text-[9px] font-semibold px-1.5 py-0.5 rounded">
          {t('coverBadge')}
        </div>
      )}

      {/* Delete button */}
      <button
        onClick={onDeleteClick}
        disabled={!canDelete}
        className={cn(
          'absolute top-1 right-1 z-10',
          'w-5 h-5 rounded-full',
          'flex items-center justify-center',
          'transition-all duration-200',
          canDelete
            ? 'bg-[#F76C5E] text-white hover:bg-[#E55A4C] hover:scale-110 active:scale-95 cursor-pointer'
            : 'bg-gray-300 text-gray-500 cursor-not-allowed opacity-60'
        )}
        aria-label={isCover ? t('cannotDeleteCoverTitle') : t('pageAlt', { n: page.pageNumber })}
        title={isCover ? t('selectDifferentCover') : canDelete ? t('deletePhotoAria') : t('minPhotosDeleteTitle')}
      >
        <X className="h-3 w-3" strokeWidth={3} />
      </button>
    </div>
  );
}

// Panel content (shared between Sheet and Drawer)
function PanelContent({
  pages,
  coverAssetId,
  onDeleteRequest,
  onAddPhotosClick,
  onClose,
  minPagesReached,
}: Omit<ManagePhotosPanelProps, 'isOpen'>) {
  const t = useTranslations('editor');
  const tc = useTranslations('common');
  // Sort pages by index
  const sortedPages = [...pages].sort((a, b) => a.index - b.index);
  const photoCount = sortedPages.length;
  const maxPhotos = BOOK_CONSTRAINTS.MAX_PHOTOS;
  const isAtMaxPhotos = photoCount >= maxPhotos;
  const remainingPhotos = maxPhotos - photoCount;

  return (
    <>
      {/* Photo counter - prominent display */}
      <div className="px-4 py-3 border-b bg-gray-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Camera className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700">
              {t('photoCount', { count: photoCount, max: maxPhotos })}
            </span>
          </div>
          {isAtMaxPhotos ? (
            <span className="text-xs text-amber-600 font-medium">
              {t('maximumReached')}
            </span>
          ) : (
            <span className="text-xs text-gray-500">
              {t('moreAllowed', { count: remainingPhotos })}
            </span>
          )}
        </div>
        {/* Progress bar */}
        <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              isAtMaxPhotos ? "bg-amber-500" : "bg-[#F76C5E]"
            )}
            style={{ width: `${(photoCount / maxPhotos) * 100}%` }}
          />
        </div>
      </div>

      {/* Scrollable grid */}
      <div className="flex-grow overflow-y-auto px-4 py-2">
        {minPagesReached && (
          <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-700 text-center">
              {t('minPhotosWarning')}
            </p>
          </div>
        )}

        <div className="grid grid-cols-4 gap-2">
          {sortedPages.map((page) => {
            const isCover = page.assetId === coverAssetId;
            // Can delete if: not cover AND not at minimum pages
            const canDelete = !isCover && !minPagesReached;

            return (
              <PhotoThumbnail
                key={page.id}
                page={page}
                isCover={isCover}
                onDeleteClick={() => onDeleteRequest(page.id, isCover)}
                canDelete={canDelete}
              />
            );
          })}
        </div>

        {sortedPages.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">
            {t('noPhotosYet')}
          </p>
        )}
      </div>

      {/* Footer with Add button and Done */}
      <DrawerFooter className="pt-2 border-t">
        <Button
          onClick={onAddPhotosClick}
          variant="outline"
          disabled={isAtMaxPhotos}
          className={cn(
            "w-full border-dashed border-2",
            isAtMaxPhotos
              ? "border-gray-300 text-gray-400 cursor-not-allowed"
              : "border-[#F76C5E] text-[#F76C5E] hover:bg-orange-50"
          )}
        >
          <Plus className="w-4 h-4 mr-2" />
          {isAtMaxPhotos ? t('maxPhotosReached', { max: maxPhotos }) : t('addMorePhotos')}
        </Button>
        <Button onClick={onClose} className="w-full bg-[#F76C5E] hover:bg-[#E55A4C]">
          {tc('done')}
        </Button>
      </DrawerFooter>
    </>
  );
}

export function ManagePhotosPanel({
  isOpen,
  onClose,
  pages,
  coverAssetId,
  onDeleteRequest,
  onAddPhotosClick,
  minPagesReached,
}: ManagePhotosPanelProps) {
  const t = useTranslations('editor');
  const isDesktop = useMediaQuery('(min-width: 768px)');

  if (isDesktop) {
    return (
      <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false} shouldScaleBackground={false}>
        <DrawerContent className="h-full w-[380px] mt-0 fixed left-0 rounded-none border-r">
          <DrawerHeader>
            <DrawerTitle>{t('managePhotos')}</DrawerTitle>
            <DrawerDescription>{t('managePhotosDesc')}</DrawerDescription>
          </DrawerHeader>
          <PanelContent
            pages={pages}
            coverAssetId={coverAssetId}
            onDeleteRequest={onDeleteRequest}
            onAddPhotosClick={onAddPhotosClick}
            onClose={onClose}
            minPagesReached={minPagesReached}
          />
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="bottom" className="h-[85vh] flex flex-col">
        <SheetHeader>
          <SheetTitle>{t('managePhotos')}</SheetTitle>
          <SheetDescription>{t('managePhotosDesc')}</SheetDescription>
        </SheetHeader>
        <PanelContent
          pages={pages}
          coverAssetId={coverAssetId}
          onDeleteRequest={onDeleteRequest}
          onAddPhotosClick={onAddPhotosClick}
          onClose={onClose}
          minPagesReached={minPagesReached}
        />
      </SheetContent>
    </Sheet>
  );
}

export default ManagePhotosPanel;

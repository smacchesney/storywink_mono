"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Smartphone, Image as ImageIcon } from 'lucide-react';
import { BOOK_CONSTRAINTS } from '@storywink/shared';
import { useTranslations } from 'next-intl';

interface PhotoSourceSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseFromPhone: () => void;
  onImportFromGooglePhotos: () => void;
  currentPhotoCount?: number; // Optional: show remaining capacity
}

export function PhotoSourceSheet({
  isOpen,
  onOpenChange,
  onChooseFromPhone,
  onImportFromGooglePhotos,
  currentPhotoCount,
}: PhotoSourceSheetProps) {
  const t = useTranslations('editor');
  const maxPhotos = BOOK_CONSTRAINTS.MAX_PHOTOS;
  const remainingPhotos = currentPhotoCount !== undefined
    ? maxPhotos - currentPhotoCount
    : maxPhotos;

  const handleChooseFromPhone = () => {
    onChooseFromPhone();
    onOpenChange(false);
  };

  const handleImportGoogle = () => {
    onImportFromGooglePhotos();
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-lg">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-center text-lg font-medium">{t('addPhotosTitle')}</SheetTitle>
          <SheetDescription className="text-center text-sm text-gray-500">
            {currentPhotoCount !== undefined ? (
              t('addPhotosRemaining', { count: remainingPhotos, max: maxPhotos })
            ) : (
              t('addPhotosMax', { max: maxPhotos })
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="grid gap-4 py-4">
          <Button 
            variant="outline" 
            className="w-full justify-start text-left h-14 px-4 text-base"
            onClick={handleChooseFromPhone}
          >
            <Smartphone className="mr-3 h-5 w-5 text-[#F76C5E]" />
            <span className="md:hidden">{t('chooseFromPhone')}</span>
            <span className="hidden md:inline">{t('uploadPhotos')}</span>
          </Button>
          <Button
            variant="outline"
            className="w-full justify-start text-left h-14 px-4 text-base"
            onClick={handleImportGoogle}
            disabled // Disable Google Photos for now
          >
            {/* Placeholder Icon */}
            <ImageIcon className="mr-3 h-5 w-5 text-blue-500" />
            {t('importGooglePhotos')}
            <span className="ml-2 text-xs text-gray-500">({t('comingSoon')})</span>
          </Button>
        </div>
        {/* Optional Footer with Close button */}
        {/* <SheetFooter>
          <SheetClose asChild>
            <Button type="button" variant="secondary">Close</Button>
          </SheetClose>
        </SheetFooter> */}
      </SheetContent>
    </Sheet>
  );
}

export default PhotoSourceSheet; 
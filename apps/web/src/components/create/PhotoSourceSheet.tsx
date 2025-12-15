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
          <SheetTitle className="text-center text-lg font-medium">Add Photos</SheetTitle>
          <SheetDescription className="text-center text-sm text-gray-500">
            {currentPhotoCount !== undefined ? (
              <>You can add up to <span className="font-medium text-[#F76C5E]">{remainingPhotos}</span> more photos (max {maxPhotos})</>
            ) : (
              <>Maximum {maxPhotos} photos per book</>
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
            <span className="md:hidden">Choose from Phone</span>
            <span className="hidden md:inline">Upload Photos</span>
          </Button>
          <Button 
            variant="outline" 
            className="w-full justify-start text-left h-14 px-4 text-base"
            onClick={handleImportGoogle}
            disabled // Disable Google Photos for now
          >
            {/* Placeholder Icon */}
            <ImageIcon className="mr-3 h-5 w-5 text-blue-500" /> 
            Import from Google Photos
            <span className="ml-2 text-xs text-gray-500">(Coming Soon)</span>
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
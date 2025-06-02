"use client";

import React from 'react';
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger, // We might trigger this externally, but keep for reference
  SheetClose, // To allow closing
} from "@/components/ui/sheet";
import { Smartphone, Image as ImageIcon } from 'lucide-react'; // Assuming Google Photos icon isn't directly available

interface PhotoSourceSheetProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onChooseFromPhone: () => void;
  onImportFromGooglePhotos: () => void; // Add handler for Google Photos
}

export function PhotoSourceSheet({
  isOpen,
  onOpenChange,
  onChooseFromPhone,
  onImportFromGooglePhotos,
}: PhotoSourceSheetProps) {
  
  const handleChooseFromPhone = () => {
    onChooseFromPhone();
    onOpenChange(false); // Close sheet after selection
  };

  const handleImportGoogle = () => {
    onImportFromGooglePhotos();
    // Potentially close sheet or show loading state
    // onOpenChange(false); 
  };

  return (
    <Sheet open={isOpen} onOpenChange={onOpenChange}>
      {/* SheetTrigger could be used if the sheet is self-contained */}
      {/* <SheetTrigger asChild> */}
      {/*   <Button variant="outline">Open Sheet</Button> */}
      {/* </SheetTrigger> */}
      <SheetContent side="bottom" className="rounded-t-lg">
        <SheetHeader className="mb-4">
          <SheetTitle className="text-center text-lg font-medium">Add Photos</SheetTitle>
          {/* Optional: <SheetDescription>Choose where to add photos from.</SheetDescription> */}
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
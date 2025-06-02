"use client";

import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { DrawerFooter, DrawerClose } from "@/components/ui/drawer"; // For consistency if used in Drawer

interface DetailsEditorPanelProps {
  currentTitle: string;
  currentChildName: string;
  onTitleChange: (title: string) => void;
  onChildNameChange: (name: string) => void;
  onSave: () => void; // Simplified, can be async if needed from parent
  onCancel: () => void;
  isSaving: boolean;
}

export function DetailsEditorPanel({
  currentTitle,
  currentChildName,
  onTitleChange,
  onChildNameChange,
  onSave,
  onCancel,
  isSaving,
}: DetailsEditorPanelProps) {
  return (
    <>
      <div className="flex-grow overflow-auto py-4 px-4 space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="details-title" className="text-sm font-semibold">Book Title</Label>
          <Input
            id="details-title"
            placeholder={currentTitle.trim() === '' ? "e.g., The Magical Adventure" : ""}
            value={currentTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            data-tourid="details-title-input" // For tour if needed
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="details-child-name" className="text-sm font-semibold">Child's Name</Label>
          <Input
            id="details-child-name"
            placeholder={currentChildName.trim() === '' ? "e.g., Kai" : ""}
            value={currentChildName}
            onChange={(e) => onChildNameChange(e.target.value)}
            data-tourid="details-childname-input" // For tour if needed
          />
        </div>
      </div>
      <DrawerFooter className="pt-2 flex-row">
        <Button
          onClick={onSave}
          disabled={isSaving}
          className="flex-grow bg-[#F76C5E] hover:bg-[#F76C5E]/90 text-white"
        >
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Done
        </Button>
        {/* 
          DrawerClose is typically used when the component is directly inside a Drawer.
          If this panel is used in both Drawer and Sheet, the onCancel prop is more robust.
          The parent component (EditBookPage) will handle closing the Drawer/Sheet.
        */}
        <Button variant="outline" className="flex-grow" onClick={onCancel} disabled={isSaving}>
            Cancel
        </Button>
      </DrawerFooter>
    </>
  );
}

export default DetailsEditorPanel; 
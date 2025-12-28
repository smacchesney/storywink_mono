"use client";

import React from 'react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, X } from 'lucide-react';
import { DrawerFooter } from "@/components/ui/drawer";

export interface AdditionalCharacter {
  name: string;
  relationship: string;
}

interface DetailsEditorPanelProps {
  currentTitle: string;
  currentChildName: string;
  currentAdditionalCharacters: AdditionalCharacter[];
  onTitleChange: (title: string) => void;
  onChildNameChange: (name: string) => void;
  onAdditionalCharactersChange: (characters: AdditionalCharacter[]) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}

function CharacterRow({
  character,
  onUpdate,
  onRemove,
}: {
  character: AdditionalCharacter;
  onUpdate: (char: AdditionalCharacter) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-2 items-start p-3 bg-gray-50 rounded-lg">
      <div className="flex-1 space-y-2">
        <Input
          placeholder="Name (e.g., Sarah)"
          value={character.name}
          onChange={(e) => onUpdate({ ...character, name: e.target.value })}
          className="h-9 text-sm"
        />
        <Input
          placeholder="Role (e.g., Mom, Baby Brother)"
          value={character.relationship}
          onChange={(e) => onUpdate({ ...character, relationship: e.target.value })}
          className="h-9 text-sm"
        />
      </div>
      <button
        onClick={onRemove}
        className="mt-1 p-1.5 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 transition-colors"
        aria-label={`Remove ${character.name || 'character'}`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function DetailsEditorPanel({
  currentTitle,
  currentChildName,
  currentAdditionalCharacters,
  onTitleChange,
  onChildNameChange,
  onAdditionalCharactersChange,
  onSave,
  onCancel,
  isSaving,
}: DetailsEditorPanelProps) {
  const handleAddCharacter = () => {
    if (currentAdditionalCharacters.length < 5) {
      onAdditionalCharactersChange([
        ...currentAdditionalCharacters,
        { name: '', relationship: '' }
      ]);
    }
  };

  const handleUpdateCharacter = (index: number, updated: AdditionalCharacter) => {
    const newCharacters = [...currentAdditionalCharacters];
    newCharacters[index] = updated;
    onAdditionalCharactersChange(newCharacters);
  };

  const handleRemoveCharacter = (index: number) => {
    const newCharacters = currentAdditionalCharacters.filter((_, i) => i !== index);
    onAdditionalCharactersChange(newCharacters);
  };

  // Filter out empty characters before save validation
  const hasValidCharacters = currentAdditionalCharacters.every(
    char => (char.name.trim() === '' && char.relationship.trim() === '') ||
            (char.name.trim() !== '' && char.relationship.trim() !== '')
  );

  return (
    <>
      <div className="flex-grow overflow-auto py-4 px-4 space-y-6">
        {/* Book Title */}
        <div className="space-y-1.5">
          <Label htmlFor="details-title" className="text-sm font-semibold">
            Book Title
          </Label>
          <Input
            id="details-title"
            placeholder={currentTitle.trim() === '' ? "e.g., The Magical Adventure" : ""}
            value={currentTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            data-tourid="details-title-input"
          />
        </div>

        {/* Child Name */}
        <div className="space-y-1.5">
          <Label htmlFor="child-name" className="text-sm font-semibold">
            Child&apos;s Name
          </Label>
          <p className="text-xs text-muted-foreground">
            This name will be used throughout the story
          </p>
          <Input
            id="child-name"
            placeholder="e.g., Emma"
            value={currentChildName}
            onChange={(e) => onChildNameChange(e.target.value)}
          />
        </div>

        {/* Additional Characters */}
        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">Other Characters</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Add family members or friends who appear in photos
            </p>
          </div>

          {/* Character List */}
          <div className="space-y-2">
            {currentAdditionalCharacters.map((char, index) => (
              <CharacterRow
                key={index}
                character={char}
                onUpdate={(updated) => handleUpdateCharacter(index, updated)}
                onRemove={() => handleRemoveCharacter(index)}
              />
            ))}
          </div>

          {/* Add Character Button */}
          {currentAdditionalCharacters.length < 5 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddCharacter}
              className="w-full border-dashed border-2 border-[#F76C5E] text-[#F76C5E] hover:bg-orange-50 hover:text-[#F76C5E]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Character
            </Button>
          )}

          {currentAdditionalCharacters.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {currentAdditionalCharacters.length}/5 characters
            </p>
          )}
        </div>
      </div>

      <DrawerFooter className="pt-2 flex-row">
        <Button
          onClick={onSave}
          disabled={isSaving || !hasValidCharacters}
          className="flex-grow bg-[#F76C5E] hover:bg-[#F76C5E]/90 text-white"
        >
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Done
        </Button>
        <Button variant="outline" className="flex-grow" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
      </DrawerFooter>
    </>
  );
}

export default DetailsEditorPanel;

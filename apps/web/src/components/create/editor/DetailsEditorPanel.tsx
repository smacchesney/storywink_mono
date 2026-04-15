"use client";

import React from 'react';
import { useTranslations } from 'next-intl';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, X } from 'lucide-react';
import { DrawerFooter } from "@/components/ui/drawer";

export interface AdditionalCharacter {
  name: string;
  relationship: string;
}

const MOOD_OPTIONS = [
  { value: 'adventurous', labelKey: 'moodAdventurous' },
  { value: 'silly', labelKey: 'moodSilly' },
  { value: 'sweet', labelKey: 'moodSweet' },
  { value: 'brave', labelKey: 'moodBrave' },
  { value: 'dreamy', labelKey: 'moodDreamy' },
  { value: 'curious', labelKey: 'moodCurious' },
] as const;

interface DetailsEditorPanelProps {
  currentTitle: string;
  currentChildName: string;
  currentAdditionalCharacters: AdditionalCharacter[];
  currentTone: string | null;
  currentTheme: string;
  onTitleChange: (title: string) => void;
  onChildNameChange: (name: string) => void;
  onAdditionalCharactersChange: (characters: AdditionalCharacter[]) => void;
  onToneChange: (tone: string | null) => void;
  onThemeChange: (theme: string) => void;
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
  const t = useTranslations('editor');
  return (
    <div className="flex gap-2 items-start p-3 bg-gray-50 rounded-lg">
      <div className="flex-1 space-y-2">
        <Input
          placeholder={t('characterNamePlaceholder')}
          value={character.name}
          onChange={(e) => onUpdate({ ...character, name: e.target.value })}
          className="h-9 text-sm"
        />
        <Input
          placeholder={t('characterRolePlaceholder')}
          value={character.relationship}
          onChange={(e) => onUpdate({ ...character, relationship: e.target.value })}
          className="h-9 text-sm"
        />
      </div>
      <button
        onClick={onRemove}
        className="mt-1 p-1.5 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 transition-colors"
        aria-label={t('removeCharacter', { name: character.name || 'character' })}
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
  currentTone,
  currentTheme,
  onTitleChange,
  onChildNameChange,
  onAdditionalCharactersChange,
  onToneChange,
  onThemeChange,
  onSave,
  onCancel,
  isSaving,
}: DetailsEditorPanelProps) {
  const t = useTranslations('editor');
  const tc = useTranslations('common');

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
            {t('bookTitle')}
          </Label>
          <Input
            id="details-title"
            placeholder={currentTitle.trim() === '' ? t('bookTitlePlaceholder') : ""}
            value={currentTitle}
            onChange={(e) => onTitleChange(e.target.value)}
            data-tourid="details-title-input"
          />
        </div>

        {/* Child Name */}
        <div className="space-y-1.5">
          <Label htmlFor="child-name" className="text-sm font-semibold">
            {t('childName')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('childNameHint')}
          </p>
          <Input
            id="child-name"
            placeholder={t('childNamePlaceholder')}
            value={currentChildName}
            onChange={(e) => onChildNameChange(e.target.value)}
          />
        </div>

        {/* Additional Characters */}
        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">{t('otherCharacters')}</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('otherCharactersHint')}
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
              {t('addCharacter')}
            </Button>
          )}

          {currentAdditionalCharacters.length > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {t('characterCount', { count: currentAdditionalCharacters.length })}
            </p>
          )}
        </div>

        {/* Story Mood */}
        <div className="space-y-1.5">
          <Label className="text-sm font-semibold">{t('storyMood')}</Label>
          <p className="text-xs text-muted-foreground">
            {t('storyMoodHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            {MOOD_OPTIONS.map((mood) => (
              <button
                key={mood.value}
                type="button"
                onClick={() => onToneChange(currentTone === mood.value ? null : mood.value)}
                className={`
                  font-playful text-sm px-3 py-1.5 rounded-full transition-all duration-200
                  ${currentTone === mood.value
                    ? 'bg-[#F76C5E] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }
                `}
              >
                {t(mood.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* Story Theme */}
        <div className="space-y-1.5">
          <Label htmlFor="story-theme" className="text-sm font-semibold">
            {t('storyTheme')}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t('storyThemeHint')}
          </p>
          <Input
            id="story-theme"
            placeholder={t('storyThemePlaceholder')}
            value={currentTheme}
            onChange={(e) => onThemeChange(e.target.value)}
            maxLength={100}
          />
        </div>
      </div>

      <DrawerFooter className="pt-2 flex-row">
        <Button
          onClick={onSave}
          disabled={isSaving || !hasValidCharacters}
          className="flex-grow bg-[#F76C5E] hover:bg-[#F76C5E]/90 text-white"
        >
          {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {tc('done')}
        </Button>
        <Button variant="outline" className="flex-grow" onClick={onCancel} disabled={isSaving}>
          {tc('cancel')}
        </Button>
      </DrawerFooter>
    </>
  );
}

export default DetailsEditorPanel;

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Pencil, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { coolifyImageUrl } from '@storywink/shared';
import { Storydust } from '@/components/ui/storydust';
import { MASCOT_CATS_SLEEPING } from '@/lib/mascots';

interface PageCardProps {
  id: string | undefined;
  imageUrl: string | null;
  text: string | null;
  pageNumber: number;
  isTitlePage: boolean;
  /**
   * Page.source — 'BRIDGE' pages are app-authored connectors with no photo,
   * so the null-image fallback explains them instead of showing a bare
   * "Page N" placeholder.
   */
  source?: string;
  moderationStatus?: string;
  moderationReason?: string | null;
  isSaving: boolean;
  bookId: string;
  onTextChange: (newText: string) => void;
  /** Persists the page text (the old per-page Confirm tap is gone). */
  onSave: (newText: string) => void;
}

/**
 * PageCard displays a single page with its image and text
 * Provides editing functionality; "Save changes" writes the text through.
 */
const PageCard = ({
  id: _id,
  imageUrl,
  text,
  pageNumber,
  isTitlePage,
  source,
  moderationStatus,
  moderationReason: _moderationReason,
  isSaving,
  bookId: _bookId,
  onTextChange,
  onSave,
}: PageCardProps) => {
  const t = useTranslations('review');
  const tc = useTranslations('common');
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState(text || '');

  // Update edited text when text prop changes
  useEffect(() => {
    setEditedText(text || '');
  }, [text]);

  const handleSaveText = () => {
    if (editedText.trim().length === 0) {
      toast.error(t('textCannotBeEmpty'));
      return;
    }

    onTextChange(editedText);
    onSave(editedText);
    setIsEditing(false);
  };

  return (
    <div className="page-card flex flex-col rounded-md bg-white p-4 shadow-sm">
      {/* Page Label - Centered above image */}
      <div className="mb-3 flex items-center justify-center gap-2 text-center">
        <h3
          className="text-sm font-medium text-coral"
          aria-label={
            isTitlePage ? `${t('page', { n: pageNumber })}, ${t('coverBadge')}` : undefined
          }
        >
          {t('page', { n: pageNumber })}
        </h3>
        {isTitlePage && (
          <span
            aria-hidden="true"
            className="rounded-full border border-coral/40 bg-coral/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[#B8483E] uppercase"
          >
            {t('coverBadge')}
          </span>
        )}
      </div>

      {/* Image Container */}
      <div className="image-container relative mb-4 h-[35vh] rounded-md bg-muted">
        {imageUrl ? (
          <Image
            src={coolifyImageUrl(imageUrl)}
            alt={t('page', { n: pageNumber })}
            fill
            sizes="(max-width: 768px) 100vw, 50vh"
            className="object-contain"
            priority={pageNumber < 3}
          />
        ) : source === 'BRIDGE' ? (
          // Bridge pages have no photo before illustration — the branded
          // fallback explains the page the app added instead of showing a
          // blank "Page N" card.
          <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-coral/40 bg-coral/5 px-6 text-center">
            <Image src={MASCOT_CATS_SLEEPING} alt="" width={56} height={56} className="h-14 w-14" />
            <span className="font-playful text-sm text-gray-700">{t('bridgePlaceholder')}</span>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-2xl font-semibold text-muted-foreground">
              {t('page', { n: pageNumber })}
            </span>
          </div>
        )}

        {/* Moderation Warning */}
        {moderationStatus === 'FLAGGED' && (
          <div className="absolute bottom-2 left-2 flex items-center rounded-md bg-warn-soft px-2 py-1 text-xs text-coral-ink">
            <AlertTriangle className="mr-1 h-3 w-3" />
            <span>{t('contentFlagged')}</span>
          </div>
        )}
      </div>

      {/* Action Row — just Edit; the old Confirm tap is gone. */}
      {!isEditing && (
        <div className="mb-3 flex gap-2">
          <Button
            variant="ghost"
            onClick={() => setIsEditing(true)}
            disabled={isSaving || isEditing}
            className="px-3 text-gray-600 hover:bg-gray-100"
          >
            <Pencil className="mr-1 h-4 w-4" /> {t('edit')}
          </Button>
        </div>
      )}

      {/* Text Area */}
      <div className="text-editor flex-1">
        {isEditing ? (
          <>
            <Textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="min-h-[100px] w-full p-3"
              placeholder={t('enterPageText', { n: pageNumber })}
            />
            {/* Edit mode buttons */}
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditing(false);
                  setEditedText(text || '');
                }}
                className="flex-1"
              >
                {tc('cancel')}
              </Button>
              <Button
                onClick={handleSaveText}
                disabled={isSaving}
                className="flex-1 bg-coral text-white hover:bg-coral/90"
              >
                {isSaving ? (
                  <>
                    <Storydust variant="twinkle" size="inline" className="mr-2 text-white" />
                    {tc('saving')}
                  </>
                ) : (
                  t('saveChanges')
                )}
              </Button>
            </div>
          </>
        ) : (
          <div className="text-content max-h-[35vh] overflow-y-auto rounded-md border bg-white p-3">
            {text || t('noTextYet')}
          </div>
        )}
      </div>
    </div>
  );
};

export default PageCard;

'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@clerk/nextjs';
import { X } from 'lucide-react';
import { uploadPhotos, makeFileKey, type KeyedFile } from '@/lib/uploadPhotos';
import ArtStyleStrip from '@/components/create/setup/ArtStyleStrip';
import { Storydust } from '@/components/ui/storydust';
import type { StyleKey } from '@storywink/shared/prompts/styles';
import { cn } from '@/lib/utils';

interface AvatarStudioDialogProps {
  onClose: () => void;
  /** Fires after the avatar is created (rendition still drawing). */
  onCreated: () => void;
}

type Kind = 'CHILD' | 'ADULT' | 'PET' | 'TOY';
type Step = 'kind' | 'photos' | 'style' | 'creating';

const KINDS: Array<{ kind: Kind; emoji: string; labelKey: string }> = [
  { kind: 'CHILD', emoji: '🧒', labelKey: 'kindChild' },
  { kind: 'ADULT', emoji: '🧑', labelKey: 'kindAdult' },
  { kind: 'PET', emoji: '🐾', labelKey: 'kindPet' },
  { kind: 'TOY', emoji: '🧸', labelKey: 'kindToy' },
];

/**
 * The studio: kind → 1-5 photos → name → style → drawing. One linear sheet,
 * every step skippable-back, nothing clever. Photos stage as ordinary Assets
 * and are deleted when the parent approves the finished character
 * (delete-after-approval).
 */
export function AvatarStudioDialog({ onClose, onCreated }: AvatarStudioDialogProps) {
  const t = useTranslations('characters');
  const { getToken } = useAuth();
  const [step, setStep] = React.useState<Step>('kind');
  const [kind, setKind] = React.useState<Kind | null>(null);
  const [displayName, setDisplayName] = React.useState('');
  const [artStyle, setArtStyle] = React.useState<StyleKey>('vignette');
  const [files, setFiles] = React.useState<File[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const create = async () => {
    if (!kind || files.length === 0 || !displayName.trim()) return;
    setStep('creating');
    setError(null);
    try {
      const keyed: KeyedFile[] = files.map((file) => ({ key: makeFileKey(), file }));
      const assets = await uploadPhotos(keyed, { getToken });
      if (assets.length === 0) throw new Error('upload failed');
      const res = await fetch('/api/avatars', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          kind,
          assetIds: assets.map((a) => a.id),
          artStyle,
        }),
      });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      onCreated();
      onClose();
    } catch {
      setError(t('createError'));
      setStep('style');
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 md:items-center">
      <div className="relative flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl">
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-gray-400 hover:bg-black/5"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-playful text-xl text-[#1a1a1a]">{t('studioTitle')}</h2>

        {step === 'kind' && (
          <div className="grid grid-cols-2 gap-3">
            {KINDS.map(({ kind: k, emoji, labelKey }) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setStep('photos');
                }}
                className="flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-2xl border border-black/10 bg-white font-playful text-base text-gray-700 hover:border-coral/60"
              >
                <span className="text-3xl" aria-hidden>
                  {emoji}
                </span>
                {t(labelKey)}
              </button>
            ))}
          </div>
        )}

        {step === 'photos' && (
          <div className="flex flex-col gap-3">
            <p className="font-playful text-sm text-gray-600">{t('photosHint')}</p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files ?? []).slice(0, 5))}
              className="rounded-xl border border-dashed border-black/20 p-4 font-playful text-sm"
            />
            {files.length > 0 && (
              <p className="font-playful text-sm text-gray-500">
                {t('photosPicked', { count: files.length })}
              </p>
            )}
            <input
              type="text"
              value={displayName}
              maxLength={50}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="rounded-xl border border-black/10 px-3 py-2 font-playful text-base focus:border-coral focus:outline-none focus:ring-1 focus:ring-coral"
            />
            <div className="flex justify-between">
              <BackButton onClick={() => setStep('kind')} label={t('back')} />
              <NextButton
                disabled={files.length === 0 || !displayName.trim()}
                onClick={() => setStep('style')}
                label={t('next')}
              />
            </div>
          </div>
        )}

        {step === 'style' && (
          <div className="flex flex-col gap-3">
            <ArtStyleStrip value={artStyle} onChange={setArtStyle} />
            {error && <p className="font-playful text-sm text-red-500">{error}</p>}
            <div className="flex justify-between">
              <BackButton onClick={() => setStep('photos')} label={t('back')} />
              <NextButton onClick={create} label={t('create', { name: displayName.trim() || '…' })} />
            </div>
          </div>
        )}

        {step === 'creating' && (
          <div className="flex flex-col items-center gap-3 py-8">
            <Storydust variant="twinkle" size="card" label={t('meeting', { name: displayName })} />
            <p className="font-playful text-base text-gray-600 text-working-shimmer">
              {t('meeting', { name: displayName })}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function BackButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-[44px] px-2 font-playful text-sm text-gray-500 underline decoration-dashed underline-offset-4"
    >
      {label}
    </button>
  );
}

function NextButton({
  onClick,
  label,
  disabled,
}: {
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'min-h-[44px] rounded-full px-5 font-playful text-base text-white',
        disabled ? 'bg-gray-300' : 'bg-coral hover:bg-coral/90',
      )}
    >
      {label}
    </button>
  );
}

export default AvatarStudioDialog;

'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useTranslations } from 'next-intl';
import { X, Check } from 'lucide-react';
import PhotoTray, { type PhotoTrayHandle } from '@/components/upload/PhotoTray';
import ArtStyleStrip from '@/components/create/setup/ArtStyleStrip';
import { Storydust } from '@/components/ui/storydust';
import { MAX_BATCH_PHOTOS } from '@storywink/shared/prompts/photo-analysis';
import type { StyleKey } from '@storywink/shared/prompts/styles';
import type { UploadedAsset } from '@/lib/uploadPhotos';
import { defaultSelected, AVATAR_KINDS, type AvatarKindString } from '@/lib/avatar-batch';
import { cn } from '@/lib/utils';

interface AvatarStudioDialogProps {
  onClose: () => void;
  /** Fires after characters are created (renditions still drawing). */
  onCreated: () => void;
}

type Step = 'photos' | 'detecting' | 'confirm' | 'empty' | 'style' | 'creating';

/** The parent-facing subject shape /api/avatars/detect returns. */
interface ClientSubject {
  subjectId: string;
  kindGuess: AvatarKindString;
  parentDescription: string;
  defaultLabel: string;
  isForeground: boolean;
  photoCount: number;
  photoIndexes: number[];
  thumbnailUrl: string | null;
}

interface PickState {
  selected: boolean;
  name: string;
  kind: AvatarKindString;
}

const KIND_EMOJI: Record<AvatarKindString, string> = {
  CHILD: '🧒',
  ADULT: '🧑',
  PET: '🐾',
  TOY: '🧸',
};

const KIND_LABEL_KEYS: Record<AvatarKindString, string> = {
  CHILD: 'kindChild',
  ADULT: 'kindAdult',
  PET: 'kindPet',
  TOY: 'kindToy',
};

/**
 * The unified studio (X7): photos → detect → "Who should we draw?" → style →
 * create. One flow for one child or the whole family — a single detected
 * subject is just a one-card confirm. Selection is consent: background
 * strangers start unselected and inaction never manufactures an avatar.
 * Names are optional; the smart label ("Grown-up with glasses") holds the
 * spot and the shelf kebab renames later.
 */
export function AvatarStudioDialog({ onClose, onCreated }: AvatarStudioDialogProps) {
  const t = useTranslations('characters');
  const locale = useLocale();
  const [step, setStep] = React.useState<Step>('photos');
  const [assets, setAssets] = React.useState<UploadedAsset[]>([]);
  const [detectionId, setDetectionId] = React.useState<string | null>(null);
  const [subjects, setSubjects] = React.useState<ClientSubject[]>([]);
  const [picks, setPicks] = React.useState<Record<string, PickState>>({});
  const [artStyle, setArtStyle] = React.useState<StyleKey>('vignette');
  const [error, setError] = React.useState<string | null>(null);
  const [pendingCount, setPendingCount] = React.useState(0);
  const trayRef = React.useRef<PhotoTrayHandle>(null);
  // The photo set the current detection covers — unchanged photos skip a
  // second (paid) detect call when the parent taps Back and Next again.
  const detectedKeyRef = React.useRef<string | null>(null);

  const selectedCount = subjects.filter((s) => picks[s.subjectId]?.selected).length;

  const onAssetsChange = React.useCallback((next: UploadedAsset[]) => {
    setAssets(next);
    setPendingCount(trayRef.current?.pendingCount() ?? 0);
  }, []);
  const onBatchSettled = React.useCallback(() => {
    setPendingCount(trayRef.current?.pendingCount() ?? 0);
  }, []);

  const detect = async () => {
    // Never detect over a partial set: wait out any in-flight uploads first so
    // a photo mid-upload can't be silently dropped from the roster.
    setStep('detecting');
    setError(null);
    const waitStart = Date.now();
    while (trayRef.current?.hasPending()) {
      if (Date.now() - waitStart > 60_000) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    setPendingCount(0);
    const uploaded = trayRef.current?.getUploadedAssets() ?? assets;
    if (uploaded.length === 0) {
      setError(t('createError'));
      setStep('photos');
      return;
    }
    const photoKey = uploaded
      .map((a) => a.id)
      .sort()
      .join(',');
    if (photoKey === detectedKeyRef.current && detectionId && subjects.length > 0) {
      setStep('confirm');
      return;
    }
    try {
      const res = await fetch('/api/avatars/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetIds: uploaded.map((a) => a.id),
          language: locale === 'ja' ? 'ja' : 'en',
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { detectionId: string; subjects: ClientSubject[] };
      if (data.subjects.length === 0) {
        setStep('empty');
        return;
      }
      detectedKeyRef.current = photoKey;
      setDetectionId(data.detectionId);
      setSubjects(data.subjects);
      setPicks(
        Object.fromEntries(
          data.subjects.map((s) => [
            s.subjectId,
            { selected: defaultSelected(s), name: '', kind: s.kindGuess },
          ]),
        ),
      );
      setStep('confirm');
    } catch {
      setError(t('createError'));
      setStep('photos');
    }
  };

  const create = async () => {
    if (!detectionId || selectedCount === 0) return;
    setStep('creating');
    setError(null);
    try {
      const res = await fetch('/api/avatars/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          detectionId,
          artStyle,
          picks: subjects
            .filter((s) => picks[s.subjectId]?.selected)
            .map((s) => {
              const pick = picks[s.subjectId];
              const name = pick.name.trim();
              return { subjectId: s.subjectId, kind: pick.kind, ...(name ? { name } : {}) };
            }),
        }),
      });
      if (res.status === 410 || res.status === 409) {
        // The hour ran out mid-flow (410), or a retry after a half-failed
        // create hit the single-use guard (409) — warm re-detect either way,
        // never a dead end.
        setError(t('detectionExpired'));
        setDetectionId(null);
        detectedKeyRef.current = null;
        setStep('photos');
        return;
      }
      if (res.status === 403) {
        // Already at the character cap: nothing was created and the detection
        // was NOT burned. Say so plainly rather than looping into a re-detect.
        const { toast } = await import('sonner');
        toast(t('capFull'));
        setStep('confirm');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        created: Array<{ avatarId: string }>;
        failed?: Array<{ subjectId: string; reason: string }>;
        stoppedAtCap?: number;
      };
      const { toast } = await import('sonner');

      // Zero created: cap-stop with nothing made shows the cap message and
      // stays on confirm (so a deselect can shrink the batch); anything else is
      // a real failure. Either way, never fall through to the generic error.
      if (data.created.length === 0) {
        if (data.stoppedAtCap !== undefined) {
          toast(t('capFull'));
          setStep('confirm');
        } else {
          setError(t('createError'));
          setStep('style');
        }
        return;
      }

      // At least one made — report what happened, then close to the shelf.
      if (data.stoppedAtCap !== undefined) {
        toast(t('capStopped', { count: data.created.length }));
      } else if (data.failed && data.failed.length > 0) {
        // Partial success is fine, but reported (plan decision).
        toast(t('someFailed', { made: data.created.length, missed: data.failed.length }));
      }
      onCreated();
      onClose();
    } catch {
      setError(t('createError'));
      setStep('style');
    }
  };

  // Portaled to document.body so the modal escapes the layout's `main`
  // (relative z-10) stacking context — otherwise the sticky header (z-50)
  // paints over the top of a tall confirm step. See root layout.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 md:items-center">
      <div className="relative flex max-h-[92dvh] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl bg-white p-5 md:rounded-2xl">
        <button
          type="button"
          aria-label={t('close')}
          onClick={onClose}
          className="absolute right-3 top-3 rounded-full p-2 text-gray-400 hover:bg-black/5"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="pr-8 font-playful text-xl text-[#1a1a1a]">
          {step === 'confirm' ? t('confirmTitle') : t('studioTitle')}
        </h2>

        {/* Kept mounted (hidden) off-step: the tray's tiles are component
            state, and Back from the confirm step must not lose the photos. */}
        <div className={cn('flex-col gap-3', step === 'photos' ? 'flex' : 'hidden')}>
          <p className="font-playful text-sm text-gray-600">
            {t('photosHintBatch', { max: MAX_BATCH_PHOTOS })}
          </p>
          <PhotoTray
            maxPhotos={MAX_BATCH_PHOTOS}
            trayRef={trayRef}
            onAssetsChange={onAssetsChange}
            onBatchSettled={onBatchSettled}
          />
          {error && step === 'photos' && (
            <p className="font-playful text-sm text-red-500">{error}</p>
          )}
          <div className="flex justify-end">
            <NextButton
              disabled={assets.length === 0 && pendingCount === 0}
              onClick={detect}
              label={pendingCount > 0 ? t('stillUploading', { count: pendingCount }) : t('next')}
            />
          </div>
        </div>

        {step === 'detecting' && (
          <WaitBlock label={t('lookingThrough')} />
        )}

        {step === 'empty' && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <span className="text-4xl" aria-hidden>
              🔍
            </span>
            <p className="font-playful text-lg text-[#1a1a1a]">{t('zeroTitle')}</p>
            <p className="max-w-xs font-playful text-sm text-gray-500">{t('zeroBody')}</p>
            <NextButton onClick={() => setStep('photos')} label={t('tryOtherPhotos')} />
          </div>
        )}

        {step === 'confirm' && (
          <div className="flex flex-col gap-3">
            <p className="font-playful text-sm text-gray-500">{t('confirmHint')}</p>
            <div className="flex flex-col gap-2.5">
              {subjects.map((subject) => (
                <SubjectCard
                  key={subject.subjectId}
                  subject={subject}
                  pick={picks[subject.subjectId]}
                  onToggle={() =>
                    setPicks((prev) => ({
                      ...prev,
                      [subject.subjectId]: {
                        ...prev[subject.subjectId],
                        selected: !prev[subject.subjectId].selected,
                      },
                    }))
                  }
                  onName={(name) =>
                    setPicks((prev) => ({
                      ...prev,
                      [subject.subjectId]: { ...prev[subject.subjectId], name },
                    }))
                  }
                  onKind={(kind) =>
                    setPicks((prev) => ({
                      ...prev,
                      [subject.subjectId]: { ...prev[subject.subjectId], kind },
                    }))
                  }
                />
              ))}
            </div>
            {selectedCount === 0 && (
              <p className="text-center font-playful text-sm text-gray-500">
                {t('pickAtLeastOne')}
              </p>
            )}
            <div className="flex justify-between">
              <BackButton onClick={() => setStep('photos')} label={t('back')} />
              <NextButton
                disabled={selectedCount === 0}
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
              <BackButton onClick={() => setStep('confirm')} label={t('back')} />
              <NextButton onClick={create} label={t('drawCount', { count: selectedCount })} />
            </div>
          </div>
        )}

        {step === 'creating' && <WaitBlock label={t('creatingBatch')} />}
      </div>
    </div>,
    document.body,
  );
}

/**
 * One confirm card: thumbnail LEADS, the model's description is quiet helper
 * text (never the headline), kind chip row, optional name. The whole card
 * toggles selection — coral ring + full color when in, dimmed when out.
 */
function SubjectCard({
  subject,
  pick,
  onToggle,
  onName,
  onKind,
}: {
  subject: ClientSubject;
  pick: PickState;
  onToggle: () => void;
  onName: (name: string) => void;
  onKind: (kind: AvatarKindString) => void;
}) {
  const t = useTranslations('characters');
  return (
    <div
      onClick={onToggle}
      className={cn(
        'relative flex cursor-pointer gap-3 rounded-2xl border-2 p-3 transition-all',
        pick.selected
          ? 'border-coral bg-white ring-2 ring-coral/25'
          : 'border-black/10 bg-white opacity-55 grayscale-[35%]',
      )}
    >
      <button
        type="button"
        aria-pressed={pick.selected}
        aria-label={t('subjectToggle', { label: subject.defaultLabel })}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={cn(
          'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full border transition-colors',
          pick.selected
            ? 'border-coral bg-coral text-white'
            : 'border-black/20 bg-white text-transparent',
        )}
      >
        <Check className="h-4 w-4" strokeWidth={3} />
      </button>

      {subject.thumbnailUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={subject.thumbnailUrl}
          alt=""
          className="h-20 w-20 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-[#FFF9F5] text-3xl"
        >
          {KIND_EMOJI[pick.kind]}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pr-6">
        <input
          type="text"
          value={pick.name}
          maxLength={50}
          disabled={!pick.selected}
          placeholder={subject.defaultLabel}
          // Only swallow the card's toggle gesture while selected (the input is
          // live). On an unselected card the input is disabled and dead — a tap
          // there must fall through and SELECT the card, not do nothing.
          onClick={pick.selected ? (e) => e.stopPropagation() : undefined}
          onChange={(e) => onName(e.target.value)}
          className="w-full rounded-lg border border-black/10 px-2 py-1 font-playful text-base text-[#1a1a1a] placeholder:text-gray-400 focus:border-coral focus:outline-none focus:ring-1 focus:ring-coral disabled:bg-transparent"
        />
        <p className="truncate text-xs text-gray-400">{subject.parentDescription}</p>
        <div
          className="flex flex-wrap gap-1"
          onClick={pick.selected ? (e) => e.stopPropagation() : undefined}
        >
          {AVATAR_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={!pick.selected}
              aria-pressed={pick.kind === kind}
              onClick={() => onKind(kind)}
              className={cn(
                'rounded-full border px-2 py-0.5 font-playful text-xs transition-colors',
                pick.kind === kind
                  ? 'border-coral bg-coral/10 text-coral'
                  : 'border-black/10 text-gray-400 hover:border-coral/40',
              )}
            >
              <span aria-hidden>{KIND_EMOJI[kind]}</span> {t(KIND_LABEL_KEYS[kind])}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function WaitBlock({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <Storydust variant="twinkle" size="card" label={label} />
      <p className="text-working-shimmer font-playful text-base text-gray-600">{label}</p>
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

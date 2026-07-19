'use client';

import React, { useEffect, useRef } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { clampRamble, RAMBLE_MAX_CHARS } from '@/components/create/setup/ramble';

const RAMBLE_MAX_HEIGHT_PX = 220;
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, RAMBLE_MAX_HEIGHT_PX)}px`;
}

interface RambleTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder: string;
  hint: string;
}

/**
 * X17 B4 — the dictation-first ramble field, ported from the X13 avatar
 * spark. Never autofocused (tapping in is what opts into the keyboard);
 * counter stays hidden until the wall is near. Talk-or-type: iOS/Android
 * keyboard dictation is the mic — no in-app speech plumbing.
 */
export function RambleTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  hint,
}: RambleTextareaProps) {
  const t = useTranslations('setup');
  const playful = useLocale() === 'ja' ? 'font-japanese' : 'font-playful';
  const ref = useRef<HTMLTextAreaElement>(null);
  // Perception's prefill can land after mount (grow otherwise runs only on
  // mount + onChange), leaving the text scrolled inside the 2-row box. Re-grow
  // on every value change so the box fits the prefilled ramble.
  useEffect(() => grow(ref.current), [value]);
  const remaining = RAMBLE_MAX_CHARS - value.length;
  return (
    <div className="w-full">
      <textarea
        ref={ref}
        value={value}
        rows={2}
        maxLength={RAMBLE_MAX_CHARS}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(clampRamble(e.target.value));
          grow(e.currentTarget);
        }}
        onBlur={onBlur}
        className={`w-full resize-none overflow-y-auto rounded-2xl border border-black/10 bg-white px-4 py-2.5 ${playful} text-sm leading-relaxed text-[#1a1a1a] outline-none placeholder:text-gray-400 focus:border-coral`}
      />
      <p className="mt-1 px-1 text-xs text-gray-500">{hint}</p>
      {remaining < 100 && (
        <p className="mt-1 px-1 text-right text-xs text-gray-400">
          {t('rambleCharsLeft', { count: remaining })}
        </p>
      )}
    </div>
  );
}

export default RambleTextarea;

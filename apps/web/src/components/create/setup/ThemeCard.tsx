'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Pencil } from 'lucide-react';

export const THEME_MAX_CHARS = 120;

const THEME_MAX_HEIGHT_PX = 160;
function grow(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, THEME_MAX_HEIGHT_PX)}px`;
}

interface ThemeCardProps {
  themeLine: string;
  /** Fires per keystroke; the caller's debounced PATCH channel persists. */
  onChange: (value: string) => void;
  /** X18: wizard passes t('themeWeThink'); default keeps the flag-off sheet
   * rendering today's copy untouched. */
  label?: string;
}

/**
 * X17 B2 — the feed's finale: the theme the story will build on, as an
 * Excalifont card in the warm shape-card wash (create/characters idiom).
 * Tap to edit inline; a parent who doesn't care never has to touch it.
 */
export function ThemeCard({ themeLine, onChange, label }: ThemeCardProps) {
  const t = useTranslations('setup');
  const playful = useLocale() === 'ja' ? 'font-japanese' : 'font-playful';
  const [editing, setEditing] = React.useState(false);
  if (!themeLine.trim() && !editing) return null;
  return (
    <div className="rounded-2xl border border-coral/15 bg-[#FFF9F5] px-4 py-3">
      <p className={`${playful} text-sm text-gray-500`}>{label ?? t('themeSoundsLike')}</p>
      {editing ? (
        <textarea
          autoFocus
          ref={grow}
          value={themeLine}
          rows={2}
          maxLength={THEME_MAX_CHARS}
          placeholder={t('themePlaceholder')}
          onChange={(e) => {
            onChange(e.target.value.slice(0, THEME_MAX_CHARS));
            grow(e.currentTarget);
          }}
          onBlur={() => setEditing(false)}
          className={`${playful} mt-1 w-full resize-none rounded-xl border-2 border-coral bg-white px-3 py-2 text-base leading-relaxed text-[#1a1a1a] outline-none`}
        />
      ) : (
        <button
          type="button"
          aria-label={t('themeEditLabel')}
          onClick={() => setEditing(true)}
          className="mt-1 flex min-h-[44px] w-full items-start justify-between gap-2 text-left"
        >
          <span className={`${playful} text-base leading-relaxed text-[#1a1a1a]`}>{themeLine}</span>
          <Pencil className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
        </button>
      )}
    </div>
  );
}

export default ThemeCard;

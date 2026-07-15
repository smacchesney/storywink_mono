'use client';

import React from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import AvatarCard, { type AvatarSummary } from '@/components/characters/AvatarCard';
import AvatarStudioDialog from '@/components/characters/AvatarStudioDialog';
import { drawAgainStyle } from '@/lib/avatarWardrobe';
import { MASCOT_CATS_WAVING } from '@/lib/mascots';
import type { StyleKey } from '@storywink/shared/prompts/styles';
import Image from 'next/image';

const POLL_MS = 4000;

/**
 * My Characters: the account's cast on one shelf. Cards twinkle while their
 * rendition draws; the shelf polls while anything is pending. Empty state
 * invites making a book (promotion seeds the shelf) as well as the studio.
 */
export default function CharactersPage() {
  if (process.env.NEXT_PUBLIC_AVATARS_ENABLED !== 'true') notFound();
  return <CharactersShelf />;
}

function CharactersShelf() {
  const router = useRouter();
  const t = useTranslations('characters');
  const tStories = useTranslations('avatarStories');
  const [avatars, setAvatars] = React.useState<AvatarSummary[] | null>(null);
  const [studioOpen, setStudioOpen] = React.useState(false);

  // X8: the create chooser's character path lands here as /characters?add=1.
  // Open the batch studio once, then strip the param so refresh/back never
  // re-triggers it. Reading window.location.search (not useSearchParams) keeps
  // the page out of a Suspense/CSR-bailout boundary at build time.
  const autoOpenChecked = React.useRef(false);
  React.useEffect(() => {
    if (autoOpenChecked.current) return;
    autoOpenChecked.current = true;
    if (new URLSearchParams(window.location.search).get('add') !== '1') return;
    setStudioOpen(true);
    router.replace('/characters', { scroll: false });
  }, [router]);

  const load = React.useCallback(async () => {
    const res = await fetch('/api/avatars');
    if (res.ok) {
      const data = (await res.json()) as { avatars: AvatarSummary[] };
      setAvatars(data.avatars);
      return data.avatars;
    }
    return null;
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Poll while any rendition is drawing.
  React.useEffect(() => {
    if (!avatars?.some((a) => a.renditions.some((r) => r.status === 'PENDING'))) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [avatars, load]);

  const rename = async (avatar: AvatarSummary) => {
    const name = window.prompt(t('renamePrompt'), avatar.displayName)?.trim();
    if (!name || name === avatar.displayName) return;
    await fetch(`/api/avatar/${avatar.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name.slice(0, 50) }),
    });
    void load();
  };

  // C3: redraw the DISPLAYED style (the card passes what it shows); the helper
  // pins the all-failed fallback chain so this can never redraw an arbitrary row.
  // Resolves the request outcome so an optimistic caller (the restyle sheet) can
  // revert: C5 made 429 reachable in prod, and a network throw counts as failure.
  // needsPhoto (F2, 409) means the worker would have no source — the confirm
  // dialog swaps to its fresh-photo state instead of closing.
  const drawStyle = async (
    avatarId: string,
    artStyle: string,
  ): Promise<{ ok: boolean; needsPhoto: boolean }> => {
    try {
      const res = await fetch(`/api/avatar/${avatarId}/rendition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artStyle }),
      });
      let needsPhoto = false;
      if (res.status === 409) {
        const body = (await res.json().catch(() => null)) as { needsPhoto?: boolean } | null;
        needsPhoto = body?.needsPhoto === true;
      }
      void load();
      return { ok: res.ok, needsPhoto };
    } catch {
      return { ok: false, needsPhoto: false };
    }
  };

  const drawAgain = (avatar: AvatarSummary, displayedStyle: StyleKey | null) =>
    drawStyle(avatar.id, drawAgainStyle(avatar.renditions, displayedStyle));

  const drawInStyle = (avatar: AvatarSummary, style: StyleKey) =>
    drawStyle(avatar.id, style).then((r) => r.ok);

  const remove = async (avatar: AvatarSummary) => {
    if (!window.confirm(t('deleteConfirm', { name: avatar.displayName }))) return;
    const res = await fetch(`/api/avatar/${avatar.id}`, { method: 'DELETE' });
    if (res.status === 409) {
      // X6d: this character stars in avatar-first stories — those books need
      // its drawings for every re-render, so the stories go first.
      toast(t('deleteStarsInStories', { name: avatar.displayName }));
    }
    void load();
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-16 pt-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="font-playful text-2xl text-[#1a1a1a]">{t('title')}</h1>
          <Link
            href="/library"
            className="rounded-full border border-black/10 px-3 py-1 font-playful text-sm text-gray-500 hover:border-coral/50 hover:text-gray-700"
          >
            {t('booksTab')}
          </Link>
        </div>
        <button
          type="button"
          onClick={() => setStudioOpen(true)}
          className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-coral px-4 font-playful text-white hover:bg-coral/90"
        >
          <Plus className="h-4 w-4" />
          {t('addSomeone')}
        </button>
      </div>

      {avatars && avatars.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-black/15 bg-white/60 px-6 py-12 text-center">
          <Image src={MASCOT_CATS_WAVING} alt="" width={120} height={120} className="h-auto w-24" />
          <p className="font-playful text-lg text-[#1a1a1a]">{t('emptyTitle')}</p>
          <p className="max-w-xs font-playful text-sm text-gray-500">{t('emptyBody')}</p>
        </div>
      )}

      {/* X6d: the shelf is a place to START stories, not just storage. */}
      {avatars?.some(
        (a) => a.status === 'READY' && a.renditions.some((r) => r.status === 'READY'),
      ) && (
        <Link
          href="/create/characters"
          className="mb-4 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full bg-coral px-6 py-3 font-playful text-lg text-white shadow-md hover:bg-coral/90"
        >
          {tStories('shelfCta')}
        </Link>
      )}

      {/* Tilted cards need breathing room — the y-gap absorbs the hover lift. */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 pt-2 md:grid-cols-3 md:gap-x-5">
        {avatars?.map((avatar, index) => (
          <AvatarCard
            key={avatar.id}
            avatar={avatar}
            index={index}
            onRename={rename}
            onDrawAgain={drawAgain}
            onDrawStyle={drawInStyle}
            onDelete={remove}
          />
        ))}
      </div>

      {studioOpen && (
        <AvatarStudioDialog onClose={() => setStudioOpen(false)} onCreated={() => void load()} />
      )}
    </div>
  );
}

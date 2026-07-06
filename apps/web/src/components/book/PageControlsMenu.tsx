"use client";

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MoreVertical, Pencil, Sparkles, ImageIcon, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Storydust } from '@/components/ui/storydust';
import { showWorking } from '@/lib/toast-utils';
import type { Page } from '@prisma/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface PageControlsMenuProps {
  bookId: string;
  /** The source page these controls act on (never a cover/dedication page). */
  page: Page;
  /**
   * Whether "change photo" is offered. The replace-photo mechanics live in the
   * resolve flow, which only runs on PARTIAL books — so on a COMPLETED book we
   * hide the option rather than link to a page that bounces straight back.
   */
  canChangePhoto?: boolean;
  /** Called after a mutation so the parent can refresh + resume polling. */
  onMutated: () => void;
}

/**
 * The per-page power menu on the preview: edit the page's story text inline,
 * request a fresh illustration, or swap the photo. Text and re-illustration
 * work end to end here; "change photo" routes to the resolve flow (which owns
 * the replace-photo + re-render mechanics). Bridge pages (source=BRIDGE,
 * app-authored) additionally get "Remove this page" — the one-tap decline for
 * content the parent never chose.
 */
export function PageControlsMenu({ bookId, page, canChangePhoto, onMutated }: PageControlsMenuProps) {
  const t = useTranslations('pageMenu');
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [text, setText] = useState(page.text ?? '');
  const [isSavingText, setIsSavingText] = useState(false);
  const [isReillustrating, setIsReillustrating] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);

  // Bridge pages are app-authored — the parent gets a one-tap decline.
  // Photo pages are never removable from here (their photos are the book).
  const isBridgePage = page.source === 'BRIDGE';

  useEffect(() => {
    setText(page.text ?? '');
  }, [page.id, page.text]);

  const handleSaveText = async () => {
    if (isSavingText) return;
    setIsSavingText(true);
    try {
      const res = await fetch(`/api/book/${bookId}/page/${page.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error('save failed');
      toast.success(t('textSaved'));
      setEditOpen(false);
      onMutated();
    } catch {
      toast.error(t('textSaveError'));
    } finally {
      setIsSavingText(false);
    }
  };

  const handleRemovePage = async () => {
    if (isRemoving) return;
    setIsRemoving(true);
    try {
      const res = await fetch(`/api/book/${bookId}/page/${page.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('remove failed');
      toast.success(t('pageRemoved'));
      setRemoveOpen(false);
      onMutated();
    } catch {
      toast.error(t('removeError'));
    } finally {
      setIsRemoving(false);
    }
  };

  const handleReillustrate = async () => {
    if (isReillustrating) return;
    setIsReillustrating(true);
    try {
      const res = await fetch(`/api/book/${bookId}/page/${page.id}/reillustrate`, {
        method: 'POST',
      });
      if (res.status !== 202) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'reillustrate failed');
      }
      // Working toast: the twinkle keeps winking until the gallery tile's
      // own painting state takes over on the next poll.
      showWorking(t('reillustrateStarted'));
      onMutated();
    } catch {
      toast.error(t('reillustrateError'));
    } finally {
      setIsReillustrating(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('openMenu')}
            className="h-9 w-9 rounded-full bg-background/70 shadow"
          >
            {isReillustrating ? (
              <Storydust variant="twinkle" size="inline" />
            ) : (
              <MoreVertical className="h-5 w-5 text-coral" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[70] font-playful">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            {t('editText')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleReillustrate} disabled={isReillustrating}>
            <Sparkles className="mr-2 h-4 w-4" />
            {t('newIllustration')}
          </DropdownMenuItem>
          {canChangePhoto && (
            <DropdownMenuItem
              onClick={() => router.push(`/book/${bookId}/resolve?pageId=${page.id}`)}
            >
              <ImageIcon className="mr-2 h-4 w-4" />
              {t('changePhoto')}
            </DropdownMenuItem>
          )}
          {isBridgePage && (
            <DropdownMenuItem
              onClick={() => setRemoveOpen(true)}
              className="text-red-600 focus:text-red-600"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('removePage')}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent className="z-[70] max-w-md">
          <DialogHeader>
            <DialogTitle className="font-playful">{t('removePageTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">{t('removePageBody')}</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveOpen(false)} disabled={isRemoving}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleRemovePage}
              disabled={isRemoving}
              className="bg-red-600 font-playful text-white hover:bg-red-700"
            >
              {isRemoving ? <Storydust variant="twinkle" size="inline" className="mr-2 text-white" /> : null}
              {t('removeConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="z-[70] max-w-md">
          <DialogHeader>
            <DialogTitle className="font-playful">{t('editText')}</DialogTitle>
          </DialogHeader>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            className="w-full resize-none rounded-xl border border-black/10 bg-white px-3 py-2 font-playful text-base text-gray-800 focus:border-coral focus:outline-none focus:ring-1 focus:ring-coral"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={isSavingText}>
              {t('cancel')}
            </Button>
            <Button
              onClick={handleSaveText}
              disabled={isSavingText}
              className="bg-coral font-playful text-white hover:bg-coral/90"
            >
              {isSavingText ? <Storydust variant="twinkle" size="inline" className="mr-2 text-white" /> : null}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default PageControlsMenu;

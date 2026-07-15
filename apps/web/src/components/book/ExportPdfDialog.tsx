"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Download, Share2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Storydust } from '@/components/ui/storydust';
import { showError } from '@/lib/toast-utils';
import { track } from '@/lib/track';
import { pdfDownloadFileName } from '@/lib/pdf-download';
import { shouldAutoSave } from '@/lib/pdf-autosave';

type Phase = 'preparing' | 'downloading' | 'ready';

/**
 * iOS/iPadOS Safari, where a programmatic download needs a live user gesture.
 * iPhone/iPod/older iPads report directly; iPadOS 13+ masquerades as a Mac but
 * is the only "Macintosh" that carries a touch screen.
 */
function isIOSUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) &&
      typeof navigator.maxTouchPoints === 'number' &&
      navigator.maxTouchPoints > 1)
  );
}

interface ExportPdfDialogProps {
  bookId: string;
  bookTitle: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function triggerDownload(url: string, fileName: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Fetches the export PDF, shows a real "preparing" wait (the render happens
 * server-side before the first byte arrives), and auto-saves the file the
 * moment it lands — the parent never taps twice. Once the blob is here it
 * also offers re-save and, where the browser supports file sharing, a Share
 * button for sending the book straight to grandparents.
 */
export function ExportPdfDialog({
  bookId,
  bookTitle,
  open,
  onOpenChange,
}: ExportPdfDialogProps) {
  const t = useTranslations('exportDialog');
  const [phase, setPhase] = useState<Phase>('preparing');
  // Byte progress is a bonus: it only renders when Content-Length survives
  // the proxy AND the body streams; otherwise the spinner carries the wait.
  const [progress, setProgress] = useState<number | null>(null);
  const [canShare, setCanShare] = useState(false);
  // Whether the silent auto-save fired. When it didn't (iOS with no live
  // gesture), the ready phase leads with Save instead of claiming a download.
  const [autoSaved, setAutoSaved] = useState(false);

  const fileName = pdfDownloadFileName(bookTitle);

  const objectUrlRef = useRef<string | null>(null);
  const fileRef = useRef<File | null>(null);
  // Latest-callback refs keep the fetch effect keyed on [open, bookId] only;
  // a parent re-render mid-flight must not abort and restart the export.
  const onOpenChangeRef = useRef(onOpenChange);
  const tRef = useRef(t);
  const fileNameRef = useRef(fileName);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
    tRef.current = t;
    fileNameRef.current = fileName;
  });

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    const controller = new AbortController();
    setPhase('preparing');
    setProgress(null);
    setCanShare(false);
    setAutoSaved(false);

    const run = async () => {
      let blob: Blob;
      // Phase 1 — fetch + stream the bytes. ONLY a failure here (before the
      // blob exists) may close the dialog; a client cancel/abort is silent.
      try {
        const response = await fetch(`/api/book/${bookId}/export/pdf`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`PDF export responded ${response.status}`);
        }

        const totalBytes = Number(response.headers.get('Content-Length')) || 0;
        if (response.body && totalBytes > 0) {
          setPhase('downloading');
          setProgress(0);
          const reader = response.body.getReader();
          const chunks: BlobPart[] = [];
          let received = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.byteLength;
            // Content-Length may describe an encoded stream; cap below 100
            // so the bar never finishes before the file does.
            setProgress(Math.min(99, Math.round((received / totalBytes) * 100)));
          }
          blob = new Blob(chunks, { type: 'application/pdf' });
        } else {
          blob = await response.blob();
        }
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error('PDF export failed:', error);
        // Gentle copy only — the raw failure stays in the log.
        showError(error, tRef.current('errorTitle'), tRef.current('errorBody'));
        onOpenChangeRef.current(false);
        return;
      }

      // Phase 2 — the bytes have landed. From here NOTHING may close the
      // dialog: every step is individually non-fatal and we always end on the
      // ready phase, so a post-blob throw can never look like a self-close.
      if (cancelled) return;
      setProgress(100);

      // The object URL powers the Save button. If it somehow throws, Save is a
      // no-op but the dialog still lands on ready rather than vanishing.
      try {
        objectUrlRef.current = URL.createObjectURL(blob);
      } catch (err) {
        console.error('PDF export: createObjectURL failed after blob landed', err);
      }

      // File + share availability — best-effort, feature-detected. Older
      // engines may lack File or throw from canShare; neither is fatal here.
      try {
        if (typeof File === 'function') {
          const file = new File([blob], fileNameRef.current, {
            type: 'application/pdf',
          });
          fileRef.current = file;
          if (
            typeof navigator !== 'undefined' &&
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [file] })
          ) {
            setCanShare(true);
          }
        }
      } catch (err) {
        console.error('PDF export: File/canShare probe failed after blob landed', err);
      }

      // Auto-save only when a synthetic click can actually land (desktop
      // always; iOS only while a gesture is still live). Never fatal — on iOS
      // the primary Save button carries the tap instead.
      let saved = false;
      const activation =
        typeof navigator !== 'undefined' ? navigator.userActivation?.isActive : undefined;
      if (objectUrlRef.current && shouldAutoSave(activation, isIOSUserAgent())) {
        try {
          triggerDownload(objectUrlRef.current, fileNameRef.current);
          saved = true;
        } catch (err) {
          console.error('PDF export: auto-save download failed after blob landed', err);
        }
      }
      setAutoSaved(saved);

      // Fire-and-forget telemetry (never throws); guarded regardless.
      try {
        track('pdf_export', { bookId });
      } catch (err) {
        console.error('PDF export: track failed after blob landed', err);
      }

      setPhase('ready');
    };
    void run();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      fileRef.current = null;
    };
  }, [open, bookId]);

  const handleSave = () => {
    if (objectUrlRef.current) {
      triggerDownload(objectUrlRef.current, fileName);
    }
  };

  const handleShare = async () => {
    const file = fileRef.current;
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: bookTitle || undefined });
    } catch (error) {
      // Backing out of the share sheet is not an error.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      console.error('PDF share failed:', error);
      showError(error, t('errorTitle'), t('shareErrorBody'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* z-[70]: this dialog opens from the z-[60] reading overlay */}
      <DialogContent className="z-[70] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-playful">
            {phase === 'ready'
              ? t('readyTitle')
              : phase === 'downloading'
                ? t('downloadingTitle')
                : t('preparingTitle')}
          </DialogTitle>
          <DialogDescription>
            {phase === 'ready'
              ? autoSaved
                ? t('readyBody')
                : t('readyBodyManual')
              : t('preparingBody')}
          </DialogDescription>
        </DialogHeader>

        {phase !== 'ready' && (
          <div className="flex justify-center py-4" aria-live="polite">
            {/* The pencil draws the wait: looping while the server renders,
                then tracking real byte progress once the download streams. */}
            {progress !== null ? (
              <Storydust variant="pencil" size="card" progress={progress / 100} />
            ) : (
              <Storydust variant="pencil" size="card" />
            )}
          </div>
        )}

        {phase === 'ready' && (
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="rounded-full font-playful"
            >
              {t('done')}
            </Button>
            {canShare && (
              <Button
                variant="outline"
                onClick={handleShare}
                className="rounded-full font-playful"
              >
                <Share2 className="h-4 w-4 mr-1.5" />
                {t('share')}
              </Button>
            )}
            <Button
              onClick={handleSave}
              className="bg-coral hover:bg-coral-hover rounded-full font-playful"
            >
              <Download className="h-4 w-4 mr-1.5" />
              {t('save')}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default ExportPdfDialog;

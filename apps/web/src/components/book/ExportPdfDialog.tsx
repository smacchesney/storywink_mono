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

type Phase = 'preparing' | 'downloading' | 'ready';

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

    const run = async () => {
      try {
        const response = await fetch(`/api/book/${bookId}/export/pdf`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`PDF export responded ${response.status}`);
        }

        const totalBytes = Number(response.headers.get('Content-Length')) || 0;
        let blob: Blob;
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
        if (cancelled) return;

        setProgress(100);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;

        const file = new File([blob], fileNameRef.current, {
          type: 'application/pdf',
        });
        fileRef.current = file;
        setCanShare(
          typeof navigator !== 'undefined' &&
            typeof navigator.canShare === 'function' &&
            navigator.canShare({ files: [file] })
        );

        // Auto-save: the tap that opened this dialog is the only tap needed.
        triggerDownload(url, fileNameRef.current);
        track('pdf_export', { bookId });
        setPhase('ready');
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        console.error('PDF export failed:', error);
        // Gentle copy only — the raw failure stays in the log.
        showError(error, tRef.current('errorTitle'), tRef.current('errorBody'));
        onOpenChangeRef.current(false);
      }
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
            {phase === 'ready' ? t('readyBody') : t('preparingBody')}
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

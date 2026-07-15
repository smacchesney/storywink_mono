/**
 * Pure redraw-recovery helpers (X11 Track F).
 *
 * `hasRedrawSource` mirrors the avatar-rendition worker's source selection
 * (apps/workers/src/workers/avatar-rendition.worker.ts): a redraw can proceed
 * when staged photos exist, OR a READY rendition of a DIFFERENT art style than
 * the one requested carries a sheet to derive from. When neither holds the
 * worker throws "No source photos and no prior rendition to derive from" and
 * bricks the avatar — the rendition route calls this BEFORE flipping PENDING so
 * that throw is never reachable from the UI (the throw stays as a backstop).
 *
 * `redrawDialogState` picks which of the three "Draw again" dialog states the
 * card shows.
 */

export interface RedrawSourceRendition {
  status: 'PENDING' | 'READY' | 'FAILED';
  artStyle: string;
  turnaroundSheetUrl: string | null;
}

/**
 * Whether the worker has a source to redraw `requestedStyle` from. Photos win;
 * otherwise any READY rendition of a DIFFERENT style with a sheet. This is
 * exactly the worker's `sourceUrls.length === 0` condition, inverted.
 */
export function hasRedrawSource(
  photosCount: number,
  renditions: RedrawSourceRendition[],
  requestedStyle: string,
): boolean {
  if (photosCount > 0) return true;
  return renditions.some(
    (r) => r.status === 'READY' && r.artStyle !== requestedStyle && Boolean(r.turnaroundSheetUrl),
  );
}

export type RedrawDialogState = 'confirm' | 'failedRecovery' | 'needsPhoto';

/**
 * Which "Draw again" dialog to show. needsPhoto (the brick case — the route
 * answered that a fresh photo is required) always wins; else a FAILED target
 * offers the recovery dialog (try again + fresh photo); else the plain Track E
 * confirm.
 */
export function redrawDialogState(input: {
  targetIsFailed: boolean;
  needsPhoto: boolean;
}): RedrawDialogState {
  if (input.needsPhoto) return 'needsPhoto';
  if (input.targetIsFailed) return 'failedRecovery';
  return 'confirm';
}

/**
 * The one mascot cast — the cream cat + black-and-tan dog duo that fronts the
 * brand. Every surface that shows a mascot imports from here, so the cast can
 * never drift (no strays, no retired dinos).
 *
 * NOTE: these Cloudinary assets still carry screenshot-named public IDs from
 * their original upload. Re-upload with real public IDs (e.g. mascot/floating)
 * and update these constants in one place when that happens.
 */

const CLOUDINARY_BASE = 'https://res.cloudinary.com/storywink/image/upload';

/** Cat + dog duo — the header logo mark. */
export const MASCOT_DUO_LOGO = `${CLOUDINARY_BASE}/v1772291379/Screenshot_2026-02-28_at_10.55.32_PM_copy_xxjms6.png`;

/** Floating cat — the "we're making your book" hero (GenerationProgress). */
export const MASCOT_CAT_FLOATING = `${CLOUDINARY_BASE}/v1772291377/Screenshot_2026-02-28_at_10.57.58_PM_mijhwv.png`;

/** Cat with photos — the upload/photo-picking moments (PhotoTray, setup strip). */
export const MASCOT_CAT_PHOTOS = `${CLOUDINARY_BASE}/v1772291379/Screenshot_2026-02-28_at_10.55.51_PM_iznwx3.png`;

/** Sleeping cats — dedication page, resolve flow, bridge placeholders. */
export const MASCOT_CATS_SLEEPING = `${CLOUDINARY_BASE}/v1772291377/Screenshot_2026-02-28_at_10.58.09_PM_gnknk5.png`;

/** Sitting cats — ending page, reveal overlay. */
export const MASCOT_CATS_SITTING = `${CLOUDINARY_BASE}/v1772291378/Screenshot_2026-02-28_at_10.57.54_PM_sxcasb.png`;

/** Waving cats — back cover, empty states, error/not-found pages. */
export const MASCOT_CATS_WAVING = `${CLOUDINARY_BASE}/v1772291378/Screenshot_2026-02-28_at_10.57.29_PM_qwoqr0.png`;

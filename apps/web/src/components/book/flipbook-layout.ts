/**
 * Pure book-box geometry for the flipbook. Extracted from FlipbookViewer's
 * inline calculateBookDimensions so the math is unit-testable.
 *
 * One change from the original: the portrait branch's fixed 0.78 page aspect is
 * now clamped from the available box's own ratio to [0.62, 0.78]. A tall phone
 * fills more of its height (the page grows down to a 0.62 aspect) instead of
 * letterboxing ~200px of dead space below a fixed-0.78 card — the room the
 * story text needs to fit. Spread mode and the 0.78 cap are byte-identical to
 * the old behavior.
 */
export interface BookBox {
  width: number;
  height: number;
  isPortrait: boolean;
}

const PADDING = 32; // total padding to subtract from the container
const SPREAD_MIN_WIDTH = 640;
const SPREAD_MIN_HEIGHT = 350;
const EXTREME_ASPECT = 2.5;
const SPREAD_ASPECT = 2.0; // two square pages side by side
const PORTRAIT_ASPECT_MIN = 0.62; // slenderest the page is allowed to get
const PORTRAIT_ASPECT_MAX = 0.78; // squattest — the old fixed value, now the cap

export function calculateBookBox(container: { width: number; height: number }): BookBox {
  const { width, height } = container;
  const availableWidth = width - PADDING;
  const availableHeight = height - PADDING;

  // Smart adaptive logic for single vs double page view
  const aspectRatio = width / height;
  const isExtremeAspectRatio = aspectRatio > EXTREME_ASPECT;
  const hasMinimumHeight = height >= SPREAD_MIN_HEIGHT;
  const shouldShowSpread = width >= SPREAD_MIN_WIDTH && hasMinimumHeight && !isExtremeAspectRatio;

  // Single page view (mobile portrait, landscape with limited height)
  if (!shouldShowSpread) {
    const pageWidth = availableWidth;
    const pageHeight = availableHeight;
    // Adaptive portrait aspect: fill the available box exactly when its shape
    // sits between 0.62 and 0.78, never squatter than 0.78, never more slender
    // than 0.62.
    const pageAspectRatio = Math.min(
      PORTRAIT_ASPECT_MAX,
      Math.max(PORTRAIT_ASPECT_MIN, availableWidth / availableHeight)
    );

    let finalWidth = pageWidth;
    let finalHeight = pageHeight;

    // Adjust to maintain aspect ratio
    if (pageWidth / pageHeight > pageAspectRatio) {
      finalWidth = pageHeight * pageAspectRatio;
    } else {
      finalHeight = pageWidth / pageAspectRatio;
    }

    return {
      width: Math.floor(finalWidth),
      height: Math.floor(finalHeight),
      isPortrait: true,
    };
  }

  // Desktop/tablet double page spread view
  let spreadWidth = availableWidth;
  let spreadHeight = availableHeight;

  if (spreadWidth / spreadHeight > SPREAD_ASPECT) {
    spreadWidth = spreadHeight * SPREAD_ASPECT;
  } else {
    spreadHeight = spreadWidth / SPREAD_ASPECT;
  }

  return {
    width: Math.floor(spreadWidth / 2),
    height: Math.floor(spreadHeight),
    isPortrait: false,
  };
}

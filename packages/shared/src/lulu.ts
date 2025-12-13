// Lulu Print-on-Demand API Configuration
// Documentation: https://developers.lulu.com/

export const LULU_CONFIG = {
  PRODUCTION_API: 'https://api.lulu.com',
  SANDBOX_API: 'https://api.sandbox.lulu.com',
  TOKEN_ENDPOINT: '/auth/realms/glasstree/protocol/openid-connect/token',

  // 8.5x8.5 Full Color Saddle Stitch options
  POD_PACKAGES: {
    // Sandbox-compatible saddle stitch (4-48 pages)
    SADDLE_STITCH_8X8: '0850X0850FCPRESS080CW444MXX',
  },

  // Shipping options from Lulu API
  SHIPPING_LEVELS: ['MAIL', 'PRIORITY_MAIL', 'GROUND', 'EXPEDITED', 'EXPRESS'] as const,

  // Saddle stitch binding page limits
  SADDLE_STITCH: {
    MIN_PAGES: 4,
    MAX_PAGES: 48,
  },

  // Default POD package for Storywink books (sandbox-compatible saddle stitch)
  DEFAULT_POD_PACKAGE: '0850X0850FCPRESS080CW444MXX',
} as const;

// PDF Specifications for Lulu Print
// Based on 8.5x8.5 trim size with 0.125" bleed
export const LULU_PDF_SPECS = {
  // Interior page specifications
  INTERIOR: {
    // Trim dimensions (final printed size)
    TRIM_WIDTH_IN: 8.5,
    TRIM_HEIGHT_IN: 8.5,

    // Bleed margin (content extends beyond trim)
    BLEED_IN: 0.125,

    // Safety margin (keep important content inside)
    SAFETY_MARGIN_IN: 0.5,

    // Resolution
    DPI: 300,

    // With bleed dimensions
    WIDTH_WITH_BLEED_IN: 8.75, // 8.5 + 2*0.125
    HEIGHT_WITH_BLEED_IN: 8.75,

    // Pixel dimensions at 300 DPI (with bleed)
    WIDTH_PX: 2625, // 8.75 * 300
    HEIGHT_PX: 2625,

    // Trim dimensions in pixels (for guides)
    TRIM_WIDTH_PX: 2550, // 8.5 * 300
    TRIM_HEIGHT_PX: 2550,

    // Bleed margin in pixels
    BLEED_PX: 37.5, // 0.125 * 300

    // Safety margin in pixels
    SAFETY_MARGIN_PX: 150, // 0.5 * 300
  },

  // Cover specifications for Saddle Stitch (no spine)
  // Cover spread = Back + Front, side by side
  COVER_SADDLE_STITCH: {
    // Single cover panel (back or front)
    PANEL_WIDTH_IN: 8.625, // 8.5 + 0.125 (bleed on outer edge only)
    PANEL_HEIGHT_IN: 8.75, // 8.5 + 2*0.125

    // Full spread dimensions (Back + Front)
    WIDTH_IN: 17.25, // 8.625 * 2
    HEIGHT_IN: 8.75,

    // Pixel dimensions at 300 DPI
    WIDTH_PX: 5175, // 17.25 * 300
    HEIGHT_PX: 2625, // 8.75 * 300

    // Panel dimensions in pixels
    PANEL_WIDTH_PX: 2587.5, // 8.625 * 300 (use 2588 for integer)

    // Spine width for saddle stitch = 0 (no spine)
    SPINE_WIDTH_IN: 0,
    SPINE_WIDTH_PX: 0,
  },
} as const;

// Storywink brand colors for covers
export const LULU_BRAND = {
  // Coral background for back cover
  BACK_COVER_COLOR: '#F76C5E',

  // Text color
  TEXT_COLOR: '#1a1a1a',

  // White for interior text area
  WHITE: '#FFFFFF',
} as const;

// Order quantity limits
export const LULU_ORDER_LIMITS = {
  MIN_QUANTITY: 1,
  MAX_QUANTITY: 10,
} as const;

// Shipping level descriptions for UI
export const LULU_SHIPPING_LABELS: Record<string, { label: string; description: string }> = {
  MAIL: {
    label: 'Standard Mail',
    description: 'Economy shipping, 7-14 business days',
  },
  PRIORITY_MAIL: {
    label: 'Priority Mail',
    description: 'Faster delivery, 4-7 business days',
  },
  GROUND: {
    label: 'Ground',
    description: 'Ground shipping, 5-10 business days',
  },
  EXPEDITED: {
    label: 'Expedited',
    description: 'Expedited shipping, 3-5 business days',
  },
  EXPRESS: {
    label: 'Express',
    description: 'Express shipping, 1-3 business days',
  },
};

// Test address for dummy checkout
export const LULU_TEST_ADDRESS = {
  name: 'Test User',
  street1: '101 Independence Ave SE',
  city: 'Washington',
  stateCode: 'DC',
  postcode: '20540',
  countryCode: 'US',
  phoneNumber: '+1 206 555 0100',
  email: 'test@storywink.ai',
} as const;

// Type exports
export type LuluShippingLevel = (typeof LULU_CONFIG.SHIPPING_LEVELS)[number];
export type LuluPodPackageId = (typeof LULU_CONFIG.POD_PACKAGES)[keyof typeof LULU_CONFIG.POD_PACKAGES];

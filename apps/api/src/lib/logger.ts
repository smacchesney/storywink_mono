/* ------------------------------------------------------------------
   src/lib/logger.ts
   ------------------------------------------------------------------ */

/* Make TypeScript happy when the DOM lib isn't present (Node/ts‑node).  */
/* This adds **no** code to the bundle – it’s purely for type‑checking. */
declare const window: unknown | undefined;

/**
 * Pick the correct logger implementation synchronously:
 *   – In Node (no `window`)   → server logger.
 *   – In the browser          → client shim.
 *
 * `require` keeps it compatible with CommonJS (ts‑node) and lets
 * Next.js tree‑shake the unused branch at build time.
 */
const logger =
  typeof window === "undefined"
    ? require("./logger.server").default // Node / server components / workers
    : require("./logger.client").default; // Browser / client components

export default logger;

/* Re‑export the Logger type so imports keep their IntelliSense. */
export type { Logger } from "./logger.server.js";

/**
 * Toys come alive (TOYS_COME_ALIVE_ENABLED) — X13 Track T.
 *
 * A single workers-side read for the flag that flips a companion_object
 * (beloved toy) avatar from a grounded object into a LIVING companion —
 * Toy Story register: alive, expressive, life-sized, adventuring side by
 * side, while staying visibly made of its toy-stuff. Default OFF; the story
 * register (story.ts), the render directive (illustration.ts), and the QC
 * species rubric (quality-check.ts) all key off the boolean this returns,
 * threaded as a prompt option. Rollback is a single variable change.
 *
 * REAL PETS are untouched by this flag either way.
 */
export function toysComeAliveEnabled(): boolean {
  return process.env.TOYS_COME_ALIVE_ENABLED === 'true';
}

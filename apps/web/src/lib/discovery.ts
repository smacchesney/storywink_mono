/**
 * X17 Wave B server flag. House pattern (avatars.ts:12): one exported
 * function per flag, read at call time, default OFF, rollback = unset the
 * var. The client-side gates are the baked constants in discovery-client.ts.
 * The server-side ensembleBooksEnabled lives in Wave A's outing-v2.ts — one
 * source of truth per flag; import from there if a route ever needs it.
 */
export function createDiscoveryEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CREATE_DISCOVERY_ENABLED === 'true';
}

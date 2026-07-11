/**
 * Entitlement gates for the character library.
 *
 * Built now, enforced later (owner decision 2026-07-12): alpha runs uncapped
 * behind ENTITLEMENTS_ENFORCED=false, and commercialization is an env flip
 * plus pricing — never a rebuild. Unlike the rate limiter (deliberately
 * fail-open), entitlements FAIL CLOSED when enforced: a thrown DB error
 * bubbles to the route's 500 rather than silently granting.
 */
import { db as prisma } from '@/lib/db';

export function entitlementsEnforced(): boolean {
  return process.env.ENTITLEMENTS_ENFORCED === 'true';
}

export function avatarFreeCap(): number {
  const parsed = Number(process.env.AVATAR_FREE_CAP ?? 3);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 3;
}

export type EntitlementVerdict =
  | { allowed: true }
  | { allowed: false; reason: 'avatar_cap'; cap: number };

/** Gate for creating a new avatar (studio and promotion both check this). */
export async function assertCanCreateAvatar(dbUserId: string): Promise<EntitlementVerdict> {
  if (!entitlementsEnforced()) return { allowed: true };
  const cap = avatarFreeCap();
  const count = await prisma.avatar.count({ where: { userId: dbUserId } });
  return count >= cap ? { allowed: false, reason: 'avatar_cap', cap } : { allowed: true };
}

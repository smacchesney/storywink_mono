/**
 * Backfill Asset.width/height from the Cloudinary Admin API.
 *
 * Run:  npx tsx scripts/backfill-asset-dimensions.ts          (dry-run report)
 *       npx tsx scripts/backfill-asset-dimensions.ts --apply  (write updates)
 *
 * Requires CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET
 * and DATABASE_URL in the environment.
 */
import { v2 as cloudinary } from 'cloudinary';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function main() {
  const assets = await prisma.asset.findMany({
    where: { width: null },
    select: { id: true, publicId: true },
  });
  console.log(`${assets.length} assets missing dimensions${APPLY ? '' : ' (dry run)'}`);

  let updated = 0;
  let unresolvable = 0;
  for (const asset of assets) {
    try {
      const res = await cloudinary.api.resource(asset.publicId);
      if (typeof res.width === 'number' && typeof res.height === 'number') {
        if (APPLY) {
          await prisma.asset.update({
            where: { id: asset.id },
            data: { width: res.width, height: res.height },
          });
        }
        updated++;
      } else {
        unresolvable++;
      }
    } catch (err) {
      // Rate limit (Cloudinary Admin API, hourly window) is NOT "not found" —
      // every remaining call this hour would fail too. Stop honestly and let
      // the caller rerun after the window resets; already-updated rows are
      // skipped on rerun (width IS NULL filter), so reruns cost nothing extra.
      const httpCode =
        (err as { error?: { http_code?: number }; http_code?: number })?.error?.http_code ??
        (err as { http_code?: number })?.http_code;
      if (httpCode === 420 || httpCode === 429) {
        console.warn(
          `Rate limited by the Cloudinary Admin API after ${updated} updates — ` +
            `run again in ~1 hour to continue (remaining rows are untouched).`,
        );
        break;
      }
      unresolvable++;
      console.warn(`  not found on Cloudinary: ${asset.publicId}`);
    }
    // The Admin API is rate-limited (500/hr on lower tiers) — stay gentle.
    await new Promise((r) => setTimeout(r, 150));
  }
  console.log(`${APPLY ? 'updated' : 'would update'}: ${updated}, unresolvable: ${unresolvable}`);
}

main().finally(() => prisma.$disconnect());

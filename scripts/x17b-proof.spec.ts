/**
 * X17 Wave B — create-discovery proof walkthrough (owner-executed).
 *
 * A @playwright/test capture harness for the outing setup surface: the sweep,
 * the "little things we spotted" feed, the theme card, the star / "Everyone!"
 * picker, ramble-driven fact extraction, and the grace-window peek. It drives a
 * real, authenticated, logged-in session against a running local stack and
 * writes every required screenshot to `.screenshots/`.
 *
 * It is a CAPTURE HARNESS, not a strict assertion suite: a missing landmark
 * logs a warning and still shoots, so one flaky wait never aborts the run. The
 * few load-bearing checks (ONE debounced theme PATCH, reload persistence,
 * peek re-arm 200, no-emoji scan) are `expect.soft` so they annotate the run
 * without blocking later captures.
 *
 * ---------------------------------------------------------------------------
 * RUN
 *
 *   docker-compose up -d && npm run dev          # web :3000 + workers
 *
 *   STORAGE_STATE=auth.storageState.json \       # Clerk-authenticated session
 *   BASE_URL=http://localhost:3000 \
 *   BOOK_ID=<fresh DRAFT outing book, 2+ recurring kids> \
 *   STORY_PEEK_GRACE_MS=45000 \                  # short window → testable timeout
 *     npx playwright test scripts/x17b-proof.spec.ts
 *
 * `npx playwright test` installs @playwright/test on demand and runs this file
 * with its defaults — no playwright.config is required (viewport, locale, and
 * storageState are set per-describe via test.use()).
 *
 * To capture the Clerk session once:
 *   npx playwright open --save-storage=auth.storageState.json http://localhost:3000
 *   → sign in, then close the window. The Clerk __session cookie must be saved.
 *
 * ---------------------------------------------------------------------------
 * CAPTURES (X17.2 who's-who additions, on top of the X17 x17b-* set)
 *
 *   x17v2-m-16-cast-row            "Who's in this book?" faces render as crops
 *   x17v2-m-17-naming              one inline name input, committed under a face
 *   x17v2-m-18-everyone-dedication Everyone flash → childName becomes dedication
 *   x17v2-m-19-no-naming-chips     no naming-question rows left in CaptureChips
 *   x17v2-m-20-change-star         "Change star" re-opens the star ask
 *   x17v2-m-21-ja-cast             cast row narration in font-japanese
 *   x17v2-m-22-star-ask-slot       ask slot: Which-one-is question + Everyone pill
 *   x17v2-d-03-cast-row            cast row holds at 1280x800
 *
 *   All land in the SAME .screenshots/x17b-proof-manifest.json as the X17 run.
 *
 *   DATA PREREQUISITE (new): BOOK_ID should be a fresh DRAFT whose perception ran
 *   AFTER Task 1 ships (faceBox present on the roster) so faces crop via c_crop.
 *   Legacy books still pass — the g_face fallback renders and the m-16 crop
 *   assertion accepts either c_crop or g_face.
 *
 * ---------------------------------------------------------------------------
 * ENV
 *
 *   STORAGE_STATE          (required) path to a logged-in storageState JSON.
 *   BOOK_ID                (required) fresh DRAFT outing book, 2+ recurring kids.
 *   BASE_URL               default http://localhost:3000
 *   SHOT_DIR               default .screenshots
 *   STORY_PEEK_GRACE_MS    default 45000 — used only to size the timeout wait.
 *   PEEK_BOOK_ID           optional: a STORY_READY book already sitting on the
 *                          peek surface. If set, the peek phase uses it instead
 *                          of submitting BOOK_ID and waiting through real AI.
 *   TIMEOUT_PEEK_BOOK_ID   optional: a SECOND, UNTOUCHED STORY_READY peek book
 *                          for the m-13 auto-continue capture (a paint-now tap
 *                          consumes a peek, so the timeout path needs its own).
 *   LEGACY_BOOK_ID         optional: a pre-X17 DRAFT with coverAssetId set, for
 *                          the m-09 no-badge and m-15 flag-off captures.
 *
 * ---------------------------------------------------------------------------
 * SURFACES / ROUTES (grounded in the code, no data-testids exist)
 *
 *   /create/{bookId}/setup                  discovery setup sheet (DRAFT)
 *   /create/review?bookId={id}&peek=1       grace-window peek surface
 *   /create/{bookId}/setup  (ILLUSTRATING)  branded painting progress
 *
 * Locale is a cookie: `storywink-locale` = en | ja (apps/web/src/i18n/locale.ts).
 */

import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// --- env -------------------------------------------------------------------

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const STORAGE_STATE = process.env.STORAGE_STATE ?? '';
const BOOK_ID = process.env.BOOK_ID ?? '';
const PEEK_BOOK_ID = process.env.PEEK_BOOK_ID ?? '';
const TIMEOUT_PEEK_BOOK_ID = process.env.TIMEOUT_PEEK_BOOK_ID ?? '';
const LEGACY_BOOK_ID = process.env.LEGACY_BOOK_ID ?? '';
const SHOT_DIR = process.env.SHOT_DIR ?? '.screenshots';
const GRACE_MS = Number(process.env.STORY_PEEK_GRACE_MS ?? '45000') || 45000;
const LOCALE_COOKIE = 'storywink-locale';

if (!STORAGE_STATE || !fs.existsSync(STORAGE_STATE)) {
  throw new Error(
    `STORAGE_STATE must point at a logged-in storageState JSON. Got: ${
      STORAGE_STATE || '(unset)'
    }. See the header comment for how to capture one.`,
  );
}
if (!BOOK_ID) {
  throw new Error('BOOK_ID must be a fresh DRAFT outing book id (2+ recurring kids).');
}

fs.mkdirSync(SHOT_DIR, { recursive: true });

// Which book the peek phase drives: a pre-baked peek book, else BOOK_ID which
// the mobile lifecycle submits and follows to STORY_READY.
let peekBookId = PEEK_BOOK_ID || BOOK_ID;

// --- en landmarks (the ja run targets ja copy; see the ja describe) ---------

const C = {
  feedSpotted: 'Little things we spotted',
  themeSoundsLike: 'Sounds like',
  themeEditLabel: 'Fix the theme',
  rambleLabel: 'Tell us more about the day',
  starLabel: "Who's the star?",
  everyone: 'Everyone!',
  castRowLabel: "Who's in this book?",
  castNamePrompt: 'Tap a face to add a name',
  castChange: 'Change star',
  castStarWhich: 'Which one is',
  everyoneFlash: "Everyone's the star!",
  dedicationLabel: 'Who should we dedicate this book to?',
  makeMyBook: 'Make my book',
  paintMyPictures: 'Paint my pictures',
  peekHint: "We'll start painting",
  canLeave: 'You can leave',
  edit: 'Edit',
  saveChanges: 'Save changes',
};

// --- capture manifest ------------------------------------------------------

const manifest: { name: string; landmark: string; ok: boolean }[] = [];

/**
 * Best-effort capture: optionally wait for a landmark (short), then screenshot
 * regardless. Records whether the landmark was seen so the manifest doubles as
 * a "what actually rendered" ledger for the owner's eyeball pass.
 */
async function shoot(
  page: Page,
  name: string,
  landmark?: { locator: ReturnType<Page['locator']>; label: string; timeout?: number },
): Promise<boolean> {
  let ok = true;
  let label = '(none)';
  if (landmark) {
    label = landmark.label;
    try {
      await landmark.locator
        .first()
        .waitFor({ state: 'visible', timeout: landmark.timeout ?? 10_000 });
    } catch {
      ok = false;
      // eslint-disable-next-line no-console
      console.warn(`[x17b] ${name}: landmark not visible — "${label}". Shooting anyway.`);
    }
  }
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
  manifest.push({ name, landmark: label, ok });
  // eslint-disable-next-line no-console
  console.log(`[x17b] captured ${name}.png (landmark ok: ${ok})`);
  return ok;
}

/** Emoji / dingbat / regional-indicator scan of the rendered page text. */
async function assertNoEmoji(page: Page, where: string) {
  const text = await page.evaluate(() => document.body?.innerText ?? '');
  const emoji =
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{200D}]/u;
  const hit = text.match(emoji);
  expect.soft(hit, `emoji found on ${where}: ${JSON.stringify(hit?.[0])}`).toBeFalsy();
}

function url(pathname: string) {
  return new URL(pathname, BASE_URL).toString();
}

test.afterAll(async () => {
  fs.writeFileSync(
    path.join(SHOT_DIR, 'x17b-proof-manifest.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), baseUrl: BASE_URL, manifest }, null, 2),
  );
  // eslint-disable-next-line no-console
  console.log(`[x17b] wrote ${SHOT_DIR}/x17b-proof-manifest.json (${manifest.length} captures)`);
});

// ===========================================================================
// MOBILE — the outing lifecycle, in flow order. Serial: state carries across
// steps, and the submit step resolves the peek book for the peek captures.
// ===========================================================================

test.describe.serial('x17b mobile 375x812', () => {
  test.use({ storageState: STORAGE_STATE, viewport: { width: 375, height: 812 } });

  test('m-01 sweep — strip narrates, name typable mid-read', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const nameInput = page.locator('#childName');
    await nameInput.waitFor({ state: 'visible', timeout: 20_000 });
    // Name field must accept input WHILE the perception sweep is still reading.
    await nameInput.click();
    await nameInput.pressSequentially('A', { delay: 40 });
    expect.soft(await nameInput.inputValue(), 'name field typable mid-read').not.toEqual('');
    await shoot(page, 'x17b-m-01-sweep', {
      locator: page.locator('#childName'),
      label: 'setup sheet (name field)',
    });
  });

  test('m-02 feed — staggered Geist chips', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const ok = await shoot(page, 'x17b-m-02-feed', {
      locator: page.getByText(C.feedSpotted, { exact: false }),
      label: 'feed header "Little things we spotted…"',
      timeout: 60_000, // perception fills the feed (~15-45s on a fresh book)
    });
    if (!ok)
      console.warn('[x17b] feed empty — book may already be analyzed or perception not run.');
    await assertNoEmoji(page, 'feed');
  });

  test('m-03 theme — "Sounds like…" card', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await shoot(page, 'x17b-m-03-theme', {
      locator: page.getByText(C.themeSoundsLike, { exact: false }),
      label: 'theme card "Sounds like…"',
      timeout: 60_000,
    });
  });

  test('m-04 theme-edit — ONE debounced PATCH, survives reload', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await page.getByText(C.themeSoundsLike, { exact: false }).first().waitFor({ timeout: 60_000 });

    // Count PATCHes to this book carrying themeLine across the edit window.
    let themePatches = 0;
    page.on('request', (req) => {
      if (
        req.method() === 'PATCH' &&
        req.url().includes(`/api/book/${BOOK_ID}`) &&
        (req.postData() ?? '').includes('themeLine')
      ) {
        themePatches += 1;
      }
    });

    const marker = `proof theme ${Date.now().toString().slice(-5)}`;
    await page.getByRole('button', { name: C.themeEditLabel }).first().click();
    const editor = page.locator('textarea').first();
    await editor.fill(marker);
    await page.locator('#childName').click(); // blur the editor
    // Debounced channel + a margin, so a single coalesced PATCH lands.
    await page.waitForTimeout(2500);
    expect.soft(themePatches, 'exactly one debounced theme PATCH').toBe(1);
    await shoot(page, 'x17b-m-04-theme-edit', {
      locator: page.getByText(marker, { exact: false }),
      label: `edited theme "${marker}"`,
    });

    // Survives a reload.
    await page.reload();
    await expect
      .soft(page.getByText(marker, { exact: false }).first(), 'edited theme persists after reload')
      .toBeVisible({ timeout: 15_000 });
  });

  test('m-05 ramble — grows while typing', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const label = page.getByText(C.rambleLabel, { exact: false });
    await label.first().waitFor({ timeout: 30_000 });
    const ramble = page
      .locator('textarea')
      .filter({ hasNot: page.locator('[id]') })
      .first();
    await ramble.click();
    await ramble.pressSequentially(
      'We spent the morning at the tide pools. She found a tiny green crab and named it Pip. Then she slipped on a wet rock and got a scraped knee, but she was so brave about it.',
      { delay: 8 },
    );
    await shoot(page, 'x17b-m-05-ramble', {
      locator: page.getByText(C.rambleLabel, { exact: false }),
      label: 'ramble label + textarea',
    });
  });

  test('m-06 star — pick prefills child name', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    // m-01 types into #childName and the debounced PATCH persists it, so on every
    // run after the first the star ask reads castStarWhich ("Which one is A?"),
    // never starLabel — accept either copy as the landmark (m-20/m-22 do too).
    const starSection = page
      .getByText(C.starLabel, { exact: false })
      .or(page.getByText(C.castStarWhich, { exact: false }));
    const ok = await shoot(page, 'x17b-m-06-star', {
      locator: starSection,
      label: '"Who\'s the star?" picker (needs 2+ recurring kids)',
      timeout: 60_000,
    });
    if (!ok) {
      console.warn('[x17b] star picker absent — book likely has <2 recurring kids.');
      return;
    }
    // The first non-"Everyone!" face is a star-pickable face; tapping it prefills #childName.
    const starChip = page
      .locator('button[aria-pressed]')
      .filter({ hasNotText: C.everyone })
      .first();
    await starChip.click();
    await expect
      .soft(page.locator('#childName'), 'star pick prefilled the child name')
      .not.toHaveValue('');
    await shoot(page, 'x17b-m-06-star', { locator: starSection, label: 'star picked' });
  });

  test('m-16 cast row — faces render as images, never text-only chips', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const row = page.getByText(C.castRowLabel, { exact: false });
    const ok = await shoot(page, 'x17v2-m-16-cast-row', {
      locator: row,
      label: '"Who\'s in this book?" row',
      timeout: 60_000,
    });
    if (ok) {
      // Every face is a 64px <img> whose src carries a Cloudinary crop
      // (c_crop from a faceBox, or the g_face fallback on legacy rosters).
      // Scoped to img.h-16: the avatar-confirm's 24px portrait (img.h-6) can
      // share the section and must not pollute the every() scan.
      const faceSrcs = await page
        .locator('section', { has: row })
        .locator('img.h-16')
        .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).src));
      expect.soft(faceSrcs.length, 'at least one face image').toBeGreaterThan(0);
      expect
        .soft(
          faceSrcs.every((s) => /c_crop|g_face/.test(s)),
          'every face src is a crop or g_face fallback',
        )
        .toBeTruthy();
    }
    await assertNoEmoji(page, 'cast row');
  });

  test('m-17 naming — one inline input at a time', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const row = page.getByText(C.castRowLabel, { exact: false });
    await row
      .first()
      .waitFor({ timeout: 60_000 })
      .catch(() => {});
    const section = page.locator('section', { has: row });
    const faces = section.locator('button', { has: page.locator('img') });
    const count = await faces.count();
    if (count >= 2) {
      await faces.nth(0).click();
      await faces.nth(1).click(); // switches the ONE input, never opens a second
      expect
        .soft(await section.locator('input[type="text"]').count(), 'exactly one open name input')
        .toBe(1);
      await section.locator('input[type="text"]').fill('Proofname');
      await page.keyboard.press('Enter');
    }
    await shoot(page, 'x17v2-m-17-naming', {
      locator: page.getByText('Proofname', { exact: false }),
      label: 'committed face name under the crop',
    });
  });

  test('m-18 everyone — dedication label swap', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const everyoneBtn = page.getByRole('button', { name: C.everyone });
    const present = await everyoneBtn
      .first()
      .isVisible()
      .catch(() => false);
    if (present) {
      await everyoneBtn.first().click();
      // UX review 6: the 2s ask-slot flash confirms the tap did something.
      await expect
        .soft(
          page.getByText(C.everyoneFlash, { exact: false }).first(),
          'Everyone flash visible in the ask slot',
        )
        .toBeVisible({ timeout: 3_000 });
      await expect
        .soft(
          page.getByText(C.dedicationLabel, { exact: false }).first(),
          'childName label became the dedication ask',
        )
        .toBeVisible({ timeout: 10_000 });
    } else {
      console.warn('[x17.2] Everyone chip absent — star already picked or flag off.');
    }
    await shoot(page, 'x17v2-m-18-everyone-dedication', {
      locator: page.locator('#childName'),
      label: 'ensemble dedication label',
    });
  });

  test('m-19 chips — no naming questions left in CaptureChips', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await page.locator('#childName').waitFor({ timeout: 20_000 });
    // Perception naming copy ("Who is the ...?") must not render as a chip
    // question — the face row owns naming now.
    const namingQuestions = await page.getByText(/^Who is the /).count();
    expect.soft(namingQuestions, 'zero naming-question chip rows').toBe(0);
    await shoot(page, 'x17v2-m-19-no-naming-chips', {
      locator: page.locator('#childName'),
      label: 'chips section without naming rows',
    });
  });

  test('m-20 change-star — quiet "Change star" (ask slot) re-opens the star ask', async ({
    page,
  }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const change = page.getByRole('button', { name: C.castChange });
    if (
      await change
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await change.first().click();
      // The re-opened ask reads "Which one is {childName}?" when the field is
      // filled, else "Who's the star?" — accept either landmark.
      const asked =
        (await page
          .getByText(C.starLabel, { exact: false })
          .first()
          .isVisible()
          .catch(() => false)) ||
        (await page
          .getByText(C.castStarWhich, { exact: false })
          .first()
          .isVisible()
          .catch(() => false));
      expect.soft(asked, 'star ask re-opened').toBeTruthy();
    }
    await shoot(page, 'x17v2-m-20-change-star', {
      locator: page.getByText(C.castRowLabel, { exact: false }),
      label: 'star ask re-entered via Change star',
    });
  });

  test('m-22 star-ask — ask slot holds the question and the Everyone pill', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await page.locator('#childName').waitFor({ timeout: 20_000 });
    await page.locator('#childName').fill('Kai');
    // Re-enter the star ask when a star is already picked.
    const change = page.getByRole('button', { name: C.castChange });
    if (
      await change
        .first()
        .isVisible()
        .catch(() => false)
    )
      await change.first().click();
    const section = page.locator('section', {
      has: page.getByText(C.castRowLabel, { exact: false }),
    });
    const slot = section.locator('div.h-11');
    const asking = await slot
      .getByText(C.castStarWhich, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    if (asking) {
      // childName non-blank → "Which one is Kai?" replaces "Who's the star?".
      expect
        .soft(
          await slot.getByText('Kai', { exact: false }).count(),
          'question carries the typed name',
        )
        .toBeGreaterThan(0);
      // The pill lives in the fixed ask slot — never inside the scrollable strip.
      expect
        .soft(
          await slot.getByRole('button', { name: C.everyone }).count(),
          'Everyone pill in the ask slot',
        )
        .toBe(1);
      expect
        .soft(
          await section
            .locator('.overflow-x-auto')
            .getByRole('button', { name: C.everyone })
            .count(),
          'strip holds faces only',
        )
        .toBe(0);
      // Non-star-pickable faces (adults/pets) dim during the ask (soft info —
      // the fixture book may have no adult faces).
      const dimmed = await section.locator('button.opacity-40').count();
      console.log(`[x17.2] ${dimmed} dimmed non-kid face(s) during star ask`);
    } else {
      console.warn('[x17.2] star ask not reachable — solo book, star locked in, or flag off.');
    }
    await shoot(page, 'x17v2-m-22-star-ask-slot', {
      locator: page.getByText(C.castRowLabel, { exact: false }),
      label: 'ask slot: Which-one-is question + Everyone pill',
    });
  });

  test('m-07 everyone — naming chips for unnamed members', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    const everyoneBtn = page.getByRole('button', { name: C.everyone });
    const present = await everyoneBtn
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    if (!present) {
      console.warn('[x17b] "Everyone!" chip absent — NEXT_PUBLIC_ENSEMBLE_BOOKS_ENABLED off?');
      await shoot(page, 'x17b-m-07-everyone', {
        locator: page.getByText(C.starLabel, { exact: false }),
        label: 'star section (no Everyone chip)',
      });
      return;
    }
    await everyoneBtn.first().click();
    await page.waitForTimeout(800); // naming chips inject + PATCH round-trips
    await shoot(page, 'x17b-m-07-everyone', {
      locator: everyoneBtn,
      label: '"Everyone!" selected + naming chips',
    });
  });

  test('m-08 extract — ramble blur fills facts', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await page.getByText(C.rambleLabel, { exact: false }).first().waitFor({ timeout: 30_000 });
    const ramble = page
      .locator('textarea')
      .filter({ hasNot: page.locator('[id]') })
      .first();
    await ramble.click();
    await ramble.fill(
      'Milo and his little sister Nora went to Greenfield Park. The best moment was feeding the ducks. Milo tripped over a root and dropped his cracker in the pond. He said "the ducks are having a picnic too!"',
    );
    // Blur triggers /api/story/propose?mode=extract → fact merge.
    const proposal = page
      .waitForResponse(
        (r) => r.url().includes('/api/story/propose') && r.request().method() === 'POST',
        { timeout: 20_000 },
      )
      .catch(() => null);
    await page.locator('#childName').click();
    const res = await proposal;
    if (!res)
      console.warn('[x17b] no /api/story/propose response — extraction may be rate-limited.');
    await page.waitForTimeout(1500); // merged facts render into the chips
    await shoot(page, 'x17b-m-08-extract', {
      locator: page.getByText(C.rambleLabel, { exact: false }),
      label: 'ramble + extracted facts',
    });
  });

  test('m-09 nobadge — composed-cover photo strip', async ({ page }) => {
    const bookForBadge = LEGACY_BOOK_ID || BOOK_ID;
    await page.goto(url(`/create/${bookForBadge}/setup`));
    await page.locator('#childName').waitFor({ timeout: 20_000 });
    // A composed-cover book (coverAssetId set) shows NO "Cover" badge and a
    // delete-✕ on every thumb. Soft-assert the badge is absent.
    const coverBadge = page.getByText(/^Cover$/i);
    expect.soft(await coverBadge.count(), 'composed-cover book shows no Cover badge').toBe(0);
    await shoot(page, 'x17b-m-09-nobadge', {
      locator: page.locator('#childName'),
      label: 'photo strip (no Cover badge, needs a composed-cover book)',
    });
  });

  test('m-10..m-12 peek — surface, tweak re-arm, paint-now', async ({ page }) => {
    if (PEEK_BOOK_ID) {
      peekBookId = PEEK_BOOK_ID;
      await page.goto(url(`/create/review?bookId=${peekBookId}&peek=1`));
    } else {
      // Submit BOOK_ID's story, then follow the auto-chain to the peek surface.
      await page.goto(url(`/create/${BOOK_ID}/setup`));
      const nameInput = page.locator('#childName');
      await nameInput.waitFor({ timeout: 20_000 });
      if ((await nameInput.inputValue()).trim() === '') await nameInput.fill('Proof Kid');
      await page.getByRole('button', { name: C.makeMyBook }).first().click();
      // GenerationProgress routes STORY_READY → review?peek=1 (real AI: minutes).
      await page.waitForURL(/\/create\/review\?.*peek=1/, { timeout: 5 * 60_000 }).catch(() => {
        console.warn('[x17b] never reached the peek URL — story generation slow/failed.');
      });
      peekBookId = BOOK_ID;
    }

    // m-10: the peek surface — CTA + twinkle hint.
    await shoot(page, 'x17b-m-10-peek', {
      locator: page.getByRole('button', { name: C.paintMyPictures }),
      label: '"Paint my pictures" CTA',
      timeout: 30_000,
    });
    await expect
      .soft(page.getByText(C.peekHint, { exact: false }).first(), 'peek hint present')
      .toBeVisible({ timeout: 10_000 });
    await assertNoEmoji(page, 'peek');

    // m-11: edit a page + save → peek re-arm (200 rearmed / 409 already-painting).
    const editBtn = page.getByRole('button', { name: C.edit }).first();
    if (await editBtn.isVisible().catch(() => false)) {
      await editBtn.click();
      const editor = page.locator('textarea').first();
      await editor.fill((await editor.inputValue()) + ' A gentle proof edit.');
      const rearm = page
        .waitForResponse(
          (r) =>
            r.url().includes(`/api/book/${peekBookId}/peek`) && r.request().method() === 'POST',
          { timeout: 20_000 },
        )
        .catch(() => null);
      await page.getByRole('button', { name: C.saveChanges }).first().click();
      const res = await rearm;
      if (res)
        expect
          .soft([200, 409].includes(res.status()), `re-arm status ${res?.status()}`)
          .toBeTruthy();
    } else {
      console.warn('[x17b] no Edit affordance on the peek page — capturing peek as-is.');
    }
    await shoot(page, 'x17b-m-11-peek-tweak', {
      locator: page.getByRole('button', { name: C.paintMyPictures }),
      label: 'peek after tweak (re-armed)',
    });

    // m-12: paint-now → branded painting progress (pencil Storydust, no Loader2).
    await page.getByRole('button', { name: C.paintMyPictures }).first().click();
    await page
      .waitForURL(new RegExp(`/create/${peekBookId}/setup`), { timeout: 30_000 })
      .catch(() => console.warn('[x17b] paint-now did not route to the setup/progress screen.'));
    const loader2 = await page.locator('svg.lucide-loader-2, svg.animate-spin').count();
    expect.soft(loader2, 'no Loader2 in the painting state').toBe(0);
    await shoot(page, 'x17b-m-12-painting', {
      locator: page.getByText(C.canLeave, { exact: false }),
      label: 'branded painting progress',
      timeout: 20_000,
    });
  });

  test('m-13 peek-timeout — untouched peek auto-continues', async ({ page }) => {
    test.skip(
      !TIMEOUT_PEEK_BOOK_ID,
      'Set TIMEOUT_PEEK_BOOK_ID to a 2nd UNTOUCHED STORY_READY peek book — a paint-now tap consumes a peek, so the timeout path needs its own.',
    );
    await page.goto(url(`/create/review?bookId=${TIMEOUT_PEEK_BOOK_ID}&peek=1`));
    await page
      .getByRole('button', { name: C.paintMyPictures })
      .first()
      .waitFor({ timeout: 30_000 });
    // Touch NOTHING. After the grace window the worker flips ILLUSTRATING and the
    // review poll (5s) routes to the setup/progress screen on its own.
    await page
      .waitForURL(new RegExp(`/create/${TIMEOUT_PEEK_BOOK_ID}/setup`), {
        timeout: GRACE_MS + 45_000,
      })
      .catch(() => console.warn('[x17b] timeout auto-continue not observed within the window.'));
    await shoot(page, 'x17b-m-13-peek-timeout', {
      locator: page.getByText(C.canLeave, { exact: false }),
      label: 'auto-continued painting progress',
      timeout: 20_000,
    });
  });
});

// ===========================================================================
// DESKTOP 1280x800 — layout holds at width.
// ===========================================================================

test.describe('x17b desktop 1280x800', () => {
  test.use({ storageState: STORAGE_STATE, viewport: { width: 1280, height: 800 } });

  test('d-01 feed — feed + theme + star layout', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await shoot(page, 'x17b-d-01-feed', {
      locator: page.getByText(C.feedSpotted, { exact: false }),
      label: 'feed header (desktop)',
      timeout: 60_000,
    });
    await assertNoEmoji(page, 'desktop feed');
  });

  test('d-02 peek — peek surface at desktop width', async ({ page }) => {
    await page.goto(url(`/create/review?bookId=${peekBookId}&peek=1`));
    await shoot(page, 'x17b-d-02-peek', {
      locator: page.getByRole('button', { name: C.paintMyPictures }),
      label: '"Paint my pictures" CTA (desktop)',
      timeout: 30_000,
    });
  });

  test('d-03 cast-row — "Who\'s in this book?" holds at desktop width', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await shoot(page, 'x17v2-d-03-cast-row', {
      locator: page.getByText(C.castRowLabel, { exact: false }),
      label: '"Who\'s in this book?" row (desktop)',
      timeout: 60_000,
    });
  });
});

// ===========================================================================
// ja LOCALE — theme card + ramble label render in font-japanese with ja copy.
// Eyeball the register/copy change against the en captures.
// ===========================================================================

test.describe('x17b ja locale', () => {
  test.use({ storageState: STORAGE_STATE, viewport: { width: 375, height: 812 } });

  test.beforeEach(async ({ context }) => {
    const origin = new URL(BASE_URL);
    await context.addCookies([
      {
        name: LOCALE_COOKIE,
        value: 'ja',
        domain: origin.hostname,
        path: '/',
      },
    ]);
  });

  test('m-14 ja-theme — theme card + ramble label in ja', async ({ page }) => {
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await page.locator('#childName').waitFor({ timeout: 20_000 });
    // Landmark on structure (id), not copy — the ja copy is what we're proving.
    await shoot(page, 'x17b-m-14-ja-theme', {
      locator: page.locator('#childName'),
      label: 'ja setup sheet (theme card + ramble label)',
      timeout: 60_000,
    });
    await assertNoEmoji(page, 'ja setup');
    // The font-japanese class must be present on narration nodes under ja.
    const jaNodes = await page.locator('.font-japanese').count();
    expect.soft(jaNodes, 'font-japanese applied on ja narration').toBeGreaterThan(0);
  });

  test('m-21 ja-cast — cast row narration in font-japanese', async ({ page }) => {
    // The describe's beforeEach already set the ja locale cookie.
    await page.goto(url(`/create/${BOOK_ID}/setup`));
    await page.locator('#childName').waitFor({ timeout: 20_000 });
    // Landmark on structure (id), not copy — the ja cast copy is what we're proving.
    await shoot(page, 'x17v2-m-21-ja-cast', {
      locator: page.locator('#childName'),
      label: 'ja cast row ("Who\'s in this book?" register)',
      timeout: 60_000,
    });
    await assertNoEmoji(page, 'ja cast');
    const jaNodes = await page.locator('.font-japanese').count();
    expect.soft(jaNodes, 'font-japanese applied on ja cast narration').toBeGreaterThan(0);
  });
});

// ===========================================================================
// FLAG-OFF regression — requires a build with the flags UNSET (NEXT_PUBLIC_*
// are baked). Can't be proven by a runtime toggle: if the discovery surface is
// present, this build is flag-ON and the test skips with a clear message.
// ===========================================================================

test.describe('x17b flag-off', () => {
  test.use({ storageState: STORAGE_STATE, viewport: { width: 375, height: 812 } });

  test('m-15 flagoff — legacy setup sheet', async ({ page }) => {
    const bookForOff = LEGACY_BOOK_ID || BOOK_ID;
    await page.goto(url(`/create/${bookForOff}/setup`));
    await page.locator('#childName').waitFor({ timeout: 20_000 });
    const discoveryOn = await page
      .getByText(C.feedSpotted, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    const themeOn = await page
      .getByText(C.themeSoundsLike, { exact: false })
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(
      discoveryOn || themeOn,
      'Discovery surface is visible → this build is flag-ON. Rebuild the dev server with NEXT_PUBLIC_CREATE_DISCOVERY_ENABLED and CREATE_DISCOVERY_ENABLED UNSET, then re-run just this test.',
    );
    await shoot(page, 'x17b-m-15-flagoff', {
      locator: page.locator('#childName'),
      label: "legacy setup sheet (today's UI, no feed/theme/star)",
    });
  });
});

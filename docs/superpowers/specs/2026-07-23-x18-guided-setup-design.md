# X18 — Guided setup: the story-builder becomes a stepped flow

- **Date:** 2026-07-23 (v2 — post Sol xhigh review, dispositions at bottom)
- **Status:** Pending owner approval
- **Scope:** Photo path only, `/create/[bookId]/setup`. Avatar path untouched. Upload page (`/create`) untouched. Workers/API untouched except two additive web-side items: new telemetry event names in the client allowlist, and the new build flag in Dockerfile/turbo plumbing. No schema changes.
- **Relation to X17:** builds on the shipped Wave B surface (`CREATE_DISCOVERY_ENABLED` on in prod). Reuses CastRow, CaptureChips, RambleTextarea, ArtStyleStrip, PhotoStrip, the strip-phase machine, and the debounced PATCH channel. SetupSheet remains intact as the flag-off fallback.

## Problems (owner-reported, confirmed in code)

1. **Premature CTA.** "Make my book" is `position: fixed` from first paint (`SetupSheet.tsx:380`). A new parent sees the finish line before any input below the fold. Name is the only required field, so tapping early "works" and silently produces a worse story.
2. **"Sounds like…" has no subject.** The ThemeCard label never says what the sentence is. It reads as an orphan mid-form.
3. **Digestion is illegible.** The reading moment shipped as five small quiet effects sprinkled across a static form. No single moment says "the AI is reading your photos."
4. **Six interaction dialects, twelve stacked sections, no hierarchy.**

## Owner decisions (2026-07-23, this session)

- **Structure:** Approach A — guided steps, chosen over one-page choreography and a focus stack.
- **Friction:** guided but skippable. No hard gates; optional steps advance in one tap.
- **Digestion:** visible, non-blocking. The parent works in parallel; AI-dependent asks surface when ready.
- **Input triage:** learning words + review-first toggle demoted into "More options". Book title stays visible and editable.

## The flow

Four steps. Form state, touched refs, poll, and PATCH machinery stay in `setup/page.tsx` exactly where they live today; the wizard is a shell over them.

```
[1 Who] → [2 The day] → [3 What we saw] → [4 Finish]
  name      photos+tone+ramble   AI payoff     style+title+recap+CTA
```

A compact **reading ribbon** sits under the header on steps 1–2. Step 3 is where its findings land; step 4 drops it.

### Step 1 — "Who is this book for?"

- Child name input, required. Same error behavior as today (nudge on Next, never disabled). Prefill + "For {name} again!" carries over verbatim.
- Nothing else. A repeat parent taps Next in under a second. No Skip (it's the one required field).

### Step 2 — "Tell us about the day"

- **Photo strip first** (full editable PhotoStrip: reorder, add, remove — moved here per Sol blocker 1, so every photo mutation happens *before* the analysis payoff). One-line hint: photo order is story order.
- Tone chips (unchanged), then the ramble textarea (unchanged component). Ramble blur still fires extraction.
- Typing or dictating buys the 15–45 s perception needs, so step 3 usually has its payload.
- **Photo-mutation gate:** PhotoStrip's busy state is lifted to the page (pending-count handle, same pattern as PhotoTray's `trayRef`). Next shows a storydust wait and advances only when no photo mutation is in flight.
- **Re-arm rule:** any add/remove fires an explicit re-arm (phase back to `reading`, step-3 payload reset) driven by the mutation callback — never inferred from `allPagesAnalyzed`, which stays true after a remove and misses the re-analysis.

### Step 3 — "Here's what we saw" (the payoff)

Two honest resolutions, no fake streaming (perception persists in one transaction, so findings arrive at once — Sol finding 6):

- **Reading** (parent arrived fast): center-stage theater — mascot + storydust + the staged strip lines + the thumbnail sparkle sweep. One coherent surface. Next stays available; nothing blocks.
- **Landed:** the reveal, cascading in with the existing chip-rise idiom (visual staging only): cast row (faces, star ask, naming asks), spotted chips, the theme line under the new label **"We think the day was about…"** (new key `themeWeThink`; `themeSoundsLike` stays — the flag-off ThemeCard still reads it), then capture questions.
- **Settled empty** (poll capped, nothing landed): one Excalifont line — "Our reader is taking extra long. Your photos will still guide the story." — plus Next.
- Step-state derivation prioritizes actual payload over the sticky `settled` phase, and counts only perception-authored artifacts (roster, chips, themeLine, capture questions) — never the parent's own ramble or `ramble_*` extraction rows.
- If the parent went back and changed photos after answering: step 3 re-arms, and capture answers bound to characterIds absent from the refreshed roster are dropped client-side on merge; a submit-time filter enforces the same rule (worker refresh replaces `characterIdentity` unconditionally but freezes old questions once any answer/skip exists — verified `photo-analysis.worker.ts:196-215`).

### Step 4 — "Finish"

- **Photos recap, read-only** (count + thumbnails; tapping it returns to step 2).
- Art style strip. Book title (visible labeled input, AI-prefilled with today's shimmer while pending).
- **Recap receipt:** two or three one-line Geist summaries (who it's for; the day, CSS-truncated to one line; star/cast if set), each a tap-back to its step.
- **More options** (collapsed): learning words + review-first toggle.
- **Make my book** — the only CTA in the flow. Same submit path (flush debouncer → PATCH → `/api/generate/story` → GenerationProgress).
- **Extraction cutoff (Sol blocker 2):** entering step 4 aborts any in-flight ramble extraction (tracked AbortController) and blocks new ones; submit aborts again defensively. The raw ramble always reaches the story; late extraction never mutates the form or races the submit PATCH.

## Reading ribbon (steps 1–2)

Recast of LibrarianStrip, same phase machine, deliberately quieter than v1 (Sol finding 10): mascot + one staged line (`stripPeeking` → `stripFaces` → `stripReading`) + 3–4 mini photo thumbnails with the existing sparkle sweep. No live counter (the single-transaction persist makes one a lie), no arrival bounce — on arrival the line flips to "Found a few things for step 3" and the ribbon dims. Reduced motion: existing fallbacks.

## Navigation, history, focus

- Header: back chevron + 4-segment progress bar (`aria-label` "Step {n} of 4: {title}") + step title (Excalifont).
- One advance control per step: **Next** (steps 1–3) / **Make my book** (step 4). No separate Skip button — advancing an optional step with nothing filled *is* skipping (telemetry infers it). Removes a decision from every screen.
- **Native history protocol** (Sol finding 3; Next 15 App Router supports `history.pushState`/`replaceState` natively): push with tagged state `{ winkStep: n }` only on first-time linear advances; `replaceState` for guards, recap jumps, and revisits; a `popstate` listener maps state → step; a nav lock ignores re-entrant taps mid-transition; manual scroll-to-top on step change. Back past step 1 exits the flow via real history (wherever the parent came from). Deep-link guard (`?step=3` with empty name → step 1) runs only after the book fetch + name suggestion resolve. No `useSearchParams` (avoids the Suspense-boundary trap); initial step reads `window.location.search` client-side.
- **Mount only the active step** (Sol finding 4). Before every navigation, including popstate: blur the active element (commits uncontrolled drafts in CaptureChips/CastRow inputs), then focus the incoming step heading (`tabIndex={-1}`). The shell owns a single `aria-live` region. Poll + `mergeBook` live in the page and are unaffected by which step is mounted.
- Step transitions: horizontal slide + fade (~200 ms, easeOut), direction-aware for linear moves, plain crossfade for recap jumps; reduced motion crossfades only.

## Persistence across refresh

Today only themeLine/eventSummary/captureQuestions ride the debounced PATCH channel; name, title, tone, and art style live only in client state until submit. A wizard session is longer, so (flag-on only) the channel extends to: `childName` (only when non-empty and parent-edited — the unaccepted prefill never persists), `title` (only non-empty; the PATCH schema rejects empty titles), `tone` (including `null` on deselect — schema is nullable), `artStyle`. Learning words and review-first stay submit-only. A mid-flow refresh then resumes on the right step with the parent's inputs. Known residual (pre-existing, unchanged): a DRAFT photo-refresh lets the worker overwrite the DB `eventSummary` until the parent's next edit or submit re-PATCHes it.

`buildSubmitPatchBody`'s omit-when-empty semantics are pre-existing and stay untouched, with one addition: the stale-cast answer filter (drop naming answers whose characterId is absent from the current roster).

## Flag & rollout

- `NEXT_PUBLIC_CREATE_WIZARD_ENABLED` — web-only, build-time, D7 pattern. Requires all three plumbing points: `discovery-client.ts` helper, **Dockerfile ARG + ENV**, **turbo.json env allowlist** (Sol finding 5; verified the existing flags do all three).
- Wizard renders only when discovery is also on; wizard-on + discovery-off falls back to the sheet.
- **Flag-off invariant, restated honestly:** rendered DOM and behavior parity for the sheet (not byte-identical bundles). `themeSoundsLike` is kept; ThemeCard gains a label prop (default = today's key) so the fallback is untouched; StoryFraming's flag-off DOM is pinned by a Playwright screenshot diff at the wizard-off + discovery-on combination (today's prod) — this repo has no component render-test harness, so the extraction is verbatim-JSX-move plus visual diff, not a snapshot test.

## State architecture

- `setup/page.tsx` keeps: form, touched refs, patch debouncer, poll, strip phase, submit, extraction (now with tracked abort), lifted photo-busy state.
- New `SetupWizard.tsx` (shell: header, progress, transitions, focus management) + pure `wizard-steps.ts` (step list, advance/guard rules, history-state mapping, step-3 state derivation, stale-answer filter, skip inference) with colocated tests, mirroring `strip-phase.ts` discipline.
- StoryFraming splits: tone row extracted as `ToneRow.tsx`, consumed by both the wizard (step 2) and StoryFraming (flag-off path renders identical DOM, pinned by test). Learning words render inside step 4's More options.
- Reused unmodified: RambleTextarea, CastRow, CaptureChips, ArtStyleStrip, GenerationProgress. PhotoStrip gains the lifted busy handle (additive prop, flag-off unaffected). DiscoveryFeed's chip list renders inside step 3; the standalone reserve-height section retires in the wizard shell.

## Copy (en + ja, `npm run i18n:check` gates)

New keys: step titles ×4, `next`, `back`, `photoOrderHint`, `themeWeThink`, `readerSlow`, `foundForStep3`, `recapFor`, `recapDay`, `recapCast`, `recapCastEveryone`, `recapPhotos`, `editPhotos`, `moreOptions`, `waitingForPhotos`, `progressLabel` ("Step {n} of {total}: {title}"). Kept: `themeSoundsLike` (fallback). Voice per `docs/voice.md`; ja via `font-japanese`; new ja strings get a `docs/ja-review.md` entry for the native-speaker pass (not just screenshots). The settled-empty line promises only that the photos guide the story — no claim about late findings.

## Telemetry

- Allowlist: add every new name to `CLIENT_EVENT_NAMES` (`client-events.ts`) + its tests — the sink is default-deny (Sol finding 8).
- Events: `setup_step_viewed` {step} (deduped per step per session — recap revisits don't recount), `setup_step3_transition` {to: landed|settledEmpty} fired once when reading resolves, and `setup_submitted` gains {skippedSteps: number[], step3State}. Skipped = advanced from an optional step with zero field interaction on it.
- Watch: step-2 dwell vs perception latency, step-3 skip rate + transition mix, ramble fill rate vs today, chips answered vs today, time-to-submit p50/p95.

## Proof gates

- Unit: `wizard-steps.test.ts` — advance/guard rules, history mapping, deep-link guard timing, step-3 derivation (landed / reading / settled-empty / settled-then-late-data), stale-answer filter, skip inference. StoryFraming + ThemeCard flag-off DOM pins.
- Playwright, mobile (390×844) + desktop, screenshots to `.screenshots/`: each step; reading→landed on step 3; settled-empty; photo edit at step 2 after step-3 answers (re-arm + answer drop); pending upload at step-2 Next (gate holds); extraction resolving during submit (aborted, no late PATCH); double-tap Next; browser `goBack()` stepping; recap tap-backs; refresh on every step; all four flag combinations; ja pass on step titles + theme card.
- Manual: one physical iOS Safari pass — keyboard behavior, edge-swipe back (Playwright `goBack()` is not a substitute).
- `npm run lint && npm run check-types && npm run test && npm run i18n:check`; brand check vs `.claude/rules/brand.md`.

## Risks & mitigations

- **Wizard fatigue / repeat parents (4 taps vs 1 today)** → step 1 prefilled, optional steps advance in one tap, no Skip-vs-Next decision; telemetry watches; express mode parked until data demands it. Owner accepts this trade for input quality.
- **Photo edits invalidating answers** → photos live before the payoff (step 2), gate on in-flight mutations, explicit re-arm, stale-answer drop at merge + submit.
- **Late extraction mutating state** → hard cutoff at step 4 entry + submit (abort). Deterministic by construction.
- **History loops / double-push** → push only first-time linear advances, replace otherwise, nav lock, pure mapping under test.
- **Flag-off drift** → Playwright screenshot diffs at wizard-off + discovery-on; SetupSheet untouched; ToneRow extraction is a verbatim JSX move.
- **ja lengths break step headers** → short keys, ja review entry, Playwright ja pass.

## Out of scope (parked)

Express mode, avatar-path wizard, upload-page changes, worker refresh-merge semantics (eventSummary overwrite + frozen-questions rule documented above as residual), `buildSubmitPatchBody` clear semantics, chip-level correction UI, Lulu/PDF surfaces, schema changes.

## Key file map

- Page/state: `apps/web/src/app/create/[bookId]/setup/page.tsx`
- New: `setup/SetupWizard.tsx`, `setup/wizard-steps.ts` (+ test), `setup/ToneRow.tsx`
- Touched: `setup/PhotoStrip.tsx` (busy handle, additive), `setup/ThemeCard.tsx` (label prop, default unchanged), `setup/StoryFraming.tsx` (consumes ToneRow, DOM-identical), `lib/client-events.ts` (+ names), `lib/discovery-client.ts` (+ flag)
- Build plumbing: `apps/web/Dockerfile` (ARG + ENV), `turbo.json` (env allowlist)
- Fallback (unchanged): `setup/SetupSheet.tsx`, `setup/LibrarianStrip.tsx`, `setup/DiscoveryFeed.tsx`
- Copy: `apps/web/messages/{en,ja}.json`, `docs/ja-review.md`

## Sol review dispositions (xhigh, fresh thread, 2026-07-23)

| # | Finding | Disposition |
|---|---|---|
| 1 | Step-4 photo editing invalidates step 3, races generation (blocker) | **Adopted.** Photos → step 2, read-only recap at step 4, lifted busy gate, explicit re-arm, stale-answer filter. Verified worker merge behavior. |
| 2 | Late ramble extraction mutates form after step 4 / during submit (blocker) | **Adopted.** Abort cutoff at step-4 entry + submit. |
| 3 | `?step=n` via router.push loops history, useSearchParams trap | **Adopted.** Native history protocol, push-linear/replace-else, popstate, nav lock, no useSearchParams. |
| 4 | Keep-all-mounted unjustified; hidden focus/aria/DnD hazards | **Adopted.** Active step only + blur-before-navigate + heading focus. |
| 5 | Flag-off not byte-identical; themeSoundsLike retirement breaks fallback; flag plumbing incomplete | **Adopted.** Key kept, label prop, DOM-parity tests, Dockerfile/turbo added. Invariant reworded to DOM/behavior parity. |
| 6 | "Streaming" findings impossible (single transaction); settled is sticky | **Adopted.** Counter dropped, two-resolution step 3, payload-over-phase derivation, perception-only payload test. |
| 7 | Refresh/"whole form" claims overstated; clear semantics lossy | **Adopted (partial).** Debounced channel extended to name/title/tone/artStyle with guards; claims restated; clear semantics left as-is (pre-existing), documented. |
| 8 | Telemetry names 400 against default-deny allowlist; semantics fuzzy | **Adopted.** Allowlist + tests in scope; semantics defined; step3 transition event added. |
| 9 | Copy/i18n gaps (false promise, plurals, a11y labels, ja review) | **Adopted.** Settled line softened; counter gone so no plural; progress a11y label; ja-review.md entry. |
| 10 | Skip button redundant; ribbon re-creates animation overload; wizard fights tired parents | **Adopted (partial).** Skip button removed; ribbon slimmed (no counter, no bounce). Wizard structure itself stands — owner decision, trade accepted, telemetry watches. |

# X18 Guided Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Version:** v2 — post Sol xhigh plan review (dispositions at bottom).

**Goal:** Turn the photo-path setup page into a 4-step guided wizard (Who → The day → What we saw → Finish) behind `NEXT_PUBLIC_CREATE_WIZARD_ENABLED`, per the approved spec `docs/superpowers/specs/2026-07-23-x18-guided-setup-design.md`.

**Architecture:** `setup/page.tsx` keeps all state (form, touched refs, poll, debounced PATCH, submit); a new presentational `SetupWizard` shell renders one step at a time over that state, with a pure `wizard-steps.ts` module for every rule (step guards, history model, step-3 derivation, re-read window, live-patch guards, stale-answer filter). SetupSheet stays untouched as the flag-off fallback.

**Tech Stack:** Next.js 15 App Router (client components), React 19, framer-motion, next-intl, Tailwind, vitest (pure-logic tests only — this repo has no component render tests), dnd-kit (existing, untouched).

## Global Constraints

- **NEVER commit or push. Leave all changes in the working tree** (`AGENTS.md` hard rule 7). Task boundaries below end with a **Checkpoint** (verification only); the orchestrator (Claude) reviews and commits between tasks. Never run `git add`/`git commit`.
- Never run repo-wide `npm run format`; format only files you touched: `npx prettier --write <paths>`.
- Import shared code from `@storywink/shared` subpaths only — never relative paths into packages.
- Brand: Excalifont via `font-playful` (ja: `font-japanese`) for headings/CTAs/narration; Geist for labels/data; every wait uses the Storydust system, never `Loader2`; coral is `bg-coral` (`#F76C5E`).
- Copy changes land in BOTH `apps/web/messages/en.json` and `ja.json`; `npm run i18n:check` must pass.
- Flag-off parity invariant: with the wizard flag unset — or set while discovery is off — the rendered setup DOM AND behavior (polling, strip phases, PATCH traffic) are unchanged. Every behavioral branch keys off `WIZARD_ENABLED` (Task 1), never off `CREATE_WIZARD_FLAG` alone. `SetupSheet.tsx`, `LibrarianStrip.tsx`, `DiscoveryFeed.tsx` are not modified at all; `StoryFraming.tsx`/`ThemeCard.tsx`/`PhotoStrip.tsx` change only by extraction or additive props with defaults.
- No new dependencies.
- Tests are colocated `*.test.ts` run by root vitest (`npm run test`); single file: `npx vitest run <path>`. Test files import via relative paths (root vitest resolves no `@/` alias).
- All touched UI keeps `useReducedMotion` fallbacks.
- Mobile-first: wizard content column is `max-w-md mx-auto px-4`, matching SetupSheet.

---

### Task 1: Build-flag plumbing

**Files:**
- Modify: `apps/web/src/lib/discovery-client.ts`
- Modify: `apps/web/Dockerfile` (ARG block ~line 34-39, ENV block ~line 52+)
- Modify: `turbo.json` (env allowlist array that already contains `"NEXT_PUBLIC_CREATE_DISCOVERY_ENABLED"`)

**Interfaces:**
- Produces: `CREATE_WIZARD_FLAG: boolean` and `WIZARD_ENABLED: boolean` (the combined gate — the ONLY constant behavioral code may branch on). Consumed by Tasks 10–11.

- [ ] **Step 1: Add the flag constants**

Append to `apps/web/src/lib/discovery-client.ts`:

```typescript
/** X18: the guided 4-step setup wizard. Off (default) keeps today's
 * SetupSheet byte-for-byte. */
export const CREATE_WIZARD_FLAG = process.env.NEXT_PUBLIC_CREATE_WIZARD_ENABLED === 'true';

/** X18: the single gate every wizard behavior branches on. Wizard-on with
 * discovery-off must render AND behave exactly like flag-off (Sol review:
 * gating behavior on CREATE_WIZARD_FLAG alone would change polling on the
 * fallback sheet). */
export const WIZARD_ENABLED = CREATE_WIZARD_FLAG && CREATE_DISCOVERY_FLAG;
```

- [ ] **Step 2: Dockerfile** — add `ARG NEXT_PUBLIC_CREATE_WIZARD_ENABLED` to the ARG block and `ENV NEXT_PUBLIC_CREATE_WIZARD_ENABLED=$NEXT_PUBLIC_CREATE_WIZARD_ENABLED` to the ENV block, alongside the existing `NEXT_PUBLIC_CREATE_DISCOVERY_ENABLED` lines.

- [ ] **Step 3: turbo.json** — add `"NEXT_PUBLIC_CREATE_WIZARD_ENABLED",` to the same env array.

- [ ] **Step 4: Checkpoint**

Run: `npm run check-types` — clean. `grep -n CREATE_WIZARD apps/web/Dockerfile turbo.json apps/web/src/lib/discovery-client.ts` shows all three sites. Leave in working tree.

---

### Task 2: Copy keys (en + ja) and the ja-review ledger entry

**Files:**
- Modify: `apps/web/messages/en.json` (inside the existing `"setup"` object)
- Modify: `apps/web/messages/ja.json` (inside the existing `"setup"` object)
- Modify: `docs/ja-review.md` (append)

**Interfaces:**
- Produces: `setup.*` keys consumed by Tasks 6–11. `themeSoundsLike` is KEPT (flag-off ThemeCard reads it).

- [ ] **Step 1: en keys**

```json
"stepWhoTitle": "Who is this book for?",
"stepDayTitle": "Tell us about the day",
"stepSawTitle": "Here's what we saw",
"stepFinishTitle": "Finishing touches",
"next": "Next",
"back": "Back",
"photoOrderHint": "Photo order is story order. Drag to shuffle.",
"themeWeThink": "We think the day was about…",
"readerSlow": "Our reader is taking extra long. Your photos will still guide the story.",
"foundForStep3": "Found a few things — they're waiting ahead.",
"recapFor": "For {name}",
"recapDay": "The day: {summary}",
"recapCast": "Starring {name}",
"recapCastEveryone": "Starring everyone",
"recapPhotos": "{count} photos, in story order",
"editPhotos": "Edit photos",
"moreOptions": "More options",
"progressLabel": "Step {n} of {total}: {title}",
"waitingForPhotos": "Finishing your photos…"
```

- [ ] **Step 2: ja keys (draft — native review pending)**

```json
"stepWhoTitle": "だれのための えほんですか？",
"stepDayTitle": "そのひの ことを おしえてください",
"stepSawTitle": "おしゃしんから みつけたこと",
"stepFinishTitle": "さいごの しあげ",
"next": "つぎへ",
"back": "もどる",
"photoOrderHint": "しゃしんの じゅんばんが おはなしの じゅんばんに なります。",
"themeWeThink": "こんな いちにちだった と おもいます…",
"readerSlow": "よむのに すこし じかんが かかっています。おしゃしんは ちゃんと おはなしに いかされますよ。",
"foundForStep3": "いくつか みつけました。このさきで まっています。",
"recapFor": "{name}のために",
"recapDay": "そのひのこと: {summary}",
"recapCast": "しゅやくは {name}",
"recapCastEveryone": "しゅやくは みんな！",
"recapPhotos": "しゃしん {count}まい（おはなしの じゅんばん）",
"editPhotos": "しゃしんを へんしゅう",
"moreOptions": "そのほかの せってい",
"progressLabel": "すてっぷ {n} / {total}: {title}",
"waitingForPhotos": "しゃしんを しあげています…"
```

- [ ] **Step 3: ja-review ledger**

Append to `docs/ja-review.md`:

```markdown
## 2026-07-23 — X18 guided setup (PENDING native review)

New `setup.*` keys: stepWhoTitle, stepDayTitle, stepSawTitle, stepFinishTitle,
next, back, photoOrderHint, themeWeThink, readerSlow, foundForStep3, recapFor,
recapDay, recapCast, recapCastEveryone, recapPhotos, editPhotos, moreOptions,
progressLabel, waitingForPhotos. Drafted by Claude in the yasashii register;
needs the standard native-speaker pass before the wizard flag flips.
```

- [ ] **Step 4: Checkpoint** — `npm run i18n:check` passes. Leave in working tree.

---

### Task 3: `wizard-steps.ts` pure module (TDD)

**Files:**
- Create: `apps/web/src/components/create/setup/wizard-steps.ts`
- Test: `apps/web/src/components/create/setup/wizard-steps.test.ts`

**Interfaces:**
- Consumes: `StripPhase`, `STRIP_FACES_AT_MS`, `STRIP_READING_AT_MS` from `./strip-phase`; `CaptureQuestion` from `./CaptureChips` (type-only).
- Produces (consumed by Tasks 6–11):
  - `type WizardStepId = 1 | 2 | 3 | 4`; `WIZARD_STEP_COUNT = 4`
  - `type Step3State = 'reading' | 'landed' | 'settledEmpty'`
  - `perceptionQuestionCount(questions): number`
  - `deriveStep3State(phase, payload, reReading: boolean): Step3State`
  - `canLeaveStep1(childName): boolean`; `guardStep(requested, childName): WizardStepId`; `parseStepParam(search): number | null`
  - `filterStaleCastAnswers(questions, rosterIds): CaptureQuestion[]`
  - `skippedSteps(visited, interacted): WizardStepId[]`
  - `type RibbonLineKey`; `ribbonLineKey(phase, elapsedMs): RibbonLineKey | null`
  - `REREAD_WINDOW_MS = 60_000`; `suppressArrival(reReading, contentChanged): boolean`
  - `perceptionSnapshot(identity, questions): string` — normalized content hash for re-read completion detection
  - `livePatchFor(key, value): Record<string, unknown> | null` — wizard live-persistence body (undefined-valued key = cancel pending)
  - `type HistModel`; `histInit(step)`, `histPush(m, step)`, `histReplace(m, step)`, `histBack(m)`, `histForward(m)` — the pure history-protocol model the shell mirrors

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/create/setup/wizard-steps.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { STRIP_FACES_AT_MS, STRIP_READING_AT_MS } from './strip-phase';
import type { CaptureQuestion } from './CaptureChips';
import {
  REREAD_WINDOW_MS,
  WIZARD_STEP_COUNT,
  canLeaveStep1,
  deriveStep3State,
  filterStaleCastAnswers,
  guardStep,
  histBack,
  histForward,
  histInit,
  histPush,
  histReplace,
  livePatchFor,
  parseStepParam,
  perceptionQuestionCount,
  perceptionSnapshot,
  ribbonLineKey,
  skippedSteps,
  suppressArrival,
} from './wizard-steps';

const q = (
  id: string,
  characterId: string | null = null,
  answer: string | null = null,
): CaptureQuestion => ({ id, question: 'q', options: [], characterId, answer });

describe('perceptionQuestionCount', () => {
  it('counts only perception-authored questions', () => {
    expect(
      perceptionQuestionCount([q('abc'), q('ramble_loc'), q('name_ch1', 'ch1'), q('def', 'ch2')]),
    ).toBe(2);
  });
});

describe('deriveStep3State', () => {
  const empty = { rosterCount: 0, chipCount: 0, themeLine: '', perceptionQuestionCount: 0 };
  it('reReading wins over any retained payload (photo-mutation re-read)', () => {
    expect(deriveStep3State('settled', { ...empty, rosterCount: 2 }, true)).toBe('reading');
    expect(deriveStep3State('arrivedQuiet', { ...empty, chipCount: 3 }, true)).toBe('reading');
  });
  it('payload beats a sticky settled phase', () => {
    expect(deriveStep3State('settled', { ...empty, rosterCount: 2 }, false)).toBe('landed');
  });
  it('reading with no payload is reading', () => {
    expect(deriveStep3State('reading', empty, false)).toBe('reading');
  });
  it('any terminal phase with no payload is settledEmpty', () => {
    expect(deriveStep3State('settled', empty, false)).toBe('settledEmpty');
    expect(deriveStep3State('hidden', empty, false)).toBe('settledEmpty');
    expect(deriveStep3State('arrivedQuiet', empty, false)).toBe('settledEmpty');
  });
  it('whitespace theme is not payload', () => {
    expect(deriveStep3State('settled', { ...empty, themeLine: '  ' }, false)).toBe('settledEmpty');
  });
});

describe('guardStep / parseStepParam / canLeaveStep1', () => {
  it('clamps and validates', () => {
    expect(guardStep(null, 'Kai')).toBe(1);
    expect(guardStep(0, 'Kai')).toBe(1);
    expect(guardStep(9, 'Kai')).toBe(WIZARD_STEP_COUNT);
    expect(guardStep(3, 'Kai')).toBe(3);
  });
  it('deep link past step 1 with an empty name lands on step 1', () => {
    expect(guardStep(3, '  ')).toBe(1);
  });
  it('parses ?step=', () => {
    expect(parseStepParam('?step=3')).toBe(3);
    expect(parseStepParam('?step=abc')).toBe(null);
    expect(parseStepParam('')).toBe(null);
  });
  it('step 1 requires a non-blank name', () => {
    expect(canLeaveStep1(' ')).toBe(false);
    expect(canLeaveStep1('Kai')).toBe(true);
  });
});

describe('history model — the protocol the shell mirrors', () => {
  it('push truncates forward history (Sol blocker: back-then-next must not corrupt the stack)', () => {
    let m = histInit(1);
    m = histPush(m, 2);
    m = histPush(m, 3);
    m = histPush(m, 4);
    m = histBack(m); // at 3, forward entry 4 exists
    m = histPush(m, 4); // Next again — MUST truncate, not replace entry 3
    expect(m.entries).toEqual([1, 2, 3, 4]);
    expect(m.entries[m.pos]).toBe(4);
    m = histBack(m);
    expect(m.entries[m.pos]).toBe(3); // step 3 preserved
  });
  it('recap jumps push, so Back returns to the recap', () => {
    let m = histInit(1);
    m = histPush(m, 2);
    m = histPush(m, 3);
    m = histPush(m, 4);
    m = histPush(m, 2); // recap tap-back to photos
    expect(m.entries).toEqual([1, 2, 3, 4, 2]);
    m = histBack(m);
    expect(m.entries[m.pos]).toBe(4);
  });
  it('replace canonicalizes without growing the stack (guards)', () => {
    let m = histInit(3);
    m = histReplace(m, 1); // deep-link guard: ?step=3 with no name
    expect(m.entries).toEqual([1]);
  });
  it('back stops at the first entry; forward replays', () => {
    let m = histInit(1);
    m = histPush(m, 2);
    m = histBack(m);
    m = histBack(m); // hits the floor (in the browser this exits the flow)
    expect(m.entries[m.pos]).toBe(1);
    m = histForward(m);
    expect(m.entries[m.pos]).toBe(2);
  });
});

describe('filterStaleCastAnswers', () => {
  it('drops rows whose characterId vanished from the roster', () => {
    const rows = [q('a', 'ch1'), q('b', 'gone'), q('c', null)];
    expect(filterStaleCastAnswers(rows, new Set(['ch1'])).map((r) => r.id)).toEqual(['a', 'c']);
  });
});

describe('skippedSteps', () => {
  it('optional steps visited without interaction are skipped', () => {
    expect(skippedSteps(new Set([1, 2, 3, 4]), new Set([1, 3]))).toEqual([2]);
  });
  it('unvisited steps are not skipped (never shown)', () => {
    expect(skippedSteps(new Set([1, 4]), new Set([1]))).toEqual([]);
  });
});

describe('ribbonLineKey', () => {
  it('pins the exact staging boundaries', () => {
    expect(ribbonLineKey('reading', STRIP_FACES_AT_MS - 1)).toBe('stripPeeking');
    expect(ribbonLineKey('reading', STRIP_FACES_AT_MS)).toBe('stripFaces');
    expect(ribbonLineKey('reading', STRIP_READING_AT_MS - 1)).toBe('stripFaces');
    expect(ribbonLineKey('reading', STRIP_READING_AT_MS)).toBe('stripReading');
  });
  it('arrival and settle lines', () => {
    expect(ribbonLineKey('arrived', 0)).toBe('foundForStep3');
    expect(ribbonLineKey('arrivedQuiet', 0)).toBe('foundForStep3');
    expect(ribbonLineKey('settled', 0)).toBe('stripRest');
    expect(ribbonLineKey('hidden', 0)).toBe(null);
  });
});

describe('re-read window', () => {
  it('exports a one-minute window', () => {
    expect(REREAD_WINDOW_MS).toBe(60_000);
  });
  it('suppresses arrival while re-reading until content changes', () => {
    expect(suppressArrival(true, false)).toBe(true);
    expect(suppressArrival(true, true)).toBe(false);
    expect(suppressArrival(false, false)).toBe(false);
  });
  it('snapshot ignores answers, extraction rows, and synthetic naming rows', () => {
    const identity = { characters: [{ characterId: 'ch1' }] };
    const a = perceptionSnapshot(identity, [q('p1', 'ch1', null), q('ramble_x'), q('name_ch2', 'ch2')]);
    const b = perceptionSnapshot(identity, [q('p1', 'ch1', 'Grandma'), q('ramble_y')]);
    expect(a).toBe(b); // parent answered + extraction churned — NOT a refresh landing
    const c = perceptionSnapshot({ characters: [{ characterId: 'ch9' }] }, [q('p1', 'ch1')]);
    expect(c).not.toBe(a); // roster actually changed — refresh landed
  });
});

describe('livePatchFor', () => {
  it('persists non-empty name/title, trimmed', () => {
    expect(livePatchFor('childName', ' Kai ')).toEqual({ childName: 'Kai' });
    expect(livePatchFor('title', 'The Little Rider')).toEqual({ title: 'The Little Rider' });
  });
  it('clearing name/title cancels the pending field instead of PATCHing empty', () => {
    // queue({field: undefined}) overwrites a pending value via Object.assign,
    // and JSON.stringify drops undefined keys — verified patch-debounce.ts.
    expect(livePatchFor('childName', '  ')).toEqual({ childName: undefined });
    expect(livePatchFor('title', '')).toEqual({ title: undefined });
  });
  it('tone persists including null deselect; artStyle persists as-is', () => {
    expect(livePatchFor('tone', null)).toEqual({ tone: null });
    expect(livePatchFor('tone', 'adventurous')).toEqual({ tone: 'adventurous' });
    expect(livePatchFor('artStyle', 'vignette')).toEqual({ artStyle: 'vignette' });
  });
  it('unknown keys produce no patch', () => {
    expect(livePatchFor('reviewFirst', true)).toBe(null);
    expect(livePatchFor('captureQuestions', [])).toBe(null);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run apps/web/src/components/create/setup/wizard-steps.test.ts`
Expected: FAIL — cannot resolve `./wizard-steps`.

- [ ] **Step 3: Implement**

Create `apps/web/src/components/create/setup/wizard-steps.ts`:

```typescript
/**
 * Pure rules for the X18 guided-setup wizard. No React, no DOM — everything
 * here is unit-tested and consumed by SetupWizard/steps/page for rendering
 * and behavior.
 */
import {
  STRIP_FACES_AT_MS,
  STRIP_READING_AT_MS,
  type StripPhase,
} from './strip-phase';
import type { CaptureQuestion } from './CaptureChips';

export type WizardStepId = 1 | 2 | 3 | 4;
export const WIZARD_STEP_COUNT = 4;

export type Step3State = 'reading' | 'landed' | 'settledEmpty';

export interface Step3Payload {
  rosterCount: number;
  chipCount: number;
  themeLine: string;
  perceptionQuestionCount: number;
}

/**
 * Questions that prove perception landed. `ramble_*` rows are extraction
 * facts (parent-authored input), `name_*` rows are synthetic naming rows
 * injected by handlePickEveryone/extraction — neither counts.
 */
export function perceptionQuestionCount(questions: CaptureQuestion[]): number {
  return questions.filter((q) => !q.id.startsWith('ramble_') && !q.id.startsWith('name_')).length;
}

/**
 * Step-3 resolution. A photo-mutation re-read (reReading) wins over any
 * retained stale payload; otherwise actual payload beats the sticky
 * 'settled' phase, and only perception-authored artifacts count.
 */
export function deriveStep3State(
  phase: StripPhase,
  p: Step3Payload,
  reReading: boolean,
): Step3State {
  if (reReading) return 'reading';
  const hasPayload =
    p.rosterCount > 0 ||
    p.chipCount > 0 ||
    p.themeLine.trim().length > 0 ||
    p.perceptionQuestionCount > 0;
  if (hasPayload) return 'landed';
  return phase === 'reading' ? 'reading' : 'settledEmpty';
}

export function canLeaveStep1(childName: string): boolean {
  return childName.trim().length > 0;
}

/** Deep-link guard: clamp to 1..4; anything past step 1 needs a name. */
export function guardStep(requested: number | null, childName: string): WizardStepId {
  const clamped = Math.min(Math.max(requested ?? 1, 1), WIZARD_STEP_COUNT);
  const step = (Number.isFinite(clamped) ? clamped : 1) as WizardStepId;
  if (step > 1 && !canLeaveStep1(childName)) return 1;
  return step;
}

export function parseStepParam(search: string): number | null {
  const raw = new URLSearchParams(search).get('step');
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Photo edits refresh perception, which replaces the roster unconditionally
 * while freezing an answered question set (photo-analysis.worker.ts:196-215).
 * Drop question rows bound to characters that no longer exist so a removed
 * person's answer can never become an unbound story fact.
 */
export function filterStaleCastAnswers(
  questions: CaptureQuestion[],
  rosterIds: ReadonlySet<string>,
): CaptureQuestion[] {
  return questions.filter((q) => !q.characterId || rosterIds.has(q.characterId));
}

/** Optional steps (2, 3) that were shown but never touched. */
export function skippedSteps(
  visited: ReadonlySet<WizardStepId>,
  interacted: ReadonlySet<WizardStepId>,
): WizardStepId[] {
  return ([2, 3] as WizardStepId[]).filter((s) => visited.has(s) && !interacted.has(s));
}

export type RibbonLineKey =
  | 'stripPeeking'
  | 'stripFaces'
  | 'stripReading'
  | 'foundForStep3'
  | 'stripRest';

/**
 * Reading-ribbon copy key. Staged narration while reading (same schedule as
 * LibrarianStrip); a single handoff line on arrival; the quiet rest line when
 * the poll capped out. No counter — perception persists in one transaction,
 * so a live tally would be theater pretending to be data.
 */
export function ribbonLineKey(phase: StripPhase, elapsedMs: number): RibbonLineKey | null {
  switch (phase) {
    case 'hidden':
      return null;
    case 'reading':
      if (elapsedMs < STRIP_FACES_AT_MS) return 'stripPeeking';
      if (elapsedMs < STRIP_READING_AT_MS) return 'stripFaces';
      return 'stripReading';
    case 'arrived':
    case 'arrivedQuiet':
      return 'foundForStep3';
    case 'settled':
      return 'stripRest';
  }
}

/** How long a photo mutation keeps the re-read narration alive when nothing
 * observable changes. A remove leaves stale analysis on every remaining page
 * (verified: page DELETE rewrites only index/pageNumber/isTitlePage and
 * enqueues refresh:true), so "refresh landed" has no clean signal — bounded
 * honesty instead. */
export const REREAD_WINDOW_MS = 60_000;

/** While re-reading, the strip must not announce arrival off STALE data. */
export function suppressArrival(reReading: boolean, contentChanged: boolean): boolean {
  return reReading && !contentChanged;
}

/**
 * Normalized perception-content hash for re-read completion detection.
 * Excludes answers (the parent's), `ramble_*` rows (extraction churn), and
 * `name_*` rows (synthetic) — otherwise the parent's own edits would falsely
 * "complete" a re-read. themeLine is excluded for the same reason (parent-
 * editable; refresh only writes it when blank).
 */
export function perceptionSnapshot(
  identity: unknown,
  questions: CaptureQuestion[] | null | undefined,
): string {
  const perceptionRows = (questions ?? [])
    .filter((q) => !q.id.startsWith('ramble_') && !q.id.startsWith('name_'))
    .map((q) => ({ id: q.id, question: q.question, options: q.options }));
  return JSON.stringify({ identity: identity ?? null, questions: perceptionRows });
}

/**
 * Wizard live-persistence body for one field edit, or null when the field
 * doesn't live-persist. An undefined-valued key CANCELS a pending value in
 * the debouncer (Object.assign overwrites; JSON.stringify drops undefined) —
 * clearing "Kai" mid-debounce must not let "Kai" flush later. Name/title
 * never PATCH empty (title's schema is min(1); an unaccepted name prefill
 * must not stick). tone: null is a real deselect (schema nullable).
 */
export function livePatchFor(key: string, value: unknown): Record<string, unknown> | null {
  switch (key) {
    case 'childName': {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return { childName: trimmed ? trimmed : undefined };
    }
    case 'title': {
      const trimmed = typeof value === 'string' ? value.trim() : '';
      return { title: trimmed ? trimmed : undefined };
    }
    case 'tone':
      return { tone: value };
    case 'artStyle':
      return { artStyle: value };
    default:
      return null;
  }
}

/**
 * Pure model of the shell's history protocol — user navigations PUSH (which
 * truncates forward entries, exactly like history.pushState), guards
 * REPLACE. The shell mirrors these semantics onto the real History API; the
 * tests above pin the invariants (back-then-next must not corrupt the stack,
 * recap jumps are Back-able).
 */
export interface HistModel {
  entries: number[];
  pos: number;
}

export function histInit(step: number): HistModel {
  return { entries: [step], pos: 0 };
}

export function histPush(m: HistModel, step: number): HistModel {
  const entries = [...m.entries.slice(0, m.pos + 1), step];
  return { entries, pos: entries.length - 1 };
}

export function histReplace(m: HistModel, step: number): HistModel {
  const entries = [...m.entries];
  entries[m.pos] = step;
  return { entries, pos: m.pos };
}

export function histBack(m: HistModel): HistModel {
  return { entries: m.entries, pos: Math.max(0, m.pos - 1) };
}

export function histForward(m: HistModel): HistModel {
  return { entries: m.entries, pos: Math.min(m.entries.length - 1, m.pos + 1) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run apps/web/src/components/create/setup/wizard-steps.test.ts`
Expected: all PASS.

- [ ] **Step 5: Checkpoint** — leave in working tree.

---

### Task 4: Extract `ToneRow` and `LearningWords` from StoryFraming (DOM-identical)

**Files:**
- Create: `apps/web/src/components/create/setup/ToneRow.tsx`
- Create: `apps/web/src/components/create/setup/LearningWords.tsx`
- Modify: `apps/web/src/components/create/setup/StoryFraming.tsx`

**Interfaces:**
- Produces: `<ToneRow tone onToneChange />`, `<LearningWords words onChange />` — consumed by StepDay (Task 8) and StepFinish (Task 9); StoryFraming keeps rendering both so flag-off DOM is unchanged.

- [ ] **Step 1: Create ToneRow** — the mood-row JSX moved verbatim from `StoryFraming.tsx:62-85`:

```typescript
'use client';

import React from 'react';
import { useLocale } from 'next-intl';
import { STORY_MOODS, STORY_MOOD_LABELS, type StoryMood } from '@storywink/shared/constants';
import { cn } from '@/lib/utils';

interface ToneRowProps {
  tone: StoryMood | null;
  onToneChange: (tone: StoryMood | null) => void;
}

/** The tap-first mood chips — extracted from StoryFraming so the wizard's
 * step 2 and the flag-off sheet render the exact same row. */
export function ToneRow({ tone, onToneChange }: ToneRowProps) {
  const locale = useLocale() === 'ja' ? 'ja' : 'en';
  return (
    <div className="relative">
      <div className="flex snap-x gap-1.5 overflow-x-auto pr-6 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {STORY_MOODS.map((mood) => {
          const selected = tone === mood;
          return (
            <button
              key={mood}
              type="button"
              aria-pressed={selected}
              onClick={() => onToneChange(selected ? null : mood)}
              className={cn(
                'min-h-[44px] shrink-0 snap-start rounded-full border px-4 font-playful text-sm whitespace-nowrap transition-colors',
                selected
                  ? 'border-coral bg-coral text-white'
                  : 'border-black/10 bg-white text-gray-700 hover:border-coral/50',
              )}
            >
              {STORY_MOOD_LABELS[mood][locale]}
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

export default ToneRow;
```

- [ ] **Step 2: Create LearningWords** — the block moved verbatim from `StoryFraming.tsx:140-177` including `commitWord` and the expand state:

```typescript
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';

interface LearningWordsProps {
  words: string[];
  onChange: (words: string[]) => void;
}

/** "Any words they're loving right now?" — extracted from StoryFraming;
 * rendered by the flag-off sheet and, flag-on, inside step 4's More options. */
export function LearningWords({ words, onChange }: LearningWordsProps) {
  const t = useTranslations('setup');
  const [wordsExpanded, setWordsExpanded] = React.useState(false);

  const commitWord = (raw: string, input: HTMLInputElement) => {
    const word = raw.trim().slice(0, 30);
    input.value = '';
    if (!word || words.includes(word) || words.length >= 4) return;
    onChange([...words, word]);
  };

  return wordsExpanded || words.length > 0 ? (
    <div className="flex flex-wrap items-center gap-1.5">
      {words.map((word) => (
        <button
          key={word}
          type="button"
          aria-label={t('learningWordRemove', { word })}
          onClick={() => onChange(words.filter((w) => w !== word))}
          className="rounded-full border border-coral bg-coral px-3 py-1 font-playful text-sm text-white"
        >
          {word} ×
        </button>
      ))}
      {words.length < 4 && (
        <input
          type="text"
          maxLength={30}
          placeholder={t('learningWordsPlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitWord(e.currentTarget.value, e.currentTarget);
            }
          }}
          onBlur={(e) => commitWord(e.currentTarget.value, e.currentTarget)}
          className="h-[30px] w-40 rounded-full border border-black/10 bg-white px-3 font-playful text-sm text-gray-800 focus:border-coral focus:ring-1 focus:ring-coral focus:outline-none"
        />
      )}
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setWordsExpanded(true)}
      className="min-h-[44px] self-start px-1 text-left font-playful text-sm text-gray-500 underline decoration-black/20 decoration-dashed underline-offset-4 transition-colors hover:text-gray-700"
    >
      {t('learningWordsAdd')}
    </button>
  );
}

export default LearningWords;
```

- [ ] **Step 3: Rewire StoryFraming**

1. Add imports for ToneRow and LearningWords.
2. Delete `commitWord` and the `wordsExpanded` state from StoryFraming.
3. Replace the mood-row `<div className="relative">…</div>` block with `<ToneRow tone={tone} onToneChange={onToneChange} />`.
4. Replace the entire learning-words conditional expression with `<LearningWords words={learningWords} onChange={onLearningWordsChange} />`.
5. Remove imports that became unused (`STORY_MOODS`, `STORY_MOOD_LABELS`; check `cn` — it is still used elsewhere in the file only if references remain; `useLocale` stays for `playful`).

- [ ] **Step 4: Checkpoint**

Run: `npm run check-types && npx vitest run apps/web/src/components/create/setup/` — clean, existing tests pass. Leave in working tree.

---

### Task 5: ThemeCard label prop + PhotoStrip pending-mutation callback

**Files:**
- Modify: `apps/web/src/components/create/setup/ThemeCard.tsx`
- Modify: `apps/web/src/components/create/setup/PhotoStrip.tsx`

**Interfaces:**
- Produces: `ThemeCard` optional `label?: string` (default: today's `t('themeSoundsLike')`). `PhotoStrip` optional `onPendingChange?: (delta: 1 | -1) => void` — a COUNTER protocol (not a boolean): +1 when any mutation starts, −1 in its `finally`. Overlapping upload + two removes = counter 3; page-owned count survives unmount. Consumed by Tasks 8, 10, 11.

- [ ] **Step 1: ThemeCard**

```typescript
interface ThemeCardProps {
  themeLine: string;
  /** Fires per keystroke; the caller's debounced PATCH channel persists. */
  onChange: (value: string) => void;
  /** X18: wizard passes t('themeWeThink'); default keeps the flag-off sheet
   * rendering today's copy untouched. */
  label?: string;
}
```

and in the JSX: `<p className={`${playful} text-sm text-gray-500`}>{label ?? t('themeSoundsLike')}</p>` (destructure `label` in the signature).

- [ ] **Step 2: PhotoStrip counter**

Add to `PhotoStripProps`:

```typescript
  /** X18: mutation counter protocol — +1 when an upload batch or a page
   * delete starts, -1 in its finally. The page owns the count (overlapping
   * ops compose; unmount can't strand it: these callbacks close over page
   * state and every -1 runs in finally). */
  onPendingChange?: (delta: 1 | -1) => void;
```

Destructure `onPendingChange`. In `onInputChange`, wrap the upload:

```typescript
      setUploading(true);
      onPendingChange?.(1);
      try {
        // …existing body unchanged…
      } catch (err) {
        // …existing…
      } finally {
        setUploading(false);
        onPendingChange?.(-1);
      }
```

In `handleRemove`, same pattern around the existing try/finally:

```typescript
      setRemovingId(photo.id);
      onPendingChange?.(1);
      try {
        // …existing body unchanged…
      } finally {
        setRemovingId(null);
        onPendingChange?.(-1);
      }
```

- [ ] **Step 3: Checkpoint** — `npm run check-types && npx vitest run apps/web/src/components/create/setup/` clean. Leave in working tree.

---

### Task 6: `ReadingRibbon` component

**Files:**
- Create: `apps/web/src/components/create/setup/ReadingRibbon.tsx`

Same implementation as previously specified — mascot + staged line via `ribbonLineKey` + up to 4 mini thumbnails with a hopping spark; `hero` prop for step 3's theater; no counter, no bounce; reduced-motion drops the spark. Full code:

```typescript
'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import { Storydust, SPARK4 } from '@/components/ui/storydust';
import { MASCOT_CAT_PHOTOS } from '@/lib/mascots';
import {
  STRIP_FACES_AT_MS,
  STRIP_READING_AT_MS,
  type StripPhase,
} from '@/components/create/setup/strip-phase';
import { ribbonLineKey } from '@/components/create/setup/wizard-steps';
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';

const THUMB_SWEEP_MS = 1100;
const MAX_THUMBS = 4;

interface ReadingRibbonProps {
  phase: StripPhase;
  photos: StripPhoto[];
  /** Step 3's reading theater: bigger mascot, centered column. */
  hero?: boolean;
}

/**
 * X18 — the one visible "AI is reading your photos" surface. Compact ribbon
 * under the wizard header on steps 1-2; hero variant is step 3's reading
 * state. No counter (perception persists in one transaction), no arrival
 * bounce — on arrival the line flips to the handoff copy and the ribbon dims.
 */
export function ReadingRibbon({ phase, photos, hero }: ReadingRibbonProps) {
  const t = useTranslations('setup');
  const reducedMotion = useReducedMotion() ?? false;

  const [elapsed, setElapsed] = React.useState(0);
  React.useEffect(() => {
    if (phase !== 'reading') return;
    setElapsed(0);
    const t1 = setTimeout(() => setElapsed(STRIP_FACES_AT_MS), STRIP_FACES_AT_MS);
    const t2 = setTimeout(() => setElapsed(STRIP_READING_AT_MS), STRIP_READING_AT_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [phase]);

  const thumbs = photos.slice(0, MAX_THUMBS);
  const reading = phase === 'reading';
  const [sparkIdx, setSparkIdx] = React.useState(0);
  React.useEffect(() => {
    if (!reading || reducedMotion || thumbs.length === 0) return;
    const id = setInterval(() => setSparkIdx((i) => (i + 1) % thumbs.length), THUMB_SWEEP_MS);
    return () => clearInterval(id);
  }, [reading, reducedMotion, thumbs.length]);

  const lineKey = ribbonLineKey(phase, elapsed);
  if (!lineKey) return null;

  return (
    <div
      className={cn(
        'rounded-2xl bg-coral/5 transition-opacity duration-300',
        hero ? 'flex flex-col items-center gap-3 px-4 py-6' : 'flex items-center gap-2.5 px-3 py-2',
        !reading && 'opacity-60',
      )}
    >
      <Image
        src={MASCOT_CAT_PHOTOS}
        alt={t('stripAlt')}
        width={hero ? 64 : 28}
        height={hero ? 64 : 28}
        className={hero ? 'h-16 w-16 object-contain' : 'h-7 w-7 object-contain'}
      />
      <div
        className={cn('flex min-w-0 items-center gap-1.5', hero && 'justify-center')}
        aria-hidden="true"
      >
        {thumbs.map((p, i) => {
          const src = p.thumbnailUrl || p.url;
          return (
            <span
              key={p.id}
              className={cn(
                'relative shrink-0 overflow-hidden rounded-lg border border-black/5 bg-gray-100',
                hero ? 'h-12 w-12' : 'h-8 w-8',
              )}
            >
              {src ? (
                <Image
                  src={optimizeCloudinaryUrl(src)}
                  alt=""
                  fill
                  sizes={hero ? '48px' : '32px'}
                  className="object-cover"
                />
              ) : null}
              {reading && !reducedMotion && sparkIdx === i && (
                <svg
                  viewBox="0 0 24 24"
                  width={12}
                  height={12}
                  fill="currentColor"
                  aria-hidden="true"
                  className="wink-twinkle-star absolute top-0.5 right-0.5 text-white drop-shadow"
                >
                  <path d={SPARK4} />
                </svg>
              )}
            </span>
          );
        })}
      </div>
      <div
        className={cn('flex min-w-0 flex-1 items-center gap-2', hero && 'flex-none justify-center')}
        aria-live="polite"
      >
        {reading && <Storydust variant="twinkle" size="inline" />}
        <span
          className={cn(
            'block min-w-0 truncate font-playful text-sm text-gray-600',
            reading && 'text-working-shimmer',
          )}
        >
          {t(lineKey)}
        </span>
      </div>
    </div>
  );
}

export default ReadingRibbon;
```

- [ ] **Checkpoint** — `npm run check-types` clean. Leave in working tree.

---

### Task 7: Shared step props

**Files:**
- Create: `apps/web/src/components/create/setup/steps/step-props.ts`

```typescript
import type { SetupFormState } from '@/components/create/setup/SetupSheet';
import type { StripPhoto } from '@/components/create/setup/PhotoStrip';
import type { StripPhase } from '@/components/create/setup/strip-phase';
import type {
  DiscoveryChip,
  RosterCharacterLike,
} from '@/components/create/setup/discovery-feed';
import type { WizardStepId } from '@/components/create/setup/wizard-steps';

/** Everything a wizard step can touch. The page owns all of it (same object
 * graph SetupSheet receives) — steps are pure presentation over it. */
export interface WizardStepProps {
  form: SetupFormState;
  photos: StripPhoto[];
  prefilledName?: string | null;
  titlePending: boolean;
  stripPhase: StripPhase;
  /** True while a photo-mutation re-read window is open (Task 11). */
  reReading: boolean;
  isSubmitting: boolean;
  showNameError: boolean;
  bookId?: string;
  /** Legacy drafts resumed under the flag can still have a photo cover. */
  coverAssetId: string | null;
  discoveryChips: DiscoveryChip[];
  roster: RosterCharacterLike[];
  pages: Array<{
    assetId: string | null;
    asset?: { url: string | null; thumbnailUrl: string | null } | null;
  }>;
  recurringKidCount: number;
  ensembleAllowed: boolean;
  /** Page-owned count of in-flight photo mutations (uploads/removes/reorder). */
  photoPending: number;
  onChange: <K extends keyof SetupFormState>(key: K, value: SetupFormState[K]) => void;
  onReorder: (photos: StripPhoto[]) => void;
  onPhotosChanged?: () => void | Promise<void>;
  onPhotoPendingDelta: (delta: 1 | -1) => void;
  onPickStar: (character: RosterCharacterLike) => void;
  onPickEveryone: () => void;
  onRambleBlur?: () => void;
  onSubmit: () => void;
  goToStep: (step: WizardStepId, source: 'next' | 'recap') => void;
}
```

- [ ] **Checkpoint** — `npm run check-types` clean. Leave in working tree.

---

### Task 8: Steps 1 and 2 — `StepWho`, `StepDay`

**Files:**
- Create: `apps/web/src/components/create/setup/steps/StepWho.tsx`
- Create: `apps/web/src/components/create/setup/steps/StepDay.tsx`

- [ ] **Step 1: StepWho** — the name block from `SetupSheet.tsx:172-199`, restructured (NOT verbatim): the wizard heading is the visible question, so the field label goes screen-reader-only, keeping the ensemble-aware key:

```typescript
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { WizardStepProps } from './step-props';

/** Step 1 — the one required field. The step heading doubles as the visible
 * label; the sr-only label keeps the ensemble-aware wording for AT users. */
export function StepWho({ form, prefilledName, showNameError, onChange }: WizardStepProps) {
  const t = useTranslations('setup');
  return (
    <section className="flex flex-col gap-1.5">
      <label htmlFor="childName" className="sr-only">
        {t(form.castMode === 'ensemble' ? 'childNameLabelEnsemble' : 'childNameLabel')}
      </label>
      <Input
        id="childName"
        value={form.childName}
        onChange={(e) => onChange('childName', e.target.value)}
        placeholder={t('childNamePlaceholder')}
        maxLength={50}
        className={cn(
          'font-playful text-base',
          showNameError && 'border-coral focus-visible:ring-coral',
        )}
      />
      {showNameError && <p className="text-xs text-coral">{t('childNameRequired')}</p>}
      {!showNameError && prefilledName && form.childName === prefilledName && (
        <p className="text-xs text-gray-500">
          <Sparkles className="mr-1 inline h-3 w-3 text-coral" />
          {t('childNameAgain', { name: prefilledName })}
        </p>
      )}
    </section>
  );
}

export default StepWho;
```

- [ ] **Step 2: StepDay** — photos first; cover badge follows the book's real cover state:

```typescript
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import PhotoStrip from '@/components/create/setup/PhotoStrip';
import ToneRow from '@/components/create/setup/ToneRow';
import RambleTextarea from '@/components/create/setup/RambleTextarea';
import type { WizardStepProps } from './step-props';

/** Step 2 — photos (editable, gated), tone, ramble. Typing here buys the
 * 15-45s the perception pass needs before step 3. */
export function StepDay({
  form,
  photos,
  bookId,
  stripPhase,
  coverAssetId,
  onChange,
  onReorder,
  onPhotosChanged,
  onPhotoPendingDelta,
  onRambleBlur,
}: WizardStepProps) {
  const t = useTranslations('setup');
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('photosLabel')}</label>
        <PhotoStrip
          photos={photos}
          onReorder={onReorder}
          bookId={bookId}
          onPhotosChanged={onPhotosChanged}
          onPendingChange={onPhotoPendingDelta}
          reading={stripPhase === 'reading'}
          hasPhotoCover={coverAssetId !== null}
        />
        <p className="text-xs text-gray-500">{t('photoOrderHint')}</p>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('howToTellIt')}</label>
        <ToneRow tone={form.tone} onToneChange={(v) => onChange('tone', v)} />
      </section>

      <section className="flex flex-col gap-1.5">
        <p className="font-playful text-sm text-gray-600">{t('rambleLabel')}</p>
        <RambleTextarea
          value={form.eventSummary}
          onChange={(v) => onChange('eventSummary', v)}
          onBlur={onRambleBlur}
          placeholder={t('eventSummaryPlaceholder')}
          hint={t('eventSummaryHint')}
        />
      </section>
    </div>
  );
}

export default StepDay;
```

- [ ] **Checkpoint** — `npm run check-types` clean. Leave in working tree.

---

### Task 9: Steps 3 and 4 — `StepSaw`, `StepFinish`

**Files:**
- Create: `apps/web/src/components/create/setup/steps/StepSaw.tsx`
- Create: `apps/web/src/components/create/setup/steps/StepFinish.tsx`

**Interfaces:**
- Consumes: `deriveStep3State`/`perceptionQuestionCount` (Task 3, now with `reReading`), `ReadingRibbon` (Task 6), existing components. NOTE: `setup_step3_transition` telemetry lives in the SHELL (Task 10), not here — StepSaw only renders; the transition must be observable even when the parent is on another step.

- [ ] **Step 1: StepSaw**

```typescript
'use client';

import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import CastRow from '@/components/create/setup/CastRow';
import DiscoveryFeed from '@/components/create/setup/DiscoveryFeed';
import ThemeCard from '@/components/create/setup/ThemeCard';
import CaptureChips from '@/components/create/setup/CaptureChips';
import ReadingRibbon from '@/components/create/setup/ReadingRibbon';
import {
  deriveStep3State,
  perceptionQuestionCount,
} from '@/components/create/setup/wizard-steps';
import type { WizardStepProps } from './step-props';

/** Step 3 — the payoff. Reading theater (incl. photo-mutation re-reads),
 * the landed reveal, or one honest settled-empty line. Never blocks. */
export function StepSaw({
  form,
  photos,
  bookId,
  stripPhase,
  reReading,
  discoveryChips,
  roster,
  pages,
  recurringKidCount,
  ensembleAllowed,
  onChange,
  onPickStar,
  onPickEveryone,
}: WizardStepProps) {
  const t = useTranslations('setup');
  const playful = useLocale() === 'ja' ? 'font-japanese' : 'font-playful';

  const state = deriveStep3State(
    stripPhase,
    {
      rosterCount: roster.length,
      chipCount: discoveryChips.length,
      themeLine: form.themeLine,
      perceptionQuestionCount: perceptionQuestionCount(form.captureQuestions),
    },
    reReading,
  );

  if (state === 'reading') {
    return <ReadingRibbon phase={reReading ? 'reading' : stripPhase} photos={photos} hero />;
  }

  if (state === 'settledEmpty') {
    return <p className={`${playful} text-base text-gray-600`}>{t('readerSlow')}</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <CastRow
        bookId={bookId}
        roster={roster}
        pages={pages}
        questions={form.captureQuestions}
        castMode={form.castMode}
        starCharacterId={form.starCharacterId}
        childName={form.childName}
        recurringKidCount={recurringKidCount}
        reading={false}
        ensembleAllowed={ensembleAllowed}
        onPickStar={onPickStar}
        onPickEveryone={onPickEveryone}
        onQuestionsChange={(qs) => onChange('captureQuestions', qs)}
      />
      <DiscoveryFeed chips={discoveryChips} reserve={false} />
      <ThemeCard
        themeLine={form.themeLine}
        label={t('themeWeThink')}
        onChange={(v) => onChange('themeLine', v)}
      />
      <CaptureChips
        questions={form.captureQuestions}
        caps={form.castMode === 'ensemble' ? { naming: 4, total: 5 } : undefined}
        onChange={(qs) => onChange('captureQuestions', qs)}
      />
    </div>
  );
}

export default StepSaw;
```

- [ ] **Step 2: StepFinish** — unchanged from the prior spec except `goToStep` calls pass `'recap'`:

```typescript
'use client';

import React from 'react';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ChevronRight } from 'lucide-react';
import { optimizeCloudinaryUrl } from '@storywink/shared';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Storydust } from '@/components/ui/storydust';
import ArtStyleStrip from '@/components/create/setup/ArtStyleStrip';
import LearningWords from '@/components/create/setup/LearningWords';
import { describeCharacter } from '@/components/create/setup/discovery-feed';
import type { WizardStepProps } from './step-props';

const RECAP_THUMBS = 5;

/** Step 4 — style, title, a read-only receipt, More options, and the flow's
 * only CTA. Photos are read-only here (tap → back to step 2): a photo edit
 * after the payoff would invalidate step-3 answers. */
export function StepFinish({
  form,
  photos,
  titlePending,
  isSubmitting,
  roster,
  onChange,
  onSubmit,
  goToStep,
}: WizardStepProps) {
  const t = useTranslations('setup');
  const [optionsOpen, setOptionsOpen] = React.useState(false);

  const star = roster.find((c) => c.characterId === form.starCharacterId);
  const starLabel =
    form.castMode === 'ensemble'
      ? t('recapCastEveryone')
      : star
        ? t('recapCast', { name: star.name ?? describeCharacter(star) })
        : null;

  return (
    <div className="flex flex-col gap-6">
      <button
        type="button"
        onClick={() => goToStep(2, 'recap')}
        aria-label={t('editPhotos')}
        className="flex min-h-[44px] w-full items-center gap-2 rounded-2xl border border-black/10 bg-white px-3 py-2 text-left"
      >
        <span className="flex shrink-0 items-center gap-1">
          {photos.slice(0, RECAP_THUMBS).map((p) => {
            const src = p.thumbnailUrl || p.url;
            return (
              <span
                key={p.id}
                className="relative h-8 w-8 overflow-hidden rounded-lg border border-black/5 bg-gray-100"
              >
                {src ? (
                  <Image
                    src={optimizeCloudinaryUrl(src)}
                    alt=""
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                ) : null}
              </span>
            );
          })}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-gray-600">
          {t('recapPhotos', { count: photos.length })}
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
      </button>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-600">{t('artStyleLabel')}</label>
        <ArtStyleStrip value={form.artStyle} onChange={(s) => onChange('artStyle', s)} />
      </section>

      <section className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-sm font-medium text-gray-600">
          {t('titleLabel')}
        </label>
        <div className="relative">
          <Input
            id="title"
            value={form.title}
            onChange={(e) => onChange('title', e.target.value)}
            placeholder={titlePending ? '' : t('titlePlaceholder')}
            maxLength={100}
            className="font-playful text-base"
          />
          {titlePending && !form.title && (
            <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center gap-2 text-gray-400">
              <Storydust variant="twinkle" size="inline" />
              <span className="font-playful text-sm">{t('titleThinking')}</span>
            </div>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => goToStep(1, 'recap')}
          className="flex min-h-[36px] items-center justify-between gap-2 text-left"
        >
          <span className="min-w-0 truncate text-sm text-gray-600">
            {t('recapFor', { name: form.childName.trim() })}
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        </button>
        {form.eventSummary.trim() && (
          <button
            type="button"
            onClick={() => goToStep(2, 'recap')}
            className="flex min-h-[36px] items-center justify-between gap-2 text-left"
          >
            <span className="min-w-0 truncate text-sm text-gray-600">
              {t('recapDay', { summary: form.eventSummary.trim() })}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        )}
        {starLabel && (
          <button
            type="button"
            onClick={() => goToStep(3, 'recap')}
            className="flex min-h-[36px] items-center justify-between gap-2 text-left"
          >
            <span className="min-w-0 truncate text-sm text-gray-600">{starLabel}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
          </button>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <button
          type="button"
          aria-expanded={optionsOpen}
          onClick={() => setOptionsOpen((v) => !v)}
          className="min-h-[44px] self-start px-1 text-left font-playful text-sm text-gray-500 underline decoration-black/20 decoration-dashed underline-offset-4 transition-colors hover:text-gray-700"
        >
          {t('moreOptions')}
        </button>
        {optionsOpen && (
          <div className="flex flex-col gap-4">
            <LearningWords
              words={form.learningWords}
              onChange={(v) => onChange('learningWords', v)}
            />
            <div className="flex items-center justify-between">
              <label htmlFor="reviewFirst" className="text-sm text-gray-500">
                {t('reviewFirstLabel')}
              </label>
              <Switch
                id="reviewFirst"
                checked={form.reviewFirst}
                onCheckedChange={(v) => onChange('reviewFirst', v)}
              />
            </div>
          </div>
        )}
      </section>

      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-70"
      >
        {isSubmitting ? (
          <>
            <Storydust variant="twinkle" size="inline" className="text-white" />
            {t('saving')}
          </>
        ) : (
          t('makeMyBook')
        )}
      </button>
    </div>
  );
}

export default StepFinish;
```

- [ ] **Checkpoint** — `npm run check-types` clean. Leave in working tree.

---

### Task 10: `SetupWizard` shell

**Files:**
- Create: `apps/web/src/components/create/setup/SetupWizard.tsx`

**Interfaces:**
- Produces: `<SetupWizard {...SetupWizardProps} />` where `SetupWizardProps = Omit<WizardStepProps, 'goToStep'> & { onReachFinish: () => void; onNameErrorRequest: () => void; summaryEdited: boolean }`. Consumed by Task 11.
- History protocol (mirrors the Task 3 model): user navigations (`next` AND `recap`) call `pushState` — push truncates forward entries, which is exactly what fixes back-then-next corruption and makes recap jumps Back-able. `replaceState` only for guards/canonicalization. Back button and popstate handling are nav-locked.
- `onReachFinish` fires SYNCHRONOUSLY inside `goToStep` before any history write when the target is step 4 (Sol blocker: the post-render effect leaves a gap where a resolved extraction response can still mutate the form).

- [ ] **Step 1: Implement**

```typescript
'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { track } from '@/lib/track';
import ReadingRibbon from '@/components/create/setup/ReadingRibbon';
import { Storydust } from '@/components/ui/storydust';
import {
  WIZARD_STEP_COUNT,
  canLeaveStep1,
  deriveStep3State,
  guardStep,
  parseStepParam,
  perceptionQuestionCount,
  skippedSteps,
  type WizardStepId,
} from '@/components/create/setup/wizard-steps';
import StepWho from './steps/StepWho';
import StepDay from './steps/StepDay';
import StepSaw from './steps/StepSaw';
import StepFinish from './steps/StepFinish';
import type { WizardStepProps } from './steps/step-props';

const STEP_TITLE_KEYS: Record<WizardStepId, string> = {
  1: 'stepWhoTitle',
  2: 'stepDayTitle',
  3: 'stepSawTitle',
  4: 'stepFinishTitle',
};

const TRANSITION_MS = 200;

export type SetupWizardProps = Omit<WizardStepProps, 'goToStep'> & {
  /** Deterministic extraction cutoff — called synchronously before entering
   * step 4 (and again from submit); the page aborts in-flight ramble
   * extraction and blocks new ones. */
  onReachFinish: () => void;
  /** Step-1 Next with an empty name → the page flips showNameError. */
  onNameErrorRequest: () => void;
  summaryEdited: boolean;
};

export function SetupWizard(props: SetupWizardProps) {
  const {
    form,
    photoPending,
    stripPhase,
    reReading,
    photos,
    bookId,
    discoveryChips,
    roster,
    onReachFinish,
  } = props;
  const t = useTranslations('setup');
  const reducedMotion = useReducedMotion() ?? false;

  // Parent only mounts this after the client-side book load, so window is
  // always available in the initializer.
  const [step, setStep] = React.useState<WizardStepId>(() =>
    guardStep(parseStepParam(window.location.search), form.childName),
  );
  // 1 forward slide, -1 back slide, 0 crossfade (recap jumps / pops).
  const [direction, setDirection] = React.useState<1 | -1 | 0>(1);
  const visited = React.useRef(new Set<WizardStepId>([step]));
  const interacted = React.useRef(new Set<WizardStepId>());
  const viewed = React.useRef(new Set<WizardStepId>());
  const navLock = React.useRef(false);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  const lockNav = () => {
    if (navLock.current) return false;
    navLock.current = true;
    setTimeout(() => {
      navLock.current = false;
    }, TRANSITION_MS + 100);
    return true;
  };

  const blurActive = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  // Canonicalize the entry URL once, replacing so Back still exits the flow.
  React.useEffect(() => {
    window.history.replaceState({ winkStep: step }, '', `?step=${step}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // System back/forward → step change; guards canonicalize via replace.
  React.useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const raw =
        typeof e.state?.winkStep === 'number'
          ? e.state.winkStep
          : parseStepParam(window.location.search);
      // Untagged pop on this pathname (edge: user meddled with the URL):
      // guard and canonicalize rather than guessing.
      let target = guardStep(raw, form.childName);
      // Forward-pop into a photo-gated step while mutations are in flight:
      // bounce back to step 2 (canonicalized, no new entry).
      if (target > 2 && step === 2 && photoPending > 0) target = 2;
      if (target !== raw || typeof e.state?.winkStep !== 'number') {
        window.history.replaceState({ winkStep: target }, '', `?step=${target}`);
      }
      if (target === 4) onReachFinish();
      blurActive();
      setDirection(0);
      setStep(target);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [form.childName, step, photoPending, onReachFinish]);

  // Per-step: telemetry (deduped), focus, scroll. (Cutoff runs in goToStep.)
  React.useEffect(() => {
    visited.current.add(step);
    if (!viewed.current.has(step)) {
      viewed.current.add(step);
      track('setup_step_viewed', { ...(bookId ? { bookId } : {}), props: { step } });
    }
    window.scrollTo({ top: 0 });
    const id = setTimeout(() => headingRef.current?.focus(), TRANSITION_MS + 50);
    return () => clearTimeout(id);
  }, [step, bookId]);

  // setup_step3_transition — observed at SHELL level so it fires even when
  // perception resolves while the parent is on steps 1-2, and exactly once.
  const step3 = deriveStep3State(
    stripPhase,
    {
      rosterCount: roster.length,
      chipCount: discoveryChips.length,
      themeLine: form.themeLine,
      perceptionQuestionCount: perceptionQuestionCount(form.captureQuestions),
    },
    reReading,
  );
  const sawReading = React.useRef(step3 === 'reading');
  const transitionReported = React.useRef(false);
  React.useEffect(() => {
    if (step3 === 'reading') {
      sawReading.current = true;
      return;
    }
    if (sawReading.current && !transitionReported.current) {
      transitionReported.current = true;
      track('setup_step3_transition', {
        ...(bookId ? { bookId } : {}),
        props: { to: step3 },
      });
    }
  }, [step3, bookId]);

  const goToStep = React.useCallback(
    (target: WizardStepId, source: 'next' | 'recap') => {
      if (target === step) return;
      if (target > 1 && !canLeaveStep1(form.childName)) return;
      // Forward past the photo step is gated on in-flight mutations,
      // wherever the navigation came from (Next button or recap jump).
      if (target > 2 && step <= 2 && photoPending > 0) return;
      if (!lockNav()) return;
      if (target === 4) onReachFinish(); // synchronous, BEFORE history/state
      blurActive();
      setDirection(source === 'next' ? (target > step ? 1 : -1) : 0);
      // User navigations always PUSH: pushState truncates forward entries,
      // so back-then-next can't corrupt the stack, and recap jumps are
      // Back-able (see wizard-steps history-model tests).
      window.history.pushState({ winkStep: target }, '', `?step=${target}`);
      setStep(target);
    },
    [step, form.childName, photoPending, onReachFinish],
  );

  const handleNext = () => {
    if (step === 1 && !canLeaveStep1(form.childName)) {
      props.onNameErrorRequest();
      return;
    }
    if (step === 2 && photoPending > 0) return;
    if (step < WIZARD_STEP_COUNT) goToStep((step + 1) as WizardStepId, 'next');
  };

  const handleBack = () => {
    if (!lockNav()) return;
    window.history.back(); // past step 1 this exits the flow via real history
  };

  const handleSubmit = () => {
    track('setup_submitted', {
      ...(bookId ? { bookId } : {}),
      props: {
        reviewFirst: form.reviewFirst,
        chipsAnswered: form.captureQuestions.filter((q) => q.answer && q.answer !== '__skip__')
          .length,
        ...(form.tone ? { tone: form.tone } : {}),
        stripPhaseAtSubmit: stripPhase,
        summaryEdited: props.summaryEdited,
        wizard: true,
        skippedSteps: skippedSteps(visited.current, interacted.current),
        step3State: step3,
      },
    });
    props.onSubmit();
  };

  const markInteracted = () => interacted.current.add(step);

  // Steps see interaction-marking wrappers around every user-action callback
  // (photo edits and star picks count as interaction, not just typing).
  const stepProps: WizardStepProps = {
    ...props,
    onChange: (key, value) => {
      markInteracted();
      props.onChange(key, value);
    },
    onReorder: (next) => {
      markInteracted();
      props.onReorder(next);
    },
    onPhotosChanged: () => {
      markInteracted();
      return props.onPhotosChanged?.();
    },
    onPickStar: (c) => {
      markInteracted();
      props.onPickStar(c);
    },
    onPickEveryone: () => {
      markInteracted();
      props.onPickEveryone();
    },
    onSubmit: handleSubmit,
    goToStep,
  };

  const nextDisabled = step === 2 && photoPending > 0;

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-5 px-4 pt-4 pb-10">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t('back')}
          onClick={handleBack}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={WIZARD_STEP_COUNT}
          aria-valuenow={step}
          aria-label={t('progressLabel', {
            n: step,
            total: WIZARD_STEP_COUNT,
            title: t(STEP_TITLE_KEYS[step]),
          })}
          className="flex flex-1 gap-1.5"
        >
          {([1, 2, 3, 4] as WizardStepId[]).map((s) => (
            <span
              key={s}
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors duration-300',
                s <= step ? 'bg-coral' : 'bg-black/10',
              )}
            />
          ))}
        </div>
      </div>

      <h1
        ref={headingRef}
        tabIndex={-1}
        className="font-playful text-2xl text-[#1a1a1a] outline-none"
      >
        {t(STEP_TITLE_KEYS[step])}
      </h1>

      {step <= 2 && stripPhase !== 'hidden' && <ReadingRibbon phase={stripPhase} photos={photos} />}

      <div className="relative overflow-x-clip">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={
              reducedMotion || direction === 0
                ? { opacity: 0 }
                : { opacity: 0, x: direction === 1 ? 32 : -32 }
            }
            animate={{ opacity: 1, x: 0 }}
            exit={
              reducedMotion || direction === 0
                ? { opacity: 0 }
                : { opacity: 0, x: direction === 1 ? -32 : 32 }
            }
            transition={{ duration: TRANSITION_MS / 1000, ease: 'easeOut' }}
          >
            {step === 1 && <StepWho {...stepProps} />}
            {step === 2 && <StepDay {...stepProps} />}
            {step === 3 && <StepSaw {...stepProps} />}
            {step === 4 && <StepFinish {...stepProps} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {step < WIZARD_STEP_COUNT && (
        <button
          type="button"
          onClick={handleNext}
          disabled={nextDisabled}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-coral px-6 py-3.5 font-playful text-lg text-white shadow-md transition-colors hover:bg-coral/90 disabled:opacity-70"
        >
          {nextDisabled ? (
            <>
              <Storydust variant="twinkle" size="inline" className="text-white" />
              {t('waitingForPhotos')}
            </>
          ) : (
            t('next')
          )}
        </button>
      )}
    </div>
  );
}

export default SetupWizard;
```

- [ ] **Checkpoint** — `npm run check-types` clean (SetupWizard has no callsite yet). Leave in working tree.

---

### Task 11: Page wiring

**Files:**
- Modify: `apps/web/src/app/create/[bookId]/setup/page.tsx`

**Interfaces:**
- Consumes everything above. Produces the shipped feature. EVERY behavioral branch uses `WIZARD_ENABLED`, never `CREATE_WIZARD_FLAG` alone.

- [ ] **Step 1: Imports**

Merge into the existing imports:

```typescript
import SetupWizard from '@/components/create/setup/SetupWizard';
import { ENSEMBLE_BOOKS_FLAG, WIZARD_ENABLED } from '@/lib/discovery-client';
import {
  REREAD_WINDOW_MS,
  filterStaleCastAnswers,
  livePatchFor,
  perceptionQuestionCount,
  perceptionSnapshot,
  suppressArrival,
} from '@/components/create/setup/wizard-steps';
```

(`CREATE_DISCOVERY_FLAG` and `recurringChildren` are already imported.)

- [ ] **Step 2: New state/refs** (near `analysisDone`)

```typescript
  // X18: photo-mutation re-read. reReading is REACTIVE state — StepSaw must
  // fall back to the reading theater even though the stale roster/theme
  // payload is still merged. Cleared by real perception-content change or
  // window expiry (timer), never by the poll cap alone.
  const [reReading, setReReading] = useState(false);
  const reReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Normalized perception snapshot (identity + perception question rows).
  const perceptionSnapRef = useRef<string>('');
  // Set at mutation time; the FIRST post-mutation merge becomes the baseline
  // (the DELETE/upload response itself is not the refresh landing).
  const awaitingBaselineRef = useRef(false);
  const baselineSnapRef = useRef<string>('');
  const [mutationNonce, setMutationNonce] = useState(0);
  // Page-owned in-flight photo-mutation counter (uploads + removes + reorder).
  const [photoPending, setPhotoPending] = useState(0);
  const handlePhotoPendingDelta = useCallback((delta: 1 | -1) => {
    setPhotoPending((n) => Math.max(0, n + delta));
  }, []);
```

- [ ] **Step 3: Extraction cutoff** (replace inside `handleRambleBlur`, add refs near `lastExtractRef`)

```typescript
  const extractAbortRef = useRef<AbortController | null>(null);
  const extractionClosedRef = useRef(false);

  const handleReachFinish = useCallback(() => {
    extractionClosedRef.current = true;
    extractAbortRef.current?.abort();
  }, []);

  const handleNameErrorRequest = useCallback(() => setShowNameError(true), []);
```

In `handleRambleBlur`:
- First line: `if (extractionClosedRef.current) return;`
- Replace `const controller = new AbortController();` with:

```typescript
      extractAbortRef.current?.abort();
      const controller = new AbortController();
      extractAbortRef.current = controller;
```

- Wrap the timeout clear in `finally` (move `clearTimeout(timeout)` there and null the controller if still current):

```typescript
      } finally {
        clearTimeout(timeout);
        if (extractAbortRef.current === controller) extractAbortRef.current = null;
      }
```

- Immediately after `const facts = (await res.json()) as RambleExtraction;` add the full guard:

```typescript
      if (
        extractionClosedRef.current ||
        controller.signal.aborted ||
        !isMountedRef.current
      )
        return;
```

- Inside the `setForm` updater, first line: `if (extractionClosedRef.current) return prev;`
- In `handleSubmit`, first line inside `try`: `handleReachFinish();` and add `handleReachFinish` (and `roster`, Step 6) to its dependency array.

- [ ] **Step 4: Live persistence** — extend `handleChange`'s flag-on block:

```typescript
      if (CREATE_DISCOVERY_FLAG) {
        if (key === 'themeLine')
          patcherRef.current?.queue({ themeLine: (value as string).trim() || null });
        if (key === 'eventSummary')
          patcherRef.current?.queue({ eventSummary: (value as string).trim() || null });
        if (key === 'captureQuestions') patcherRef.current?.queue({ captureQuestions: value });
      }
      if (WIZARD_ENABLED) {
        // Wizard sessions are minutes long — persist edits as they land so a
        // refresh resumes. livePatchFor's undefined-valued keys CANCEL a
        // pending value (clearing "Kai" mid-debounce must not flush "Kai").
        const patch = livePatchFor(key, value);
        if (patch) patcherRef.current?.queue(patch);
      }
```

- [ ] **Step 5: mergeBook changes** (all inside the existing `mergeBook` callback)

(a) artStyle clobber guard, wizard-only (flag-off keeps today's unconditional apply — the pre-existing clobber there is logged as a follow-up, not fixed here). Add `artStyle: false` to the `touched` ref object literal, and replace the style-apply line:

```typescript
      if ((!WIZARD_ENABLED || !touched.current.artStyle) && book.artStyle && isValidStyle(book.artStyle)) {
        next.artStyle = book.artStyle as StyleKey;
      }
```

(b) stale-answer filter, after the captureQuestions merge inside `setForm`:

```typescript
      if (WIZARD_ENABLED) {
        const ids = new Set(characters.map((c) => c.characterId));
        next.captureQuestions = filterStaleCastAnswers(next.captureQuestions, ids);
      }
```

(c) re-read snapshot + suppression + wizard arrival semantics — replace the final `setStripPhase(arrivalStripPhase(…))` block:

```typescript
    const snap = perceptionSnapshot(book.characterIdentity ?? null, book.captureQuestions);
    if (awaitingBaselineRef.current) {
      // First merge after a mutation: this response is the baseline, not the
      // refresh landing — record and suppress.
      awaitingBaselineRef.current = false;
      baselineSnapRef.current = snap;
    }
    const contentChanged = reReading && snap !== baselineSnapRef.current;
    perceptionSnapRef.current = snap;
    if (contentChanged) {
      // Refresh landed — close the window so arrival can announce.
      if (reReadTimerRef.current) clearTimeout(reReadTimerRef.current);
      setReReading(false);
    }
    if (!suppressArrival(reReading, contentChanged)) {
      setStripPhase((prev) =>
        arrivalStripPhase(prev, {
          // Wizard mode: the parent's own ramble/extraction must not read as
          // perception arrival — count only perception-authored questions and
          // ignore a parent-authored summary (Sol: premature settledEmpty).
          captureQuestionCount: WIZARD_ENABLED
            ? perceptionQuestionCount(book.captureQuestions ?? [])
            : (book.captureQuestions?.length ?? 0),
          hasEventSummary: WIZARD_ENABLED
            ? !!book.eventSummary && !touched.current.eventSummary
            : !!book.eventSummary,
          allAnalyzed: analyzed,
        }),
      );
    }
```

`mergeBook`'s dependency array gains `reReading`. (It is a `useCallback` — add the dep and let the poll/refetch closures pick up the fresh version; the poll effect already lists `mergeBook`.)

- [ ] **Step 6: Photo-mutation handler** — replace `refetchBook` with an arm-then-refetch pair; arming is unconditional and happens BEFORE the fetch (a successful DELETE with a failed follow-up GET must still re-arm):

```typescript
  const refetchBook = useCallback(async () => {
    try {
      const res = await fetch(`/api/book/${bookId}`);
      if (!res.ok || !isMountedRef.current) return;
      const book: BookData = await res.json();
      if (!isMountedRef.current) return;
      mergeBook(book);
      if (!WIZARD_ENABLED) {
        // Legacy inference, byte-identical to today's behavior:
        if (!allPagesAnalyzed(book.pages) && isFreshBook(book.createdAt, Date.now())) {
          setPerceptionSettled(false);
          setStripPhase('reading');
        }
      }
    } catch {
      // Non-fatal — the strip keeps its optimistic state until the next fetch.
    }
  }, [bookId, mergeBook]);

  // X18: every photo add/remove lands here (PhotoStrip's onPhotosChanged).
  // The mutation itself proves a refresh pass is in flight — no freshness
  // gate (the DELETE route enqueues refresh:true for any DRAFT).
  const handlePhotosMutated = useCallback(async () => {
    if (WIZARD_ENABLED) {
      awaitingBaselineRef.current = true;
      setReReading(true);
      setStripPhase('reading');
      setPerceptionSettled(false);
      setAnalysisDone(false);
      setMutationNonce((n) => n + 1);
      if (reReadTimerRef.current) clearTimeout(reReadTimerRef.current);
      reReadTimerRef.current = setTimeout(() => {
        // Window expiry: stop claiming to read; the next merge announces
        // whatever is true (usually arrivedQuiet off the stale-but-only data).
        setReReading(false);
      }, REREAD_WINDOW_MS);
    }
    await refetchBook();
  }, [refetchBook]);

  useEffect(
    () => () => {
      if (reReadTimerRef.current) clearTimeout(reReadTimerRef.current);
    },
    [],
  );
```

Wrap `handleReorder` with the pending counter (wizard only pays attention, but the counter is harmless flag-off — still, gate it):

```typescript
  const handleReorder = useCallback(
    async (next: StripPhoto[]) => {
      setPhotos(next);
      if (WIZARD_ENABLED) handlePhotoPendingDelta(1);
      try {
        const res = await fetch(`/api/book/${bookId}/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pages: next.map((p, idx) => ({ pageId: p.id, index: idx })),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        toast.error(t('reorderError'));
      } finally {
        if (WIZARD_ENABLED) handlePhotoPendingDelta(-1);
      }
    },
    [bookId, t, handlePhotoPendingDelta],
  );
```

- [ ] **Step 7: Poll gate** — extend the early-return condition and deps:

```typescript
    if (!needsTitle && !needsSummary && !needsQuestions && !needsAnalysis && !reReading) return;
```

and add `reReading` and `mutationNonce` to the dependency array.

- [ ] **Step 8: Submit filter** — in `handleSubmit`, before `buildSubmitPatchBody`:

```typescript
      const submitForm = WIZARD_ENABLED
        ? {
            ...form,
            captureQuestions: filterStaleCastAnswers(
              form.captureQuestions,
              new Set(roster.map((c) => c.characterId)),
            ),
          }
        : form;
      const patchBody = buildSubmitPatchBody(submitForm);
```

- [ ] **Step 9: Render branch** — replace the final `return <SetupSheet …/>`:

```tsx
  if (WIZARD_ENABLED) {
    return (
      <SetupWizard
        form={form}
        photos={photos}
        prefilledName={prefilledName}
        titlePending={titlePending}
        stripPhase={stripPhase}
        reReading={reReading}
        isSubmitting={isSubmitting}
        showNameError={showNameError}
        bookId={bookId}
        coverAssetId={coverAssetId}
        discoveryChips={discoveryChips}
        roster={roster}
        pages={bookPages}
        recurringKidCount={recurringChildren(roster).length}
        ensembleAllowed={ENSEMBLE_BOOKS_FLAG}
        photoPending={photoPending}
        summaryEdited={touched.current.eventSummary}
        onChange={handleChange}
        onReorder={handleReorder}
        onPhotosChanged={handlePhotosMutated}
        onPhotoPendingDelta={handlePhotoPendingDelta}
        onPickStar={handlePickStar}
        onPickEveryone={handlePickEveryone}
        onRambleBlur={handleRambleBlur}
        onSubmit={handleSubmit}
        onReachFinish={handleReachFinish}
        onNameErrorRequest={handleNameErrorRequest}
      />
    );
  }

  return (
    <SetupSheet
      /* …existing props exactly as today, with onPhotosChanged={refetchBook} unchanged… */
    />
  );
```

- [ ] **Step 10: Checkpoint**

Run: `npm run check-types && npx vitest run apps/web/src/components/create/setup/ && npm run lint`
Expected: clean. Leave in working tree.

---

### Task 12: Telemetry allowlist (TDD)

**Files:**
- Modify: `apps/web/src/lib/client-events.ts`
- Test: `apps/web/src/lib/client-events.test.ts`

- [ ] **Step 1: Add a DEDICATED test block** (do not piggyback on the story-helper list; the first allowlist test iterates `CLIENT_EVENT_NAMES` and is tautological):

```typescript
  it('accepts the X18 wizard funnel events', () => {
    for (const name of ['setup_step_viewed', 'setup_step3_transition'] as const) {
      expect(CLIENT_EVENT_NAMES).toContain(name);
      expect(clientEventSchema.safeParse({ name }).success, `expected '${name}' accepted`).toBe(
        true,
      );
    }
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run apps/web/src/lib/client-events.test.ts` FAILS.

- [ ] **Step 3: Add the names**

```typescript
  // X18: guided-setup wizard funnel — per-step views (deduped client-side)
  // and the step-3 reading→terminal transition.
  'setup_step_viewed',
  'setup_step3_transition',
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Checkpoint** — leave in working tree.

---

### Task 13: Full check suite

- [ ] Run: `npm run lint && npm run check-types && npm run test && npm run i18n:check`
Expected: all clean. Format ONLY touched files if needed: `npx prettier --write <the files this plan created/modified>`. Never `npm run format`, never `git add`.

---

### Task 14: QA + proof pass (run by Claude, not the implementing agent)

Executed by Claude with browser tooling per the dual-brain workflow; Claude also makes all commits for Tasks 1–13 after review:

- [ ] Dev server + wizard flag ON locally (`NEXT_PUBLIC_CREATE_WIZARD_ENABLED=true` in `apps/web/.env.local`).
- [ ] Mobile (390×844) walkthrough, screenshots to `.screenshots/x18-m-*`: each step; reading→landed on step 3; settled-empty (workers stopped); photo remove at step 2 AFTER answering step-3 questions (re-read theater shows, stale answers dropped, arrival only after content change or window expiry); pending-upload gate on step-2 Next (button shows waitingForPhotos); double-tap Next and double-tap Back (nav lock — no skipped entries); back-then-next (step 3 preserved in history); recap tap-backs (Back returns to step 4); browser back exit past step 1; refresh on every step (resumes step + persisted name/title/tone/style); More options; clearing the name mid-debounce then refreshing (no "Kai" resurrection).
- [ ] Desktop (`x18-d-*`) and ja (`x18-ja-*`: step titles, themeWeThink, progress label).
- [ ] Flag matrix: wizard off → sheet identical (screenshot diff); wizard on + discovery off → sheet identical AND network tab shows today's PATCH/poll traffic only (`WIZARD_ENABLED` gating proof).
- [ ] Extraction cutoff: `/api/story/propose` aborted on step-3→4 advance; no post-submit PATCH.
- [ ] Brand check vs `.claude/rules/brand.md`.
- [ ] Owner note: one physical iOS Safari pass (keyboard + edge-swipe back) before the flag flips.

---

## Execution notes

- Order: 1→2→3→4→5→6→7→8→9→10→11; 12 any time after 1; 13–14 last.
- The executor NEVER commits (AGENTS.md rule 7); Claude commits reviewed checkpoints.
- After Task 14, `/codex:adversarial-review --base main` in a fresh thread before any flag flip.
- Flag stays OFF in prod until owner reviews QA artifacts and ja copy passes native review.
- Known follow-up (out of scope, logged): flag-off artStyle poll-clobber (pre-existing — a selection can revert while the poll is active on the legacy sheet).

## Sol plan-review dispositions (xhigh, fresh thread, 2026-07-23)

| # | Finding | Disposition |
|---|---|---|
| 1 | Re-read never resets step-3 payload; freshness gate wrong; baseline/hash flaws; no expiry | **Adopted.** Reactive `reReading` beats payload in `deriveStep3State`; no freshness gate; arm-before-refetch; post-mutation baseline; normalized snapshot (answers/ramble_/name_/theme excluded); expiry timer. |
| 2 | navKind corrupts the history stack; recap/forward/lock/canonicalize gaps | **Adopted (simplified).** All user navs push (push truncates forward — fixes back-then-next AND makes recaps Back-able); replace only for guards; Back nav-locked; guarded pops canonicalize; recap jumps crossfade. Pure hist model + sequence tests pin it. |
| 3 | Boolean busy flag wrong: overlaps, reorder, unmount, popstate bypass | **Adopted.** Counter protocol (`onPendingChange` ±1 in finally), page-owned count, reorder wrapped, gate enforced in `goToStep` and popstate. |
| 4 | Extraction cutoff races (effect timing, resolved response) | **Adopted.** Synchronous cutoff in `goToStep`/popstate before history write; aborted/closed/current-controller guards before mutation and inside the updater; finally cleanup; deps fixed. |
| 5 | `CREATE_WIZARD_FLAG` alone changes fallback behavior (wizard-on+discovery-off) | **Adopted.** Single `WIZARD_ENABLED` constant gates every behavioral branch. |
| 6 | Commit steps violate AGENTS.md rule 7; `git add -A`; repo-wide format | **Adopted.** Executor never touches git; checkpoints only; Claude commits; prettier scoped to touched files. |
| 7 | Parent ramble flips arrival → premature settledEmpty | **Adopted.** Wizard-mode arrival inputs: perception-question count + parent-summary excluded. |
| 8 | artStyle merge clobbers fresh selection | **Adopted (gated).** `touched.artStyle` guard under `WIZARD_ENABLED`; flag-off keeps today's behavior byte-identically, pre-existing bug logged as follow-up. |
| 9 | Debouncer pending value survives a clear | **Adopted.** `livePatchFor` undefined-key cancel (verified `Object.assign` + `JSON.stringify` semantics). |
| 10 | Skip telemetry misses photo/star interactions | **Adopted.** Shell wraps onReorder/onPhotosChanged/onPickStar/onPickEveryone too. |
| 11 | step3_transition unobservable off step 3; double-fire on remount | **Adopted.** Moved to shell with session-level refs. |
| 12 | `hasPhotoCover={false}` wrong for resumed legacy drafts | **Adopted.** `coverAssetId !== null` plumbed through props. |
| 13 | React 18→19; readerSlow key naming; Task 9→12 cross-ref; “verbatim” StepWho claim | **Adopted.** All corrected; spec doc's copy-key list updated to `readerSlow` and its render-test line corrected to the Playwright pin. |
| 14 | Boundary tests should import constants; dedicated allowlist test | **Adopted.** |
| 15 | Missing integration-level tests (history sequences, re-read, extraction race) | **Adopted where the harness allows.** Pure hist-model + snapshot + livePatchFor tests added; the rest are explicit Task 14 QA cases (repo has no component render harness). |

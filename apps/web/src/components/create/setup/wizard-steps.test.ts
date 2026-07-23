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
  type WizardStepId,
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
    expect(skippedSteps(new Set<WizardStepId>([1, 2, 3, 4]), new Set<WizardStepId>([1, 3]))).toEqual(
      [2],
    );
  });
  it('unvisited steps are not skipped (never shown)', () => {
    expect(skippedSteps(new Set<WizardStepId>([1, 4]), new Set<WizardStepId>([1]))).toEqual([]);
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

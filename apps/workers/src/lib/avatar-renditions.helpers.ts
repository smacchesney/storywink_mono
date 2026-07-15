/**
 * Pure logic for the account-avatar rendition pipeline. Kept free of
 * cloudinary/sharp/openai/provider imports so it unit-tests without
 * infrastructure — orchestration lives in avatar-renditions.ts.
 */

/** The four rubric axes on SHEET_VALIDATION_RESPONSE_SCHEMA, in schema order. */
const SHEET_VALIDATION_AXES = [
  'sameCharacter',
  'allPanelsConsistent',
  'styleMatches',
  'noTextArtifacts',
] as const;

/** Cap on the raw text we keep for an unparseable verdict so a log line stays bounded. */
const UNPARSEABLE_NOTES_CAP = 300;

/** The log-shaped verdict: pass/fail plus which axes failed and the validator's notes. */
export interface SheetValidationVerdict {
  passed: boolean;
  failedAxes: string[];
  notes: string;
}

/**
 * Parse the sheet validator's `output_text` into a log-shaped verdict.
 *
 * The strict schema guarantees four axis booleans + `passed` + `notes`, but
 * this stays defensive: unparseable or non-object text fails CLOSED with a
 * single `'unparseable'` axis and the raw text (truncated) as notes, so a
 * malformed validator response still leaves a diagnosable trail rather than a
 * bare `passed:false`. `failedAxes` names only the axes explicitly marked
 * false, in schema order.
 */
export function parseSheetValidationVerdict(text: string): SheetValidationVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unparseable(text);
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return unparseable(text);
  }
  const verdict = parsed as Record<string, unknown>;
  const failedAxes = SHEET_VALIDATION_AXES.filter((axis) => verdict[axis] === false);
  return {
    passed: verdict.passed === true,
    failedAxes,
    notes: typeof verdict.notes === 'string' ? verdict.notes : '',
  };
}

function unparseable(text: string): SheetValidationVerdict {
  return {
    passed: false,
    failedAxes: ['unparseable'],
    notes: text.slice(0, UNPARSEABLE_NOTES_CAP),
  };
}

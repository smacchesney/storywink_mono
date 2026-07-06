import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_ESCALATION_MODEL,
  escalationModel,
  illustrationEscalationEnabled,
  providerNameForModel,
  shouldEscalate,
} from './escalation.js';

const ENV_KEYS = ['ILLUSTRATION_ESCALATION_ENABLED', 'ILLUSTRATION_ESCALATION_MODEL'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe('illustrationEscalationEnabled', () => {
  it('defaults OFF when the env var is unset', () => {
    expect(illustrationEscalationEnabled()).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    process.env.ILLUSTRATION_ESCALATION_ENABLED = 'true';
    expect(illustrationEscalationEnabled()).toBe(true);
    process.env.ILLUSTRATION_ESCALATION_ENABLED = '1';
    expect(illustrationEscalationEnabled()).toBe(false);
  });
});

describe('escalationModel', () => {
  it('defaults to gemini-3-pro-image', () => {
    expect(escalationModel()).toBe(DEFAULT_ESCALATION_MODEL);
    expect(DEFAULT_ESCALATION_MODEL).toBe('gemini-3-pro-image');
  });

  it('honors ILLUSTRATION_ESCALATION_MODEL', () => {
    process.env.ILLUSTRATION_ESCALATION_MODEL = 'gpt-image-2';
    expect(escalationModel()).toBe('gpt-image-2');
  });
});

describe('shouldEscalate', () => {
  it('escalates only the final round, and only when enabled', () => {
    // MAX_QC_ROUNDS is 2: round 1 is the ordinary re-render, round 2 is final.
    expect(shouldEscalate(1, 2, true)).toBe(false);
    expect(shouldEscalate(2, 2, true)).toBe(true);
    expect(shouldEscalate(2, 2, false)).toBe(false);
    expect(shouldEscalate(0, 2, true)).toBe(false);
  });
});

describe('providerNameForModel', () => {
  it('routes gpt-* ids to openai and everything else to gemini', () => {
    expect(providerNameForModel('gpt-image-2')).toBe('openai');
    expect(providerNameForModel('gemini-3-pro-image')).toBe('gemini');
    expect(providerNameForModel('gemini-3.1-flash-image')).toBe('gemini');
  });
});

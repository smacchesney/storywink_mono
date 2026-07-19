import { describe, it, expect } from 'vitest';
import { createDiscoveryEnabled } from './discovery';

describe('X17b server flag', () => {
  it('default OFF when unset', () => {
    expect(createDiscoveryEnabled({})).toBe(false);
  });
  it('only the exact string true enables', () => {
    expect(createDiscoveryEnabled({ CREATE_DISCOVERY_ENABLED: 'true' })).toBe(true);
    expect(createDiscoveryEnabled({ CREATE_DISCOVERY_ENABLED: 'TRUE' })).toBe(false);
    expect(createDiscoveryEnabled({ CREATE_DISCOVERY_ENABLED: '1' })).toBe(false);
  });
});

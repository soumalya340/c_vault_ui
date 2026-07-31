import { describe, it, expect } from 'vitest';
import { nextBackoff } from '@/hooks/use-vault-price';

describe('nextBackoff', () => {
  it('doubles the delay', () => {
    expect(nextBackoff(1000)).toBe(2000);
    expect(nextBackoff(2000)).toBe(4000);
  });

  it('caps at 30 seconds', () => {
    expect(nextBackoff(20000)).toBe(30000);
    expect(nextBackoff(30000)).toBe(30000);
  });
});

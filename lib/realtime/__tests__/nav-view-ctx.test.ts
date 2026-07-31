import { describe, it, expect } from 'vitest';
import { resolveNavViewCtx, getTotalNavViewWithCtx } from '@/lib/cvault';

describe('nav view context split', () => {
  it('exports resolveNavViewCtx and getTotalNavViewWithCtx', () => {
    expect(typeof resolveNavViewCtx).toBe('function');
    expect(typeof getTotalNavViewWithCtx).toBe('function');
  });

  it('getTotalNavViewWithCtx takes a pre-resolved context (arity ≥ 2 required)', () => {
    // Signature: (connection, resolved, vaultId?, wallet?) — defaults on the
    // last two mean Function.length reports only the required params.
    expect(getTotalNavViewWithCtx.length).toBeGreaterThanOrEqual(2);
  });
});

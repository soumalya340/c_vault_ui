import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createNavRoom, type RoomDeps } from '@/lib/realtime/nav-room';
import type { NavStreamMessage } from '@/lib/realtime/types';

type Trigger = (accountKey: string) => void;

function makeDeps(over: Partial<RoomDeps> = {}) {
  const subscribed: string[] = [];
  const unsubscribed: string[] = [];
  let fire: Trigger = () => {};
  let price = { sharePrice: '1000000000', totalNav: '5000000' };

  const deps: RoomDeps = {
    watchAccounts: async () => ['acctA', 'acctB', 'vaultPda'],
    subscribe: (keys, onChange) => {
      subscribed.push(...keys);
      fire = onChange;
      return () => unsubscribed.push(...keys);
    },
    computePrice: async () => ({
      sharePriceUsd: '$1.00',
      totalNavUsd: '$5.00',
      totalSharesUi: '5',
      sharePrice: price.sharePrice,
      totalNav: price.totalNav,
      slot: 1,
    }),
    vaultAccountKey: async () => 'vaultPda',
    ...over,
  };

  return {
    deps,
    subscribed,
    unsubscribed,
    trigger: (k = 'acctA') => fire(k),
    setPrice: (p: typeof price) => {
      price = p;
    },
  };
}

describe('createNavRoom', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends a snapshot to the joining client', async () => {
    const { deps } = makeDeps();
    const room = createNavRoom(1, deps);
    const seen: NavStreamMessage[] = [];
    room.join((m) => seen.push(m));
    await vi.runAllTimersAsync();

    expect(seen[0].type).toBe('snapshot');
    expect(seen[0]).toMatchObject({ vaultId: 1, sharePriceUsd: '$1.00', stale: false });
  });

  it('subscribes once for two clients', async () => {
    const { deps, subscribed } = makeDeps();
    const room = createNavRoom(1, deps);
    room.join(() => {});
    await vi.runAllTimersAsync();
    room.join(() => {});
    await vi.runAllTimersAsync();

    expect(subscribed).toEqual(['acctA', 'acctB', 'vaultPda']);
    expect(room.size()).toBe(2);
  });

  it('unsubscribes only when the last client leaves', async () => {
    const { deps, unsubscribed } = makeDeps();
    const room = createNavRoom(1, deps);
    const leaveA = room.join(() => {});
    await vi.runAllTimersAsync();
    const leaveB = room.join(() => {});
    await vi.runAllTimersAsync();

    leaveA();
    expect(unsubscribed).toHaveLength(0);
    leaveB();
    expect(unsubscribed).toEqual(['acctA', 'acctB', 'vaultPda']);
    expect(room.size()).toBe(0);
  });

  it('suppresses an update when the price is unchanged', async () => {
    const { deps, trigger } = makeDeps();
    const room = createNavRoom(1, deps);
    const seen: NavStreamMessage[] = [];
    room.join((m) => seen.push(m));
    await vi.runAllTimersAsync();

    trigger();
    await vi.runAllTimersAsync();
    expect(seen.filter((m) => m.type === 'update')).toHaveLength(0);
  });

  it('broadcasts an update when the price changes', async () => {
    const { deps, trigger, setPrice } = makeDeps();
    const room = createNavRoom(1, deps);
    const seen: NavStreamMessage[] = [];
    room.join((m) => seen.push(m));
    await vi.runAllTimersAsync();

    setPrice({ sharePrice: '1100000000', totalNav: '5500000' });
    trigger();
    await vi.runAllTimersAsync();

    const updates = seen.filter((m) => m.type === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ sharePrice: '1100000000' });
  });

  it('coalesces same-slot triggers into one recompute', async () => {
    const computePrice = vi.fn(async () => ({
      sharePriceUsd: '$1.00',
      totalNavUsd: '$5.00',
      totalSharesUi: '5',
      sharePrice: '1000000000',
      totalNav: '5000000',
      slot: 1,
    }));
    const { deps, trigger } = makeDeps({ computePrice });
    const room = createNavRoom(1, deps);
    room.join(() => {});
    await vi.runAllTimersAsync();
    expect(computePrice).toHaveBeenCalledTimes(1); // initial snapshot

    trigger('acctA');
    trigger('acctB');
    trigger('acctA');
    await vi.runAllTimersAsync();

    expect(computePrice).toHaveBeenCalledTimes(2); // three triggers → one recompute
  });

  it('keeps the last good price and marks stale when recompute fails', async () => {
    let fail = false;
    const computePrice = vi.fn(async () => {
      if (fail) throw new Error('rpc down');
      return {
        sharePriceUsd: '$1.00',
        totalNavUsd: '$5.00',
        totalSharesUi: '5',
        sharePrice: '1000000000',
        totalNav: '5000000',
        slot: 1,
      };
    });
    const { deps, trigger } = makeDeps({ computePrice });
    const room = createNavRoom(1, deps);
    const seen: NavStreamMessage[] = [];
    room.join((m) => seen.push(m));
    await vi.runAllTimersAsync();

    fail = true;
    trigger();
    await vi.runAllTimersAsync();

    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ stale: true, sharePrice: '1000000000' });
  });

  it('re-resolves context when the vault account itself changes', async () => {
    const watchAccounts = vi.fn(async () => ['acctA', 'vaultPda']);
    const { deps, trigger } = makeDeps({ watchAccounts });
    const room = createNavRoom(1, deps);
    room.join(() => {});
    await vi.runAllTimersAsync();
    expect(watchAccounts).toHaveBeenCalledTimes(1);

    trigger('vaultPda');
    await vi.runAllTimersAsync();
    expect(watchAccounts).toHaveBeenCalledTimes(2);
  });

  it('sends an error message when the initial resolve fails', async () => {
    const { deps } = makeDeps({
      watchAccounts: async () => {
        throw new Error('vault 99 not found');
      },
    });
    const room = createNavRoom(99, deps);
    const seen: NavStreamMessage[] = [];
    room.join((m) => seen.push(m));
    await vi.runAllTimersAsync();

    expect(seen[0]).toMatchObject({ type: 'error', vaultId: 99 });
  });
});

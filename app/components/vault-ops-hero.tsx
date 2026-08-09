'use client';

import { ConsoleHero } from './console-hero';

const CHIPS = [
  '3 instruments',
  'one instruction per control',
  'admin-approved registry',
] as const;

export function VaultOpsHero() {
  return (
    <ConsoleHero plate="02" title="Create" titleAccent="ETF" chips={CHIPS}>
      Create ETF vaults, execute basket swaps, and run the operational instruction set —{' '}
      <span className="text-foreground">
        every control below maps to exactly one on-chain instruction.
      </span>
    </ConsoleHero>
  );
}

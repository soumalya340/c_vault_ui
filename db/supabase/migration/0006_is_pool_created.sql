-- DAMM v2 shares×USDC pool flag (portfolio badge + gate Stake & Earn).
-- Same pattern as genesis_deposit_status: DB false → on-chain check → pin true.

alter table vaults
  add column if not exists is_pool_created boolean not null default false;

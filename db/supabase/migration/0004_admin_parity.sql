-- Admin dashboard parity: registry needs asset_name (already tracked in
-- SQLite, see c_vault_script/lib/db/schema.sql); vaults needs split ALT
-- columns (deposit/redeem) to match the CLI's SQLite shape instead of the
-- single legacy alt_address.

alter table pre_approved_token_registry
  add column if not exists asset_name text not null default '';

alter table vaults
  add column if not exists deposit_alt_address text,
  add column if not exists redeem_alt_address text;

-- Backfill: legacy alt_address was the deposit-side ALT.
update vaults
  set deposit_alt_address = alt_address
  where deposit_alt_address is null and alt_address is not null;

-- Live Supabase `vaults` schema (docs/Supabase_Info.md).
-- Off-chain index of on-chain ETF vaults for the c_vault_ui Vaults tab.
-- Quote mint is always network USDC (not stored). Full asset basket is read
-- on-chain; this table keeps identity + fees + asset id/weight snapshot.

create table if not exists vaults (
  vault_address text primary key,
  vault_id bigint not null,
  vault_authority text not null,
  shares_mint text not null,
  usdc_vault text not null,
  name text not null,
  symbol text not null,
  uri text not null,
  fee_recipient text not null,
  fund_type text not null check (fund_type in ('dynamic', 'fixed')),
  max_shares text,
  creator text not null,
  tx_signature text not null,
  network text not null default 'devnet',
  created_at timestamptz not null default now(),
  alt_address text,
  paused smallint not null default 0,
  admin_locked smallint not null default 0,
  vault_manager text not null,
  deposit_fee_bps integer not null default 0,
  redeem_fee_bps integer not null default 0,
  total_usdc_value text not null default '0',
  asset_ids bigint[] not null,
  asset_allocation_bps integer[] not null,
  num_assets smallint not null,
  -- Smart-contract genesis deposit flag: false until genesis_deposit succeeds.
  genesis_deposit_status boolean not null default false,
  unique (network, vault_id),
  unique (shares_mint)
);

-- Idempotent for DBs that already ran an older create table if not exists:
-- create table does not add new columns on re-run, so alter fills the gap.
alter table vaults
  add column if not exists genesis_deposit_status boolean not null default false;

create index if not exists vaults_network_created_at_idx
  on vaults (network, created_at desc);

create index if not exists vaults_creator_idx
  on vaults (creator);

alter table vaults enable row level security;

grant select, insert, update on table vaults to anon;

-- Idempotent: safe to re-run in Supabase SQL editor after a partial apply.
drop policy if exists "anon read vaults" on vaults;
drop policy if exists "anon insert vaults" on vaults;
drop policy if exists "anon update vaults" on vaults;

create policy "anon read vaults"
  on vaults for select
  to anon
  using (true);

create policy "anon insert vaults"
  on vaults for insert
  to anon
  with check (true);

create policy "anon update vaults"
  on vaults for update
  to anon
  using (true)
  with check (true);

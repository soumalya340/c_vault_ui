create table if not exists vaults (
  -- On-chain vault state PDA (etf_vault seed + vault_id). Primary key for UI
  -- lookups — same role as pool_address in orca_pools.
  vault_address text primary key,
  -- Sequential vault counter from GlobalState.total_vaults at creation time.
  vault_id bigint not null,
  -- PDAs derived from vault_id — stored so c_vault_ui can deposit/redeem without
  -- re-deriving client-side.
  vault_authority text not null,
  shares_mint text not null,
  usdc_vault text not null,
  base_mint text not null,
  -- Token-2022 share metadata (set inside create_etf in one instruction).
  name text not null,
  symbol text not null,
  uri text not null,
  fee_recipient text not null,
  performance_fee_bps integer not null,
  fund_type text not null check (fund_type in ('dynamic', 'fixed')),
  -- Raw u64 as text (same pattern as token_registry.daily_cap). Null for dynamic.
  max_shares text,
  -- Orca USDC/wSOL pool when any asset uses ViaSol route; null if all DirectUsdc.
  usdc_sol_pool text,
  -- Asset basket at creation. Each element:
  -- {
  --   "mint": "<base58>",
  --   "pool_address": "<base58>",
  --   "pyth_feed_id": "<64-char hex or empty string>",
  --   "allocation_bps": 3000,
  --   "decimals": 9,
  --   "route": "ViaSol" | "DirectUsdc"
  -- }
  -- Sum of allocation_bps must equal 10000 (validated on-chain).
  assets jsonb not null check (
    jsonb_typeof(assets) = 'array'
    and jsonb_array_length(assets) > 0
  ),
  creator text not null,
  tx_signature text not null,
  network text not null default 'devnet',
  created_at timestamptz not null default now(),
  unique (network, vault_id),
  unique (shares_mint)
);

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

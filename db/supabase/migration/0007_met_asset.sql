-- MET (Meteora) as asset preset + named registry row.
-- Pool: mainnet MET/USDC DAMM v2 (same as c_vault tests/integration/dev.test.ts).
-- Idempotent: safe to re-run in the Supabase SQL editor.

insert into asset_presets (
  preset_key, asset_name, mint, pool_address, pyth_feed_id, decimals,
  route, price_source_tag, price_dex_kind, swap_kind, token_program_tag, aliases
) values (
  'met',
  'MET',
  'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL',
  'BnztueWcXv93mgW7yJe8WYpnCxpz34nujPhfjQT6SLu1',
  '0000000000000000000000000000000000000000000000000000000000000000',
  6,
  'DirectUsdc',
  1,
  1,
  'DammV2',
  0,
  '["met","meteora","met-usdc","metusdc","met usdc","metcoin","met coin"]'::jsonb
) on conflict (preset_key) do update set
  asset_name = excluded.asset_name,
  mint = excluded.mint,
  pool_address = excluded.pool_address,
  pyth_feed_id = excluded.pyth_feed_id,
  decimals = excluded.decimals,
  route = excluded.route,
  price_source_tag = excluded.price_source_tag,
  price_dex_kind = excluded.price_dex_kind,
  swap_kind = excluded.swap_kind,
  token_program_tag = excluded.token_program_tag,
  aliases = excluded.aliases;

-- On-chain create_asset already listed MET as asset_id 9 with empty asset_name.
update pre_approved_token_registry
set asset_name = 'MET'
where mint = 'METvsvVRapdj9cFLzq4Tr43xK4tAjQfwX76z3n6mWQL'
  and (asset_name is null or asset_name = '');

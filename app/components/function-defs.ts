import { ADMIN_PUBKEY, SOL_USD_PYTH_FEED_ID_HEX, type Network } from '@/lib/cvault';
import { WSOL_USDC_POOL } from '@/lib/constants';

export type SectionId = 'view' | 'vaults' | 'vault-ops' | 'admin';

export interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'select' | 'usd';
  options?: { label: string; value: string }[];
  hint?: string;
  wide?: boolean;
  /**
   * Rendered next to the label as a small "i" mark; click reveals `info` as a
   * note beneath the field instead of a plain always-visible hint. Use for
   * detail that rewards a deliberate look (unit conversions, on-chain
   * mechanics) without cluttering the form by default.
   */
  info?: string;
  /**
   * Fixed value rendered read-only instead of an input — informational for
   * the admin; the executor reads the same constant itself. A record picks
   * the value per network.
   */
  fixed?: string | Record<Network, string>;
}

export function resolveFixedValue(field: FieldDef, network: Network): string | undefined {
  if (field.fixed === undefined) return undefined;
  return typeof field.fixed === 'string' ? field.fixed : field.fixed[network];
}

export interface FunctionDef {
  id: string;
  number: string;
  title: string;
  description: string;
  fields: FieldDef[];
  submitLabel: string;
}

// vault_id / asset_id fields render as registry-backed dropdowns (see
// accordion-item.tsx) — ids come from the DB, never hand-typed. The number
// input only appears as a fallback when the registry fetch fails.
const VAULT_ID_FIELD: FieldDef = {
  name: 'vault_id',
  label: 'Vault ID',
  type: 'number',
  placeholder: '0',
  hint: 'Loaded from the vault registry. 0-based on-chain id — first vault is 0.',
};

const ASSET_ID_FIELD: FieldDef = {
  name: 'asset_id',
  label: 'Asset ID',
  type: 'number',
  placeholder: '0',
  hint: 'Loaded from the asset registry. 0-based on-chain id — genesis wSOL is 0.',
};

const VIEW_VAULT_ID_FIELD: FieldDef = {
  ...VAULT_ID_FIELD,
  label: 'Vault',
  hint: 'Pick a vault from the registry.',
};

const VIEW_ASSET_ID_FIELD: FieldDef = {
  ...ASSET_ID_FIELD,
  label: 'Asset',
  hint: 'Pick an asset from the registry.',
};

export const VIEW_FUNCTIONS: FunctionDef[] = [
  {
    id: 'view_vault_state',
    number: '01',
    title: 'Vault State',
    description: 'Read a vault account: shares, TVL, pending balances, deposit/redeem fees, asset count.',
    fields: [VIEW_VAULT_ID_FIELD],
    submitLabel: 'Fetch vault',
  },
  {
    id: 'view_nav',
    number: '02',
    title: 'Live Nav & Share Price',
    description:
      'Calls get_total_nav_view. Asset ATAs and price sources (Pyth or DEX pool) are derived from the vault on-chain.',
    fields: [VIEW_VAULT_ID_FIELD],
    submitLabel: 'Get live NAV',
  },
  // My Position lives on Portfolio only (per-holding "My Position" button), not this View plate.
  {
    id: 'view_vault_asset_balances',
    number: '03',
    title: 'Vault Asset Balances',
    description:
      'Live token balance the vault holds for each asset — read from each asset ATA on-chain and shown in human-readable units.',
    fields: [VIEW_VAULT_ID_FIELD],
    submitLabel: 'Fetch asset balances',
  },
  {
    id: 'view_asset_state',
    number: '04',
    title: 'Asset State',
    description:
      'Read a single admin-listed AssetInfo account by asset id: mint, pools, price source, route, decimals, active flag.',
    fields: [VIEW_ASSET_ID_FIELD],
    submitLabel: 'Fetch asset',
  },
];

/** Vault Ops №01+ — every non-create vault operation comes from vault_ops.rs. */
export const VAULT_OPS_FUNCTIONS: FunctionDef[] = [
  {
    id: 'genesis_deposit',
    number: '01',
    title: 'Genesis deposit',
    description:
      'One-time seed: admin or vault-manager-only, callable once per vault while total_shares == 0. Deposits a fixed 1 USDC and reverse-prices shares to pin the opening share price, then deploys the seed across the vault’s asset basket in the same transaction. Vault must already exist (Create ETF) with vault asset ATAs resolvable. Address Lookup Table is required: reuses the vault ALT from the DB if live on-chain, otherwise creates a new ALT before signing, waits for activation, and saves deposit_alt + redeem_alt (and alt_address) to Supabase/SQLite. Genesis aborts if ALT create fails — no silent static-key fallback.',
    fields: [
      VAULT_ID_FIELD,
      {
        name: 'baseline_share_price',
        label: 'Opening share price',
        type: 'usd',
        placeholder: '1.00',
        info:
          'Stored on-chain as an integer in PRICE_SCALE units (1e9 per $1) — Solana programs can’t do floating-point math, so every price is a whole number of billionths of a dollar. $1.00 becomes 1,000,000,000. This is the price the first share is minted at; every later share price is computed from it. Valid range: $0.00001–$100,000.',
      },
    ],
    submitLabel: 'Genesis deposit',
  },
  {
    id: 'set_paused',
    number: '02',
    title: 'Set vault paused',
    description:
      'Vault-manager-only: pause or unpause deposits for a vault. Withdrawals always remain open.',
    fields: [
      VAULT_ID_FIELD,
      {
        name: 'paused',
        label: 'Paused',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
    ],
    submitLabel: 'Update pause',
  },
  {
    id: 'set_fee_recipient',
    number: '03',
    title: 'Set fee recipient',
    description: 'Vault-manager-only: update the fee recipient for a vault.',
    fields: [
      VAULT_ID_FIELD,
      { name: 'fee_recipient', label: 'Fee recipient', placeholder: ADMIN_PUBKEY.toBase58() },
    ],
    submitLabel: 'Update recipient',
  },
];

export const ADMIN_FUNCTIONS: FunctionDef[] = [
  {
    id: 'init_global_state',
    number: '01',
    title: 'Initialize global state',
    description:
      'One-time program setup: creates GlobalState and the genesis wSOL asset (id 0) in one transaction. Everything is fixed — wSOL mint, the USDC/wSOL Whirlpool below, Pyth SOL/USD pricing; treasury defaults to the admin signer. Just initialize.',
    fields: [
      {
        name: 'pool_address',
        label: 'USDC/wSOL Whirlpool pool',
        fixed: {
          localhost: WSOL_USDC_POOL.toBase58(),
          mainnet: WSOL_USDC_POOL.toBase58(),
        },
        wide: true,
        hint: 'Canonical USDC↔wSOL Orca Whirlpool — every ViaSol swap leg is validated against it on-chain. Same address on localhost and mainnet.',
      },
      {
        name: 'pyth_feed_id',
        label: 'Pyth feed ID (SOL/USD)',
        fixed: SOL_USD_PYTH_FEED_ID_HEX,
        wide: true,
        hint: 'The genesis asset is Pyth-priced. Same feed id on every cluster (pull oracle).',
      },
    ],
    submitLabel: 'Initialize',
  },
  {
    id: 'set_emergency',
    number: '02',
    title: 'Set emergency',
    description: 'Program-wide hard stop. Blocks new deposits until cleared.',
    fields: [
      {
        name: 'is_emergency',
        label: 'Emergency active',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
    ],
    submitLabel: 'Update emergency',
  },
  {
    id: 'update_treasury_addr',
    number: '03',
    title: 'Update treasury',
    description: 'Change the treasury address that receives platform fees.',
    fields: [{ name: 'treasury', label: 'Treasury address', placeholder: ADMIN_PUBKEY.toBase58() }],
    submitLabel: 'Update treasury',
  },
  {
    id: 'set_twap_keeper',
    number: '04',
    title: 'Set TWAP keeper',
    description: 'Wallet allowed to call update_dex_twap (Pubkey::default clears).',
    fields: [{ name: 'keeper', label: 'Keeper address', placeholder: ADMIN_PUBKEY.toBase58() }],
    submitLabel: 'Set keeper',
  },
  {
    id: 'create_asset',
    number: '05',
    title: 'Create asset',
    description:
      'List a new global asset. Pool address is verified live with the Orca Whirlpools SDK or Meteora DAMM v2 (CpAmm) SDK — pick DEX Type to match the pool. The pool must be this mint paired with wSOL (ViaSol) or network USDC (DirectUsdc).',
    fields: [
      {
        name: 'asset_name',
        label: 'Asset name',
        placeholder: 'e.g. Wrapped BTC',
        wide: true,
        hint: 'Display name stored in the registry. Free text — if you pick a preset (or paste a known mint), this is filled from the preset catalog.',
      },
      {
        name: 'mint',
        label: 'Mint',
        wide: true,
        hint: 'Token mint being listed. Must be one leg of the pool (with wSOL or USDC).',
      },
      {
        name: 'pool_address',
        label: 'Pool address',
        wide: true,
        hint: 'Whirlpool or DAMM v2 pool. ViaSol → mint/wSOL. DirectUsdc → mint/USDC. Verified via Orca / Meteora SDK before submit.',
      },
      {
        name: 'pyth_feed_id',
        label: 'Pyth feed ID (64-char hex, blank = zero feed)',
        placeholder: 'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
        wide: true,
      },
      {
        name: 'route',
        label: 'Route',
        type: 'select',
        options: [
          { label: 'ViaSol', value: 'viaSol' },
          { label: 'DirectUsdc', value: 'directUsdc' },
        ],
      },
      {
        name: 'price_source_tag',
        label: 'Price source',
        type: 'select',
        options: [
          { label: 'Pyth', value: '0' },
          { label: 'Dex', value: '1' },
        ],
      },
      {
        name: 'price_dex_kind',
        label: 'DEX Type',
        type: 'select',
        options: [
          { label: 'Whirlpool', value: '0' },
          { label: 'DammV2', value: '1' },
        ],
      },
      {
        name: 'token_program_tag',
        label: 'Token program',
        type: 'select',
        options: [
          { label: 'SPL Token', value: '0' },
          { label: 'Token-2022', value: '1' },
        ],
      },
    ],
    submitLabel: 'Create asset',
  },
  {
    id: 'set_asset_active',
    number: '06',
    title: 'Set asset active',
    description:
      'Flip an asset’s active flag. Inactive assets are rejected by new create_etf calls only — vaults already referencing the asset are unaffected.',
    fields: [
      ASSET_ID_FIELD,
      {
        name: 'active',
        label: 'Active',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
    ],
    submitLabel: 'Update asset flag',
  },
  {
    id: 'set_vault_emergency_lock',
    number: '07',
    title: 'Set vault emergency lock',
    description:
      'Lock or unlock deposits for one specific vault, independent of the vault manager’s own pause. Redemptions always remain open.',
    fields: [
      VAULT_ID_FIELD,
      {
        name: 'locked',
        label: 'Locked',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
    ],
    submitLabel: 'Update lock',
  },
  {
    id: 'update_dex_twap',
    number: '08',
    title: 'Update DEX TWAP',
    description:
      'Keeper-only: push a live price observation into TWAP for one DEX-priced asset. Rejected if the asset is Pyth-priced or the connected wallet isn’t the configured TWAP keeper.',
    fields: [
      ASSET_ID_FIELD,
      { name: 'twap_live_state', label: 'Live price (x64 fixed-point)', type: 'number', placeholder: '0' },
    ],
    submitLabel: 'Push TWAP observation',
  },
];

export const REQUIRES_WALLET = new Set([
  'set_paused',
  'set_fee_recipient',
  'set_vault_emergency_lock',
  'init_global_state',
  'set_emergency',
  'update_treasury_addr',
  'set_twap_keeper',
  'create_asset',
  'set_asset_active',
  'update_dex_twap',
]);

export const SECTION_STYLE: Record<SectionId, { accent: string; glow: string }> = {
  view: { accent: '#2E5C44', glow: 'rgba(46, 92, 68, 0.12)' },
  vaults: { accent: '#2E5C44', glow: 'rgba(46, 92, 68, 0.12)' },
  'vault-ops': { accent: '#A63A2B', glow: 'rgba(166, 58, 43, 0.12)' },
  admin: { accent: '#A63A2B', glow: 'rgba(166, 58, 43, 0.12)' },
};

import { ADMIN_PUBKEY, SOL_USD_PYTH_FEED_ID_HEX, type Network } from '@/lib/cvault';
import { WSOL_USDC_POOL } from '@/lib/constants';

export type SectionId = 'view' | 'vaults' | 'vault-ops' | 'admin';

export interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'select';
  options?: { label: string; value: string }[];
  hint?: string;
  wide?: boolean;
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

const VAULT_ID_FIELD: FieldDef = {
  name: 'vault_id',
  label: 'Vault ID',
  type: 'number',
  placeholder: '0',
  hint: '0-based on-chain id. First vault is 0. Valid range is 0 … totalVaults−1 (see Global state).',
};

const ASSET_ID_FIELD: FieldDef = {
  name: 'asset_id',
  label: 'Asset ID',
  type: 'number',
  placeholder: '0',
  hint: '0-based on-chain id. Genesis wSOL is 0. Valid range is 0 … totalAssets−1 (see Global state).',
};

export const VIEW_FUNCTIONS: FunctionDef[] = [
  {
    id: 'view_global_state',
    number: '01',
    title: 'Global state',
    description:
      'Read program-wide flags: emergency, treasury, TWAP keeper, total vaults, total listed assets.',
    fields: [],
    submitLabel: 'Fetch global state',
  },
  {
    id: 'view_vault_state',
    number: '02',
    title: 'Vault state',
    description: 'Read a vault account: shares, TVL, pending balances, deposit/redeem fees, asset count.',
    fields: [VAULT_ID_FIELD],
    submitLabel: 'Fetch vault',
  },
  {
    id: 'view_nav',
    number: '03',
    title: 'Live NAV and share price',
    description:
      'Calls get_total_nav_view. Asset ATAs and price sources (Pyth or DEX pool) are derived from the vault on-chain.',
    fields: [VAULT_ID_FIELD],
    submitLabel: 'Get live NAV',
  },
  {
    id: 'preview_deposit',
    number: '04',
    title: 'Preview deposit',
    description: 'Estimate shares minted for a USDC amount at current NAV.',
    fields: [
      VAULT_ID_FIELD,
      { name: 'usdc_amount', label: 'Amount (raw USDC units)', type: 'number', placeholder: '1000000' },
    ],
    submitLabel: 'Preview deposit',
  },
  {
    id: 'preview_redeem',
    number: '05',
    title: 'Preview redeem',
    description: 'Estimate per-asset amounts and USDC value for burning shares now.',
    fields: [
      VAULT_ID_FIELD,
      { name: 'shares', label: 'Shares to burn', type: 'number', placeholder: '1000' },
    ],
    submitLabel: 'Preview redeem',
  },
  {
    id: 'view_my_position',
    number: '06',
    title: 'My position',
    description: 'Your share balance, deposit history, and any active redeem state.',
    fields: [VAULT_ID_FIELD],
    submitLabel: 'Fetch my position',
  },
  {
    id: 'view_vault_asset_balances',
    number: '07',
    title: 'Vault asset balances',
    description:
      'Live token balance the vault holds for each asset — read from each asset ATA on-chain and shown in human-readable units.',
    fields: [VAULT_ID_FIELD],
    submitLabel: 'Fetch asset balances',
  },
  {
    id: 'view_asset_state',
    number: '08',
    title: 'Asset state',
    description:
      'Read a single admin-listed AssetInfo account by asset id: mint, pools, price source, route, decimals, active flag.',
    fields: [ASSET_ID_FIELD],
    submitLabel: 'Fetch asset',
  },
];

/** Vault Ops №02+ — every non-create vault operation comes from vault_ops.rs. */
export const VAULT_OPS_FUNCTIONS: FunctionDef[] = [
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

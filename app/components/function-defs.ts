import {
  ADMIN_PUBKEY,
  USDC_MINT,
  WBTC_MINT,
  WETH_MINT,
  WSOL_USDC_POOL,
  WSOL_WBTC_POOL,
} from '@/lib/cvault';

export type SectionId = 'view' | 'deposit' | 'redeem' | 'feeds' | 'admin';

export interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'select' | 'feed';
  options?: { label: string; value: string }[];
  hint?: string;
  wide?: boolean;
}

export interface FunctionDef {
  id: string;
  number: string;
  title: string;
  description: string;
  fields: FieldDef[];
  submitLabel: string;
}

export const VIEW_FUNCTIONS: FunctionDef[] = [
  {
    id: 'view_global_state',
    number: '01',
    title: 'Global state',
    description: 'Read program-wide flags: emergency, deposit disable, treasury, platform fee, vault count.',
    fields: [],
    submitLabel: 'Fetch global state',
  },
  {
    id: 'view_vault_state',
    number: '02',
    title: 'Vault state',
    description: 'Read vault 0 account: shares, TVL, pending balances, fees, cooldown, asset count.',
    fields: [],
    submitLabel: 'Fetch vault',
  },
  {
    id: 'view_nav',
    number: '03',
    title: 'Live NAV and share price',
    description: 'Calls get_total_nav_view. Requires SOL, BTC, and ETH Pyth feed accounts.',
    fields: [
      { name: 'sol_feed', label: 'SOL/USD feed', type: 'feed' },
      { name: 'btc_feed', label: 'BTC/USD feed', type: 'feed' },
      { name: 'eth_feed', label: 'ETH/USD feed', type: 'feed' },
    ],
    submitLabel: 'Get live NAV',
  },
  {
    id: 'preview_deposit',
    number: '04',
    title: 'Preview deposit',
    description: 'Estimate shares minted for a USDC amount at current NAV.',
    fields: [
      { name: 'usdc_amount', label: 'USDC amount (raw units)', type: 'number', placeholder: '1000000000' },
      { name: 'sol_feed', label: 'SOL/USD feed', type: 'feed' },
      { name: 'btc_feed', label: 'BTC/USD feed', type: 'feed' },
      { name: 'eth_feed', label: 'ETH/USD feed', type: 'feed' },
    ],
    submitLabel: 'Preview deposit',
  },
  {
    id: 'preview_redeem',
    number: '05',
    title: 'Preview redeem',
    description: 'Estimate per-asset amounts and USDC value for burning shares now.',
    fields: [
      { name: 'shares', label: 'Shares to burn', type: 'number', placeholder: '1000' },
      { name: 'sol_feed', label: 'SOL/USD feed', type: 'feed' },
      { name: 'btc_feed', label: 'BTC/USD feed', type: 'feed' },
      { name: 'eth_feed', label: 'ETH/USD feed', type: 'feed' },
    ],
    submitLabel: 'Preview redeem',
  },
  {
    id: 'view_my_position',
    number: '06',
    title: 'My position',
    description: 'Your share balance, deposit history, and any active redeem state.',
    fields: [],
    submitLabel: 'Fetch my position',
  },
];

export const DEPOSIT_FUNCTIONS: FunctionDef[] = [
  {
    id: 'deposit',
    number: '01',
    title: 'Deposit USDC',
    description: 'Transfer USDC in and mint shares at pre-swap NAV. Run deploy swaps separately afterward.',
    fields: [
      { name: 'usdc_amount', label: 'USDC amount (raw units)', type: 'number', placeholder: '1000000000' },
      { name: 'min_shares_out', label: 'Min shares out (0 = no slippage check)', type: 'number', placeholder: '0' },
      { name: 'sol_feed', label: 'SOL/USD feed', type: 'feed' },
      { name: 'btc_feed', label: 'BTC/USD feed', type: 'feed' },
      { name: 'eth_feed', label: 'ETH/USD feed', type: 'feed' },
    ],
    submitLabel: 'Deposit',
  },
  {
    id: 'ensure_atas',
    number: '02',
    title: 'Create token accounts',
    description: 'Create your USDC and share (Token-2022) ATAs if they do not exist.',
    fields: [],
    submitLabel: 'Create ATAs',
  },
  {
    id: 'swap_usdc_to_sol',
    number: '03',
    title: 'Deploy USDC to wSOL',
    description: 'Convert the ViaSol slice of pending USDC into wSOL.',
    fields: [{ name: 'min_wsol_out', label: 'Min wSOL out', type: 'number', placeholder: '0' }],
    submitLabel: 'Swap USDC to wSOL',
  },
  {
    id: 'swap_usdc_to_asset',
    number: '04',
    title: 'Deploy USDC to asset',
    description: 'Deploy pending USDC directly into a DirectUsdc-routed asset slot.',
    fields: [
      { name: 'asset_index', label: 'Asset index', type: 'number', placeholder: '0' },
      { name: 'pool_address', label: 'Pool address', placeholder: WSOL_WBTC_POOL.toBase58() },
      { name: 'asset_mint', label: 'Asset mint', placeholder: WBTC_MINT.toBase58() },
      { name: 'asset_ata', label: 'Vault asset ATA', placeholder: 'Derived vault token account' },
      { name: 'min_asset_out', label: 'Min asset out', type: 'number', placeholder: '0' },
    ],
    submitLabel: 'Swap USDC to asset',
  },
  {
    id: 'swap_sol_to_asset',
    number: '05',
    title: 'Deploy wSOL to asset',
    description: 'Deploy pending wSOL into a ViaSol-routed asset by slot index.',
    fields: [
      { name: 'asset_index', label: 'Asset index', type: 'number', placeholder: '1' },
      { name: 'pool_address', label: 'Pool address', placeholder: WSOL_WBTC_POOL.toBase58() },
      { name: 'asset_mint', label: 'Asset mint', placeholder: WBTC_MINT.toBase58() },
      { name: 'asset_ata', label: 'Vault asset ATA', placeholder: 'Derived vault token account' },
      { name: 'min_asset_out', label: 'Min asset out', type: 'number', placeholder: '0' },
    ],
    submitLabel: 'Swap wSOL to asset',
  },
];

export const REDEEM_FUNCTIONS: FunctionDef[] = [
  {
    id: 'request_redeem',
    number: '01',
    title: 'Request redeem',
    description: 'Burn shares, snapshot your asset slice, and start the cooldown timer.',
    fields: [
      { name: 'shares', label: 'Shares to redeem', type: 'number', placeholder: '500' },
      { name: 'sol_feed', label: 'SOL/USD feed', type: 'feed' },
      { name: 'btc_feed', label: 'BTC/USD feed', type: 'feed' },
      { name: 'eth_feed', label: 'ETH/USD feed', type: 'feed' },
    ],
    submitLabel: 'Request redeem',
  },
  {
    id: 'swap_asset_to_sol',
    number: '02',
    title: 'Redeem leg: asset to wSOL',
    description: 'First leg for ViaSol assets. Complete all asset legs before wSOL to USDC.',
    fields: [
      { name: 'user_address', label: 'Redeem owner', placeholder: 'Blank = connected wallet' },
      { name: 'asset_index', label: 'Asset index', type: 'number', placeholder: '1' },
      { name: 'pool_address', label: 'Pool address', placeholder: WSOL_WBTC_POOL.toBase58() },
      { name: 'asset_mint', label: 'Asset mint', placeholder: WBTC_MINT.toBase58() },
      { name: 'asset_ata', label: 'Vault asset ATA', placeholder: 'Derived vault token account' },
      { name: 'min_wsol_out', label: 'Min wSOL out', type: 'number', placeholder: '0' },
    ],
    submitLabel: 'Swap asset to wSOL',
  },
  {
    id: 'swap_sol_to_usdc',
    number: '03',
    title: 'Redeem leg: wSOL to USDC',
    description: 'Second ViaSol leg. Use the wSOL amount observed from the prior leg.',
    fields: [
      { name: 'user_address', label: 'Redeem owner', placeholder: 'Blank = connected wallet' },
      { name: 'asset_index', label: 'Asset index', type: 'number', placeholder: '1' },
      { name: 'wsol_amount', label: 'wSOL amount (raw units)', type: 'number', placeholder: '0' },
      { name: 'min_usdc_out', label: 'Min USDC out', type: 'number', placeholder: '0' },
    ],
    submitLabel: 'Swap wSOL to USDC',
  },
  {
    id: 'swap_asset_to_usdc',
    number: '04',
    title: 'Redeem leg: asset to USDC',
    description: 'Single-hop redeem for a DirectUsdc-routed asset.',
    fields: [
      { name: 'user_address', label: 'Redeem owner', placeholder: 'Blank = connected wallet' },
      { name: 'asset_index', label: 'Asset index', type: 'number', placeholder: '0' },
      { name: 'pool_address', label: 'Pool address', placeholder: WSOL_WBTC_POOL.toBase58() },
      { name: 'asset_mint', label: 'Asset mint', placeholder: WBTC_MINT.toBase58() },
      { name: 'asset_ata', label: 'Vault asset ATA', placeholder: 'Derived vault token account' },
      { name: 'min_usdc_out', label: 'Min USDC out', type: 'number', placeholder: '0' },
    ],
    submitLabel: 'Swap asset to USDC',
  },
  {
    id: 'claim',
    number: '05',
    title: 'Claim USDC',
    description: 'Send pending USDC to your wallet and close the redeem state account.',
    fields: [],
    submitLabel: 'Claim USDC',
  },
];

export const ADMIN_FUNCTIONS: FunctionDef[] = [
  {
    id: 'init_global_state',
    number: '01',
    title: 'Initialize global state',
    description: 'One-time program setup. Requires admin authority.',
    fields: [{ name: 'platform_fee_bps', label: 'Platform fee (BPS)', type: 'number', placeholder: '500' }],
    submitLabel: 'Initialize',
  },
  {
    id: 'add_eligible_base_mint',
    number: '02',
    title: 'Add eligible base mint',
    description: 'Allow a stable mint for vault base deposits.',
    fields: [{ name: 'mint', label: 'Mint address', placeholder: USDC_MINT.toBase58() }],
    submitLabel: 'Add mint',
  },
  {
    id: 'remove_eligible_base_mint',
    number: '03',
    title: 'Remove eligible base mint',
    description: 'Remove a mint from the eligible base allowlist.',
    fields: [{ name: 'mint', label: 'Mint address', placeholder: USDC_MINT.toBase58() }],
    submitLabel: 'Remove mint',
  },
  {
    id: 'create_etf',
    number: '04',
    title: 'Create ETF vault',
    description: 'Create a new vault at the next vault ID. Metadata is set in the same instruction.',
    fields: [
      { name: 'fee_recipient', label: 'Fee recipient', placeholder: ADMIN_PUBKEY.toBase58() },
      { name: 'performance_fee_bps', label: 'Performance fee (BPS)', type: 'number', placeholder: '1000' },
      { name: 'usdc_sol_pool', label: 'USDC/wSOL pool (blank if all DirectUsdc)', placeholder: WSOL_USDC_POOL.toBase58() },
      {
        name: 'assets_json',
        label: 'Assets (JSON array)',
        type: 'text',
        wide: true,
        hint: '[{"mint":"...","poolAddress":"...","pythFeedId":"hex64","allocationBps":3000,"decimals":9,"route":"ViaSol"}]',
      },
      {
        name: 'fund_type',
        label: 'Fund type',
        type: 'select',
        options: [
          { label: 'Dynamic', value: 'dynamic' },
          { label: 'Fixed', value: 'fixed' },
        ],
      },
      { name: 'max_shares', label: 'Max shares (fixed only, raw)', type: 'number', placeholder: '' },
      { name: 'name', label: 'Share name', placeholder: 'cVault Shares' },
      { name: 'symbol', label: 'Share symbol', placeholder: 'CVS' },
      { name: 'uri', label: 'Metadata URI', placeholder: 'https://...' },
    ],
    submitLabel: 'Create ETF',
  },
  {
    id: 'set_emergency',
    number: '05',
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
    id: 'set_deposit_disable',
    number: '06',
    title: 'Set deposit disable',
    description: 'Disable or re-enable deposits program-wide.',
    fields: [
      {
        name: 'disabled',
        label: 'Deposits disabled',
        type: 'select',
        options: [
          { label: 'true', value: 'true' },
          { label: 'false', value: 'false' },
        ],
      },
    ],
    submitLabel: 'Update deposit flag',
  },
  {
    id: 'set_paused',
    number: '07',
    title: 'Set vault paused',
    description: 'Pause or unpause deposits for vault 0.',
    fields: [
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
  { id: 'resume', number: '08', title: 'Resume vault', description: 'Clear vault-level pause after emergency handling.', fields: [], submitLabel: 'Resume vault' },
  {
    id: 'set_redeem_cooldown',
    number: '09',
    title: 'Set redeem cooldown',
    description: 'Change redeem cooldown in seconds (0–604800).',
    fields: [{ name: 'cooldown_secs', label: 'Cooldown seconds', type: 'number', placeholder: '86400' }],
    submitLabel: 'Update cooldown',
  },
  {
    id: 'set_fee_recipient',
    number: '10',
    title: 'Set fee recipient',
    description: 'Update the performance fee recipient for vault 0.',
    fields: [{ name: 'fee_recipient', label: 'Fee recipient', placeholder: ADMIN_PUBKEY.toBase58() }],
    submitLabel: 'Update recipient',
  },
  {
    id: 'update_platform_fee_bps',
    number: '11',
    title: 'Update platform fee',
    description: 'Change the program-wide platform fee in basis points.',
    fields: [{ name: 'platform_fee_bps', label: 'Platform fee (BPS)', type: 'number', placeholder: '500' }],
    submitLabel: 'Update platform fee',
  },
  {
    id: 'update_treasury_addr',
    number: '12',
    title: 'Update treasury',
    description: 'Change the treasury address that receives platform fees.',
    fields: [{ name: 'treasury', label: 'Treasury address', placeholder: ADMIN_PUBKEY.toBase58() }],
    submitLabel: 'Update treasury',
  },
];

export const REQUIRES_WALLET = new Set([
  'deposit', 'ensure_atas', 'swap_usdc_to_sol', 'swap_usdc_to_asset', 'swap_sol_to_asset',
  'request_redeem', 'swap_asset_to_sol', 'swap_sol_to_usdc', 'swap_asset_to_usdc', 'claim',
  'init_global_state', 'add_eligible_base_mint', 'remove_eligible_base_mint', 'create_etf',
  'set_emergency', 'set_deposit_disable', 'set_paused', 'resume', 'set_redeem_cooldown',
  'set_fee_recipient', 'update_platform_fee_bps', 'update_treasury_addr',
]);

export const SECTION_STYLE: Record<SectionId, { accent: string; glow: string }> = {
  view: { accent: '#2E5C44', glow: 'rgba(46, 92, 68, 0.12)' },
  deposit: { accent: '#2E5C44', glow: 'rgba(46, 92, 68, 0.12)' },
  redeem: { accent: '#A63A2B', glow: 'rgba(166, 58, 43, 0.12)' },
  feeds: { accent: '#2E5C44', glow: 'rgba(46, 92, 68, 0.12)' },
  admin: { accent: '#A63A2B', glow: 'rgba(166, 58, 43, 0.12)' },
};

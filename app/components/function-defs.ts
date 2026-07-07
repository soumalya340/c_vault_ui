import { ADMIN_PUBKEY, USDC_MINT } from '@/lib/cvault';

export type SectionId = 'view' | 'vaults' | 'vault-ops' | 'admin';

export interface FieldDef {
  name: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'select';
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

const VAULT_ID_FIELD: FieldDef = {
  name: 'vault_id',
  label: 'Vault ID',
  type: 'number',
  placeholder: '0',
};

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
    description: 'Read a vault account: shares, TVL, pending balances, fees, cooldown, asset count.',
    fields: [VAULT_ID_FIELD],
    submitLabel: 'Fetch vault',
  },
  {
    id: 'view_nav',
    number: '03',
    title: 'Live NAV and share price',
    description: 'Calls get_total_nav_view. Asset accounts and price feeds are derived from the vault on-chain.',
    fields: [VAULT_ID_FIELD],
    submitLabel: 'Get live NAV',
  },
  {
    id: 'preview_deposit',
    number: '04',
    title: 'Preview deposit',
    description: 'Estimate shares minted for a base-token amount at current NAV.',
    fields: [
      VAULT_ID_FIELD,
      { name: 'usdc_amount', label: 'Amount (raw base units)', type: 'number', placeholder: '1000000000' },
    ],
    submitLabel: 'Preview deposit',
  },
  {
    id: 'preview_redeem',
    number: '05',
    title: 'Preview redeem',
    description: 'Estimate per-asset amounts and base-token value for burning shares now.',
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
];

/** Vault Ops №02+ — every non-create vault operation comes from vault_ops.rs. */
export const VAULT_OPS_FUNCTIONS: FunctionDef[] = [
  {
    id: 'set_paused',
    number: '02',
    title: 'Set vault paused',
    description: 'Pause or unpause deposits for a vault. Withdrawals always remain open.',
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
    id: 'resume',
    number: '03',
    title: 'Resume vault',
    description: 'Clear vault-level pause and reset the rolling high-price window.',
    fields: [VAULT_ID_FIELD],
    submitLabel: 'Resume vault',
  },
  {
    id: 'set_redeem_cooldown',
    number: '04',
    title: 'Set redeem cooldown',
    description: 'Change redeem cooldown in seconds (0–604800). Applies to future redeems only.',
    fields: [
      VAULT_ID_FIELD,
      { name: 'cooldown_secs', label: 'Cooldown seconds', type: 'number', placeholder: '86400' },
    ],
    submitLabel: 'Update cooldown',
  },
  {
    id: 'set_fee_recipient',
    number: '05',
    title: 'Set fee recipient',
    description: 'Update the performance fee recipient for a vault.',
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
    id: 'set_emergency',
    number: '04',
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
    number: '05',
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
    id: 'update_platform_fee_bps',
    number: '06',
    title: 'Update platform fee',
    description: 'Change the program-wide platform fee in basis points.',
    fields: [{ name: 'platform_fee_bps', label: 'Platform fee (BPS)', type: 'number', placeholder: '500' }],
    submitLabel: 'Update platform fee',
  },
  {
    id: 'update_treasury_addr',
    number: '07',
    title: 'Update treasury',
    description: 'Change the treasury address that receives platform fees.',
    fields: [{ name: 'treasury', label: 'Treasury address', placeholder: ADMIN_PUBKEY.toBase58() }],
    submitLabel: 'Update treasury',
  },
];

export const REQUIRES_WALLET = new Set([
  'set_paused', 'resume', 'set_redeem_cooldown', 'set_fee_recipient',
  'init_global_state', 'add_eligible_base_mint', 'remove_eligible_base_mint',
  'set_emergency', 'set_deposit_disable', 'update_platform_fee_bps', 'update_treasury_addr',
]);

export const SECTION_STYLE: Record<SectionId, { accent: string; glow: string }> = {
  view: { accent: '#2E5C44', glow: 'rgba(46, 92, 68, 0.12)' },
  vaults: { accent: '#2E5C44', glow: 'rgba(46, 92, 68, 0.12)' },
  'vault-ops': { accent: '#A63A2B', glow: 'rgba(166, 58, 43, 0.12)' },
  admin: { accent: '#A63A2B', glow: 'rgba(166, 58, 43, 0.12)' },
};

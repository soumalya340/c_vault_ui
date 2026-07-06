import { PublicKey } from '@solana/web3.js';

export const C_VAULT_PROGRAM_ID = new PublicKey(
  '2YW9wGokqo321EtDNWWH2CSQxFiJz3uMoNxa9dgbHn2P',
);

export const ADMIN_PUBKEY = new PublicKey(
  'cyaibXfQvCC4qKDYNguU4mXryhKjSkszPWkd56KFkrF',
);

export const DEFAULT_VAULT_ID = 0;

export const GLOBAL_STATE_SEED = Buffer.from('global_state');
export const VAULT_SEED = Buffer.from('etf_vault');
export const VAULT_AUTHORITY_SEED = Buffer.from('vault_authority');
export const SHARES_MINT_SEED = Buffer.from('shares_mint');
export const USDC_VAULT_SEED = Buffer.from('usdc_vault');
export const USER_INFO_SEED = Buffer.from('user_info');
export const REDEEM_SEED = Buffer.from('redeem');

export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const WBTC_MINT = new PublicKey('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh');
export const WETH_MINT = new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs');

export const USDC_DECIMALS = 6;
export const WSOL_DECIMALS = 9;
export const WBTC_DECIMALS = 8;
export const WETH_DECIMALS = 8;

export const WHIRLPOOL_PROGRAM_ID = new PublicKey(
  'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
);

export const WSOL_USDC_POOL = new PublicKey('Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE');
export const WSOL_WBTC_POOL = new PublicKey('B5EwJVDuAauzUEEdwvbuXzbFFgEYnUqqS37TUM1c4PQA');
export const WSOL_WETH_POOL = new PublicKey('HktfL7iwGKT5QHjywQkcDnZXScoh811k7akrMZJkCcEF');

export const PYTH_RECEIVER_PROGRAM_ID = new PublicKey(
  'rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ',
);

export const PYTH_SOL_USD_FEED_ID =
  'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d';
export const PYTH_BTC_USD_FEED_ID =
  'e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43';
export const PYTH_ETH_USD_FEED_ID =
  'ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace';

export const PRICE_SCALE = 1_000_000_000;

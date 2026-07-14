/**
 * Turn raw Solana / Anchor / SPL simulation failures into copy a human can act on.
 *
 * Design voice (Design.md §7): state what happened and what to do — no apology,
 * no jokes near a transaction. Certificate chrome lives in the modal, not here.
 */

export type UserFacingKind = 'error' | 'info' | 'warning';

export interface UserFacingError {
  kind: UserFacingKind;
  /** Short modal title (sentence case). */
  title: string;
  /** One or two sentences: what failed. */
  summary: string;
  /** Concrete next step(s). */
  fix?: string;
  /** Instruction name from logs, e.g. GenesisDeposit. */
  instruction?: string;
  /** Program / token error label, e.g. InsufficientFunds · 0x1. */
  code?: string;
  /** Full technical blob for the collapsible log. */
  details?: string;
  /** Original message (always set). */
  raw: string;
}

/**
 * TWAP recovery UX (Refresh Asset button).
 * 6050 keeper unset · 6051 wrong keeper · 6052 dual-stale · message fallbacks.
 */
export function isTwapRefreshableError(error: UserFacingError | null | undefined): boolean {
  if (!error) return false;
  const codeNum = Number(String(error.code ?? '').replace(/[^\d]/g, '') || NaN);
  if (codeNum === 6050 || codeNum === 6051 || codeNum === 6052) return true;
  // code may be "LivePriceDiscrepancy · 0x17a4" style
  if (/\b6050\b|\b6051\b|\b6052\b|0x17a[234]/i.test(String(error.code ?? ''))) return true;
  const blob = `${error.title}\n${error.summary}\n${error.fix ?? ''}\n${error.details ?? ''}\n${error.raw}`;
  return /TwapKeeperNotSet|UnauthorizedTwapKeeper|LivePriceDiscrepancy|Live price discrepancy|both stale|TWAP observation|No TWAP keeper|TWAP keeper|update_dex_twap|Update Dex Twap|DEX TWAP is stale|past freshness window|Refresh Price in the error/i.test(
    blob,
  );
}

/** @deprecated use isTwapRefreshableError */
export function isLivePriceDiscrepancyError(error: UserFacingError | null | undefined): boolean {
  return isTwapRefreshableError(error);
}

/** Anchor `#[error_code]` codes start at 6000; keep in sync with vault errors.rs. */
const ANCHOR_ERRORS: Record<
  number,
  { name: string; title: string; summary: string; fix?: string }
> = {
  6000: {
    name: 'ZeroAmount',
    title: 'Amount must be greater than zero',
    summary: 'The program rejected a zero amount.',
    fix: 'Enter a positive amount and try again.',
  },
  6001: {
    name: 'Unauthorized',
    title: 'Not authorized',
    summary: 'This wallet is not allowed to run this instruction.',
    fix: 'Connect as the vault manager or the admin, then retry.',
  },
  6002: {
    name: 'UnauthorizedAdmin',
    title: 'Admin only',
    summary: 'Only the protocol admin can run this instruction.',
    fix: 'Connect the admin wallet and try again.',
  },
  6003: {
    name: 'VaultPaused',
    title: 'Vault is paused',
    summary: 'Deposits are paused for this vault.',
    fix: 'Wait for the vault manager to unpause, or use redeem if you need to exit.',
  },
  6004: {
    name: 'VaultAdminLocked',
    title: 'Vault locked by admin',
    summary: 'This vault is under an admin emergency lock.',
    fix: 'Contact the protocol admin. Only withdrawals may remain available.',
  },
  6005: {
    name: 'GenesisNotSeeded',
    title: 'Vault not seeded yet',
    summary: 'This vault has no shares — genesis deposit has not run.',
    fix: 'Run Genesis deposit (admin or vault manager) before normal deposits.',
  },
  6006: {
    name: 'GenesisAlreadySeeded',
    title: 'Genesis already done',
    summary: 'This vault already has shares from a prior genesis seed.',
    fix: 'Use Deposit instead of Genesis deposit.',
  },
  6007: {
    name: 'InvalidBaselineSharePrice',
    title: 'Opening price out of range',
    summary: 'baseline_share_price must be between $0.00001 and $100,000.',
    fix: 'Pick an opening share price inside that range (e.g. 1.00).',
  },
  6008: {
    name: 'EmergencyMode',
    title: 'Emergency mode active',
    summary: 'The protocol is in emergency mode — only withdrawals are allowed.',
    fix: 'Wait for admin to clear emergency mode, or redeem if you hold shares.',
  },
  6009: {
    name: 'NotInEmergency',
    title: 'Not in emergency mode',
    summary: 'That action only works while emergency mode is on.',
  },
  6010: {
    name: 'InsufficientShares',
    title: 'Not enough shares',
    summary: 'You tried to redeem more shares than this wallet holds.',
    fix: 'Lower the share amount to your balance and retry.',
  },
  6011: {
    name: 'StaleOracle',
    title: 'Oracle price is stale',
    summary: 'A Pyth (or related) price feed is too old for a safe NAV.',
    fix: 'On localhost/Surfpool, retry once (feeds auto-refresh). On mainnet, wait a moment and try again.',
  },
  6012: {
    name: 'InvalidOraclePrice',
    title: 'Invalid oracle price',
    summary: 'An oracle reported zero or a negative price.',
    fix: 'Retry shortly. If it persists on localhost, refresh Surfpool Pyth accounts.',
  },
  6013: {
    name: 'InvalidOracleOwner',
    title: 'Bad oracle account',
    summary: 'A price account is not owned by the expected Pyth program.',
    fix: 'Check the asset’s price feed id and that you are on the correct network.',
  },
  6014: {
    name: 'SlippageExceeded',
    title: 'Slippage too high',
    summary: 'The swap moved past your min-out tolerance.',
    fix: 'Retry with a slightly lower min-out, or wait for a quieter market.',
  },
  6015: {
    name: 'CpiFailure',
    title: 'External program call failed',
    summary: 'A swap or token CPI into another program failed.',
    fix: 'Open technical details below. Often pool liquidity, clock, or account wiring.',
  },
  6016: {
    name: 'InsufficientWsolBalance',
    title: 'Not enough wSOL in the vault',
    summary: 'The vault’s wSOL balance cannot cover the required swap legs.',
    fix: 'Deploy pending USDC→wSOL first, or deposit more before this swap path.',
  },
  6017: {
    name: 'InvalidMint',
    title: 'Wrong token mint',
    summary: 'A token account’s mint does not match what the vault expects.',
    fix: 'Confirm the UI network matches the vault (localhost vs mainnet USDC).',
  },
  6018: {
    name: 'AccountNotInitialized',
    title: 'Token account missing',
    summary: 'A required token account is not initialized.',
    fix: 'Retry — the UI creates missing vault ATAs. Ensure the wallet has SOL for rent.',
  },
  6019: {
    name: 'IncorrectOwner',
    title: 'Wrong token account owner',
    summary: 'A token account is not owned by the expected authority.',
  },
  6020: {
    name: 'InvalidAccountsLength',
    title: 'Wrong number of accounts',
    summary: 'remaining_accounts length does not match the vault’s asset count.',
    fix: 'Refresh the page and retry. If it persists, re-sync the vault registry.',
  },
  6021: {
    name: 'MismatchedAccount',
    title: 'Unexpected account',
    summary: 'An account in the transaction does not match the vault’s stored ATA.',
  },
  6022: {
    name: 'MathOverflow',
    title: 'Math overflow',
    summary: 'An on-chain calculation overflowed.',
    fix: 'Try a smaller amount. Report this if it happens on a normal size.',
  },
  6023: {
    name: 'FeeTooHigh',
    title: 'Deposit fee too high',
    summary: 'Deposit fee cannot exceed 6% (600 bps).',
  },
  6024: {
    name: 'InvalidRedeemFee',
    title: 'Invalid redeem fee',
    summary: 'Redeem fee must be between 0.5% and 10%.',
  },
  6025: {
    name: 'TooEarlyRedeem',
    title: 'Redeem cooldown still active',
    summary: 'You cannot claim yet — the unlock time has not passed.',
    fix: 'Wait until the unlock time shown in the redeem panel, then claim.',
  },
  6026: {
    name: 'InvalidDuration',
    title: 'Invalid duration',
    summary: 'Duration must be between 0 and 7 days.',
  },
  6027: {
    name: 'NothingToClaim',
    title: 'Nothing to claim',
    summary: 'No USDC is pending for this redeem.',
    fix: 'Finish outflow swaps first, then press Claim.',
  },
  6028: {
    name: 'RedeemAlreadyPending',
    title: 'Redeem already open',
    summary: 'This wallet already has a pending redeem on this vault.',
    fix: 'Finish or claim the existing redeem before starting another.',
  },
  6029: {
    name: 'InvalidAllocation',
    title: 'Allocation must total 100%',
    summary: 'Asset allocation BPS must sum to exactly 10,000.',
    fix: 'Adjust weights so they add to 100% and recreate / update the vault.',
  },
  6030: {
    name: 'TooManyAssets',
    title: 'Too many assets',
    summary: 'The vault exceeds the maximum asset slots.',
  },
  6031: {
    name: 'NoAssets',
    title: 'No assets',
    summary: 'The asset list must contain at least one asset.',
  },
  6032: {
    name: 'InvalidVaultId',
    title: 'Wrong vault id',
    summary: 'vault_id must equal the next sequential id (global_state.total_vaults).',
    fix: 'Refresh vaults and use the next free vault id.',
  },
  6033: {
    name: 'MissingUsdcSolPool',
    title: 'Missing USDC/SOL pool',
    summary: 'ViaSol assets require a USDC↔wSOL pool.',
  },
  6034: {
    name: 'AssetAlreadySwapped',
    title: 'Asset already swapped',
    summary: 'This redeem slot was already swapped in the current flow.',
  },
  6035: {
    name: 'AssetInactive',
    title: 'Asset is inactive',
    summary: 'A referenced asset exists but has been deactivated by admin.',
    fix: 'Reactivate the asset or use a vault that does not include it.',
  },
  6040: {
    name: 'ShareCapExceeded',
    title: 'Share cap exceeded',
    summary: 'This deposit would mint past the Fixed vault’s max_shares cap.',
    fix: 'Deposit a smaller amount, or use a Dynamic vault.',
  },
  6041: {
    name: 'QuoteMintNotEligible',
    title: 'Wrong USDC mint',
    summary: 'usdc_mint must be the program’s canonical USDC mint for this cluster.',
    fix: 'Switch the UI network to match the vault (localhost uses mainnet USDC mint).',
  },
  6047: {
    name: 'TwapWindowTooShort',
    title: 'TWAP history too short',
    summary: 'There is not enough TWAP history to mint or redeem against this asset yet.',
    fix: 'Wait for keepers to record more observations, then retry.',
  },
  6050: {
    name: 'TwapKeeperNotSet',
    title: 'TWAP keeper not set',
    summary: 'No TWAP keeper is assigned on global_state yet.',
    fix: 'Click Refresh Price (admin assigns the canonical keeper, then refreshes spots).',
  },
  6051: {
    name: 'UnauthorizedTwapKeeper',
    title: 'Unauthorized TWAP keeper',
    summary: 'The signer is not the assigned TWAP keeper.',
    fix: 'Click Refresh Price to use the server keeper cosign, or re-set twap_keeper via admin.',
  },
  6052: {
    name: 'LivePriceDiscrepancy',
    title: 'Live price unreliable',
    summary: 'TWAP observation and keeper stamp are both too stale.',
    fix: 'Click Refresh Price — you pay one multi-ix tx; the keeper cosigns.',
  },
  6053: {
    name: 'NotDexPricedAsset',
    title: 'Not a DEX-priced asset',
    summary: 'update_dex_twap only applies to DEX-priced AssetInfo slots.',
  },
  6054: {
    name: 'InvalidPoolPair',
    title: 'Invalid pool pair',
    summary: 'The pool must include USDC or wSOL as one side of the pair.',
  },
};

/** SPL Token custom codes (Tokenkeg / common). */
const SPL_TOKEN_ERRORS: Record<number, { name: string; title: string; summary: string; fix?: string }> = {
  0x0: {
    name: 'NotRentExempt',
    title: 'Account not rent-exempt',
    summary: 'A token account does not hold enough SOL for rent exemption.',
    fix: 'Fund the wallet with a little more SOL and retry.',
  },
  0x1: {
    name: 'InsufficientFunds',
    title: 'Insufficient token balance',
    summary: 'A token transfer failed because the source account does not hold enough tokens.',
    fix: 'For genesis deposit you need at least 1 USDC in this wallet. On localhost, airdrop USDC via the c_vault_script menu (or surfnet_setTokenAccount), then retry.',
  },
  0x2: {
    name: 'InvalidMint',
    title: 'Invalid mint',
    summary: 'Token account mint does not match the expected mint.',
  },
  0x3: {
    name: 'MintMismatch',
    title: 'Mint mismatch',
    summary: 'The mint on the token account does not match the instruction mint.',
  },
  0x4: {
    name: 'OwnerMismatch',
    title: 'Token owner mismatch',
    summary: 'The wallet is not the authority of the token account being used.',
    fix: 'Connect the wallet that owns the USDC (or shares) account.',
  },
};

function collectBlob(err: unknown): string {
  const e = err as {
    message?: string;
    logs?: string[];
    simulationResponse?: { logs?: string[]; err?: unknown };
    getLogs?: () => Promise<string[]> | string[];
  } | null;

  const parts: string[] = [];
  if (err instanceof Error) parts.push(err.message);
  else if (err != null) parts.push(String(err));

  const sim = e?.simulationResponse;
  if (Array.isArray(sim?.logs)) parts.push(sim!.logs!.join('\n'));
  if (Array.isArray(e?.logs)) parts.push(e!.logs!.join('\n'));
  if (sim?.err != null) parts.push(JSON.stringify(sim.err));

  // Nested cause (common with wallet adapters).
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  if (cause) parts.push(collectBlob(cause));

  return parts.filter(Boolean).join('\n');
}

function extractInstruction(blob: string): string | undefined {
  const m =
    blob.match(/Instruction:\s*([A-Za-z0-9_]+)/) ||
    blob.match(/Program log:\s*Instruction:\s*([A-Za-z0-9_]+)/);
  return m?.[1];
}

function extractCustomHex(blob: string): number | undefined {
  const m = blob.match(/custom program error:\s*(0x[0-9a-fA-F]+)/i);
  if (m) return parseInt(m[1], 16);
  const dec = blob.match(/custom program error:\s*(\d+)/i);
  if (dec) return Number(dec[1]);
  return undefined;
}

function extractAnchorCode(blob: string): number | undefined {
  const named = blob.match(/Error Code:\s*([A-Za-z0-9_]+)\.\s*Error Number:\s*(\d+)/i);
  if (named) return Number(named[2]);
  const num = blob.match(/Error Number:\s*(\d+)/i);
  if (num) return Number(num[1]);
  const hex = blob.match(/\b0x(17[0-9a-f]{2})\b/i); // 6000–6127ish
  if (hex) return parseInt(hex[1], 16);
  return undefined;
}

function isUserRejection(blob: string): boolean {
  return /user rejected|rejected the request|transaction cancelled|user denied|denied transaction signature/i.test(
    blob,
  );
}

function instructionHint(ix?: string): string | undefined {
  if (!ix) return undefined;
  const map: Record<string, string> = {
    GenesisDeposit: 'Genesis deposit',
    Deposit: 'Deposit',
    RequestRedeem: 'Redeem request',
    Claim: 'Claim',
    CreateEtf: 'Create ETF',
    CreateAsset: 'Create asset',
    SwapUsdcToSol: 'USDC → wSOL swap',
    SwapSolToAsset: 'wSOL → asset swap',
    SwapUsdcToAsset: 'USDC → asset swap',
    SwapAssetToSol: 'Asset → wSOL swap',
    SwapAssetToUsdc: 'Asset → USDC swap',
    SwapSolToUsdc: 'wSOL → USDC swap',
  };
  return map[ix] ?? ix.replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Parse any thrown value from send / simulate / Anchor view into a structured,
 * human-readable error.
 */
export function parseTxError(err: unknown): UserFacingError {
  const raw = err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const blob = collectBlob(err);
  const instruction = extractInstruction(blob);
  const ixLabel = instructionHint(instruction);
  const details = blob.length > raw.length ? blob : raw;

  // describePreviewError / legacy wraps — still surface Refresh Price in the modal.
  if (/DEX TWAP is stale/i.test(raw)) {
    const a = ANCHOR_ERRORS[6052];
    return {
      kind: 'error',
      title: a.title,
      summary: a.summary,
      fix: a.fix,
      instruction: ixLabel,
      code: `${a.name} · 6052`,
      details,
      raw,
    };
  }

  if (isUserRejection(blob) || isUserRejection(raw)) {
    return {
      kind: 'info',
      title: 'Transaction cancelled',
      summary: 'You declined the wallet signature request. Nothing was sent.',
      fix: 'Open the form again and approve in your wallet when you are ready.',
      instruction: ixLabel,
      raw,
    };
  }

  // Explicit crafted messages (FieldError text, preflight helpers) — keep summary,
  // but still present cleanly if they look like prose.
  if (/Missing on-chain accounts for/i.test(raw)) {
    return {
      kind: 'error',
      title: 'Missing on-chain accounts',
      summary: raw.split('\n')[0] ?? raw,
      fix: 'Connect a wallet and retry so missing ATAs can be created. On localhost, confirm the validator is running.',
      details,
      raw,
    };
  }

  // Program not deployed
  if (/Program is not deployed|Unsupported program id/i.test(blob)) {
    return {
      kind: 'error',
      title: 'Program not on this cluster',
      summary: 'The c_vault program is not deployed (or not visible) on the RPC you are using.',
      fix: 'On localhost: deploy the program to Surfpool/validator. On mainnet: switch the UI network to match your wallet and confirm the program id.',
      details,
      raw,
    };
  }

  // Blockhash / dropped
  if (/blockhash not found|BlockhashNotFound|Transaction was not confirmed|expired/i.test(blob)) {
    return {
      kind: 'warning',
      title: 'Transaction expired',
      summary: 'The network did not confirm this transaction before the blockhash expired.',
      fix: 'Retry the action. If this keeps happening, switch RPC or wait for lower congestion.',
      details,
      raw,
    };
  }

  // SOL for fees / rent
  if (
    /Attempt to debit an account but found no record of a prior credit|insufficient lamports|InsufficientFundsForRent/i.test(
      blob,
    )
  ) {
    return {
      kind: 'error',
      title: 'Not enough SOL',
      summary: 'This wallet does not have enough SOL to pay fees or create accounts.',
      fix: 'Add SOL to the connected wallet (airdrop on localhost, transfer on mainnet), then retry.',
      details,
      raw,
    };
  }

  // SPL Token "Error: insufficient funds" (most common genesis/deposit footgun)
  if (/Error:\s*insufficient funds/i.test(blob) || /insufficient funds/i.test(blob)) {
    const custom = extractCustomHex(blob);
    const isToken01 = custom === 0x1 || /custom program error:\s*0x1\b/i.test(blob);
    const genesis = /GenesisDeposit/i.test(blob);
    return {
      kind: 'error',
      title: genesis ? 'Not enough USDC for genesis' : 'Insufficient token balance',
      summary: genesis
        ? 'Genesis deposit always pulls a fixed 1 USDC from your wallet into the vault. Your USDC account does not have enough.'
        : 'A token transfer failed because the source account balance is too low.',
      fix: genesis
        ? 'Hold at least 1 USDC (mint EPjF…Dt1v) in the connected wallet. On localhost: c_vault_script → Airdrop USDC for this wallet, then retry Genesis deposit.'
        : 'Check the token balance for the asset being transferred, fund the wallet, and retry.',
      instruction: ixLabel,
      code: isToken01 ? 'InsufficientFunds · 0x1' : 'InsufficientFunds',
      details,
      raw,
    };
  }

  // Anchor program errors
  const anchorCode = extractAnchorCode(blob);
  if (anchorCode != null && ANCHOR_ERRORS[anchorCode]) {
    const a = ANCHOR_ERRORS[anchorCode];
    return {
      kind: 'error',
      title: a.title,
      summary: a.summary,
      fix: a.fix,
      instruction: ixLabel,
      code: `${a.name} · ${anchorCode} (0x${anchorCode.toString(16)})`,
      details,
      raw,
    };
  }

  // Custom hex — try SPL Token first when Tokenkeg is in the stack, then Anchor range
  const hex = extractCustomHex(blob);
  if (hex != null) {
    if (SPL_TOKEN_ERRORS[hex] && /Tokenkeg|TokenzQdB|insufficient funds|token/i.test(blob)) {
      const t = SPL_TOKEN_ERRORS[hex];
      return {
        kind: 'error',
        title: t.title,
        summary: t.summary,
        fix: t.fix,
        instruction: ixLabel,
        code: `${t.name} · 0x${hex.toString(16)}`,
        details,
        raw,
      };
    }
    if (hex >= 6000 && ANCHOR_ERRORS[hex]) {
      const a = ANCHOR_ERRORS[hex];
      return {
        kind: 'error',
        title: a.title,
        summary: a.summary,
        fix: a.fix,
        instruction: ixLabel,
        code: `${a.name} · ${hex}`,
        details,
        raw,
      };
    }
  }

  // Named Error Message: from Anchor logs
  const msgLine = blob.match(/Error Message:\s*(.+)/i);
  if (msgLine) {
    return {
      kind: 'error',
      title: ixLabel ? `${ixLabel} failed` : 'Transaction failed',
      summary: msgLine[1].trim(),
      fix: 'See technical details if you need the full program log.',
      instruction: ixLabel,
      code: anchorCode != null ? String(anchorCode) : hex != null ? `0x${hex.toString(16)}` : undefined,
      details,
      raw,
    };
  }

  // Simulation failed — strip the noisy "Catch the SendTransactionError…" tail
  if (/Transaction simulation failed/i.test(raw) || /simulation failed/i.test(blob)) {
    const firstLine = raw.split('\n').find((l) => l.trim()) ?? 'Transaction simulation failed.';
    const cleaned = firstLine
      .replace(/\s*Catch the `?SendTransactionError`?.*$/i, '')
      .replace(/\s*Logs:\s*$/i, '')
      .trim();
    return {
      kind: 'error',
      title: ixLabel ? `${ixLabel} failed` : 'Simulation failed',
      summary: cleaned || 'The cluster rejected this transaction before it was sent.',
      fix: 'Read the technical log for the program line that failed. Common causes: low USDC/SOL, wrong network, or missing ATAs.',
      instruction: ixLabel,
      code: hex != null ? `0x${hex.toString(16)}` : undefined,
      details,
      raw,
    };
  }

  // Already human prose from our code (short, no "Program log")
  if (
    raw.length < 280 &&
    !/Program [1-9A-HJ-NP-Za-km-z]{32,}/.test(raw) &&
    !/0x[0-9a-f]+/i.test(raw)
  ) {
    return {
      kind: 'error',
      title: 'Something went wrong',
      summary: raw,
      details: details !== raw ? details : undefined,
      raw,
    };
  }

  // Last resort: first useful log line
  const logLine = details
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        /Error Code:|Error Message:|Error:|failed:|custom program error/i.test(l) &&
        !/Catch the/i.test(l),
    );

  return {
    kind: 'error',
    title: ixLabel ? `${ixLabel} failed` : 'Transaction failed',
    summary: logLine || raw.split('\n')[0] || 'The transaction could not be completed.',
    fix: 'Expand technical details for the full simulation log, or retry after checking balances and network.',
    instruction: ixLabel,
    details,
    raw,
  };
}

/** Single-line / multi-line string for places that still want plain text. */
export function formatUserFacingError(err: unknown): string {
  const e = parseTxError(err);
  const parts = [e.title, e.summary];
  if (e.fix) parts.push(`What to do: ${e.fix}`);
  if (e.code) parts.push(`Code: ${e.code}`);
  return parts.join('\n');
}

export function isUserFacingRejection(err: unknown): boolean {
  return parseTxError(err).kind === 'info' && /cancelled/i.test(parseTxError(err).title);
}

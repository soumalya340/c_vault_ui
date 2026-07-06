# Vault Section + Merged create_etf/create_metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the `create_etf` and `create_share_metadata` Anchor instructions into one `create_etf` call (vault + Token-2022 share metadata created in a single transaction), and replace the UI's standalone "Feeds" tab with a new "Vault" tab that hosts this merged creation flow — without touching any Pyth-feed code.

**Architecture:** The Rust handler in `create_etf.rs` absorbs the metadata-init logic currently in `create_metadata.rs`, so `create_etf` takes three extra `String` args (`name`, `symbol`, `uri`) and performs both steps signed by the same transaction. `create_share_metadata` and its file are deleted. On the UI side, `function-defs.ts` drops the `feeds` tab/id and old `create_etf`/`create_share_metadata` function defs, adding one merged `VAULT_FUNCTIONS` def rendered under a new `vault` tab; `cvault.tsx` and `execute-vault-function.ts` collapse their two call paths into one.

**Tech Stack:** Anchor (Rust) for the program in `c_vault/programs/vault`; mocha/chai + LiteSVM/surfpool for program tests in `c_vault/tests`; Next.js/React + `@coral-xyz/anchor` client in `c_vault_ui`.

## Global Constraints

- Do not modify anything related to Pyth feeds: `/api/pyth-feeds/*`, `FeedsPanel`, `feed-select-field.tsx`, `fetchFeeds`, `savedFeeds` plumbing, or any `type: "feed"` field definition.
- `create_share_metadata` is fully removed (not kept for backward compatibility) — this is an intentional breaking change to the on-chain interface.
- No regrouping of other Admin functions (`init_global_state`, `set_paused`, `emergency_exit`, `resume`, `set_redeem_cooldown`) — they stay in `ADMIN_FUNCTIONS`.
- Tab order after the change: View → Deposit → Redeem → Admin → Vault.
- Follow existing code conventions in each touched file (comment style, section-divider banners in Rust files, etc.) — don't introduce new patterns.

---

## Task 1: Merge the Rust handler (`create_etf` absorbs `create_share_metadata`)

**Files:**
- Modify: `c_vault/programs/vault/src/vault/create_etf.rs`
- Modify: `c_vault/programs/vault/src/vault/mod.rs`
- Delete: `c_vault/programs/vault/src/vault/create_metadata.rs`
- Modify: `c_vault/programs/vault/src/lib.rs:38-47`

**Interfaces:**
- Consumes: existing `crate::state::{AssetInfo, FundType, GlobalState, InitializeParams, Vault}`, `crate::constants::*`, `crate::errors::VaultError` (all already imported in `create_etf.rs`).
- Produces: `pub fn create_etf_handler(ctx: Context<CreateEtf>, params: InitializeParams, name: String, symbol: String, uri: String) -> Result<()>` — the new signature every other task (tests, IDL, TS clients) must match. Also produces `pub struct CreateEtf<'info>` (unchanged field list) and re-exports `ShareMetadataCreatedEvent` (moved into `create_etf.rs`).

- [ ] **Step 1: Rewrite `create_etf.rs` to take the new params and perform the metadata step**

Replace the full contents of `c_vault/programs/vault/src/vault/create_etf.rs` with:

```rust
use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_lang::system_program::{transfer, Transfer};
use anchor_spl::token::{Mint as TokenMint, Token, TokenAccount};
use anchor_spl::token_2022::spl_token_2022::{
    self,
    extension::{BaseStateWithExtensions, ExtensionType, PodStateWithExtensions},
    pod::PodMint,
    state::Mint as SplMint2022,
};
use anchor_spl::token_2022_extensions::metadata_pointer::{
    metadata_pointer_initialize, MetadataPointerInitialize,
};
use anchor_spl::token_interface::{token_metadata_initialize, TokenInterface, TokenMetadataInitialize};
use spl_pod::optional_keys::OptionalNonZeroPubkey;
use spl_token_metadata_interface::state::TokenMetadata;

use crate::constants::*;
use crate::errors::VaultError;
use crate::state::{AssetInfo, FundType, GlobalState, InitializeParams, Vault};

// ── Handler ───────────────────────────────────────────────────────────────────

/// Admin-only: create a new ETF fund vault, including its Token-2022 share
/// metadata, in a single transaction.
///
/// The new vault's id is always `global_state.total_vaults` (the latest id) —
/// PDA seeds are derived directly from that counter, so there is no
/// caller-supplied id to validate. After the vault is initialised,
/// `global_state.total_vaults` is incremented by 1.
///
/// `name`/`symbol`/`uri` set the Token-2022 inline metadata on the freshly
/// created share mint (formerly a separate `create_share_metadata`
/// instruction — merged here so both steps land in one transaction).
pub fn create_etf_handler(
    ctx: Context<CreateEtf>,
    params: InitializeParams,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    require!(
        !ctx.accounts.global_state.is_emergency,
        VaultError::EmergencyMode
    );
    require!(
        ctx.accounts
            .global_state
            .is_eligible_base_mint(&ctx.accounts.usdc_mint.key()),
        VaultError::BaseMintNotEligible
    );

    // ── Parameter validation ───────────────────────────────────────────────────
    let vault_id = ctx.accounts.global_state.total_vaults;
    require!(!params.assets.is_empty(), VaultError::NoAssets);
    require!(params.assets.len() <= MAX_ASSETS, VaultError::TooManyAssets);
    require!(params.performance_fee_bps <= 2000, VaultError::FeeTooHigh);

    let total_bps: u16 = params.assets.iter().map(|a| a.allocation_bps).sum();
    require!(total_bps == 10_000, VaultError::InvalidAllocation);

    let needs_sol_pool = params
        .assets
        .iter()
        .any(|a| a.route == crate::state::PoolRoute::ViaSol);
    require!(
        !needs_sol_pool || params.usdc_sol_pool.is_some(),
        VaultError::MissingUsdcSolPool
    );

    // ── Share mint creation (manual) ──────────────────────────────────────────
    // Anchor's `#[account(init, mint::…)]` macro can't declare the Token-2022
    // `MetadataPointer` extension on anchor-spl 0.31.0 (support landed in
    // 0.31.1), and extensions must be initialized *before* `InitializeMint2`.
    // So the mint is created by hand: allocate + assign, init the metadata
    // pointer (pointing at itself — the mint is its own metadata account),
    // then init the mint proper, then (below) init the metadata content.
    let vault_id_bytes = vault_id.to_le_bytes();
    let shares_mint_seeds: &[&[&[u8]]] =
        &[&[SHARES_MINT_SEED, &vault_id_bytes, &[ctx.bumps.shares_mint]]];

    let mint_space =
        ExtensionType::try_calculate_account_len::<SplMint2022>(&[ExtensionType::MetadataPointer])
            .map_err(|_| VaultError::MathOverflow)?;
    let mint_lamports = Rent::get()?.minimum_balance(mint_space);

    invoke_signed(
        &system_instruction::create_account(
            ctx.accounts.authority.key,
            ctx.accounts.shares_mint.key,
            mint_lamports,
            mint_space as u64,
            ctx.accounts.shares_token_program.key,
        ),
        &[
            ctx.accounts.authority.to_account_info(),
            ctx.accounts.shares_mint.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        shares_mint_seeds,
    )?;

    let shares_mint_key = ctx.accounts.shares_mint.key();
    metadata_pointer_initialize(
        CpiContext::new_with_signer(
            ctx.accounts.shares_token_program.to_account_info(),
            MetadataPointerInitialize {
                token_program_id: ctx.accounts.shares_token_program.to_account_info(),
                mint: ctx.accounts.shares_mint.to_account_info(),
            },
            shares_mint_seeds,
        ),
        Some(shares_mint_key),
        Some(shares_mint_key),
    )?;

    invoke_signed(
        &spl_token_2022::instruction::initialize_mint2(
            ctx.accounts.shares_token_program.key,
            ctx.accounts.shares_mint.key,
            ctx.accounts.vault_authority.key,
            None,
            ctx.accounts.usdc_mint.decimals,
        )?,
        &[ctx.accounts.shares_mint.to_account_info()],
        shares_mint_seeds,
    )?;

    // ── Vault initialisation ──────────────────────────────────────────────────
    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;

    vault.vault_id = vault_id;
    vault.fee_recipient = params.fee_recipient.unwrap_or(ctx.accounts.authority.key());
    vault.vault_manager = ctx.accounts.authority.key();
    vault.paused = false;
    vault.base_mint = ctx.accounts.usdc_mint.key();
    vault.shares_mint = ctx.accounts.shares_mint.key();

    vault.performance_fee_bps = params.performance_fee_bps;

    vault.total_shares = 0;
    vault.total_usdc_value = 0;
    vault.ath_share_price = PRICE_SCALE;
    vault.rolling_high_price = PRICE_SCALE;
    vault.rolling_window_start = clock.unix_timestamp;
    vault.total_deposited = 0;
    vault.total_withdrawn = 0;

    vault.redeem_cooldown_secs = REDEEM_COOLDOWN_SECS;

    // ── Fund type + caps ──────────────────────────────────────────────────────
    // A Fixed vault must declare a positive share supply cap; a Dynamic vault is
    // always uncapped (any caller-supplied caps are ignored / cleared).
    vault.fund_type = params.fund_type;
    match params.fund_type {
        FundType::Fixed => {
            let max_shares = params.max_shares.ok_or(VaultError::MissingMaxShares)?;
            require!(max_shares > 0, VaultError::InvalidMaxShares);
            vault.max_shares = Some(max_shares);
        }
        FundType::Dynamic => {
            vault.max_shares = None;
        }
    }

    vault.usdc_sol_pool = params.usdc_sol_pool;
    vault.num_assets = params.assets.len() as u8;

    for (i, ap) in params.assets.iter().enumerate() {
        vault.assets[i] = AssetInfo {
            mint: ap.mint,
            pool_address: ap.pool_address,
            pyth_feed_id: ap.pyth_feed_id,
            allocation_bps: ap.allocation_bps,
            decimals: ap.decimals,
            route: ap.route,
        };
    }

    // ── Compute vault.sol_target_bps[] — fixed ratio, computed once ──────────
    // Ratio of each non-wSOL-native ViaSol asset's bps to the sum of all such
    // assets' bps. Immutable after this point; swap_sol_to_asset reads it directly.
    let via_sol_bps_sum: u32 = params
        .assets
        .iter()
        .filter(|a| a.route == crate::state::PoolRoute::ViaSol && a.mint != WSOL_MINT)
        .map(|a| a.allocation_bps as u32)
        .sum();

    if via_sol_bps_sum > 0 {
        for (i, ap) in params.assets.iter().enumerate() {
            if ap.route == crate::state::PoolRoute::ViaSol && ap.mint != WSOL_MINT {
                vault.sol_target_bps[i] =
                    ((ap.allocation_bps as u32) * 10_000 / via_sol_bps_sum) as u16;
            }
        }
    }

    vault.bump = ctx.bumps.vault;
    vault.authority_bump = ctx.bumps.vault_authority;
    vault.share_mint_bump = ctx.bumps.shares_mint;
    vault.usdc_vault_bump = ctx.bumps.usdc_vault;

    // ── GlobalState: bump vault counter (after vault is fully initialised) ─────
    let global_state = &mut ctx.accounts.global_state;
    global_state.total_vaults = global_state
        .total_vaults
        .checked_add(1)
        .ok_or(VaultError::MathOverflow)?;

    // ── Share Token-2022 metadata (formerly create_share_metadata) ────────────
    // The mint was allocated rent only for the MetadataPointer extension above;
    // the TokenMetadata TLV entry is variable-length, so top up rent before init.
    let shares_mint_info = ctx.accounts.shares_mint.to_account_info();

    let token_metadata = TokenMetadata {
        update_authority: OptionalNonZeroPubkey::try_from(Some(
            ctx.accounts.vault_authority.key(),
        ))?,
        mint: shares_mint_info.key(),
        name: name.clone(),
        symbol: symbol.clone(),
        uri: uri.clone(),
        ..Default::default()
    };

    let mint_data = shares_mint_info.try_borrow_data()?;
    let mint_state = PodStateWithExtensions::<PodMint>::unpack(&mint_data)?;
    let new_account_len = mint_state
        .try_get_new_account_len_for_variable_len_extension(&token_metadata)
        .map_err(|_| VaultError::MathOverflow)?;
    drop(mint_data);

    let rent = Rent::get()?;
    let new_minimum_balance = rent.minimum_balance(new_account_len);
    let additional_lamports = new_minimum_balance.saturating_sub(shares_mint_info.lamports());

    if additional_lamports > 0 {
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.authority.to_account_info(),
                    to: shares_mint_info.clone(),
                },
            ),
            additional_lamports,
        )?;
    }

    let authority_signer_seeds: &[&[&[u8]]] = &[&[
        VAULT_AUTHORITY_SEED,
        &vault_id_bytes,
        &[ctx.bumps.vault_authority],
    ]];

    let cpi_accounts = TokenMetadataInitialize {
        program_id: ctx.accounts.shares_token_program.to_account_info(),
        mint: shares_mint_info.clone(),
        metadata: shares_mint_info,
        mint_authority: ctx.accounts.vault_authority.to_account_info(),
        update_authority: ctx.accounts.vault_authority.to_account_info(),
    };
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.shares_token_program.to_account_info(),
        cpi_accounts,
        authority_signer_seeds,
    );

    token_metadata_initialize(cpi_ctx, name.clone(), symbol.clone(), uri.clone())?;

    emit!(ShareMetadataCreatedEvent {
        vault_id,
        vault_manager: ctx.accounts.authority.key(),
        name,
        symbol,
        uri,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "ETF created | vault_id: {} | assets: {} | fee_bps: {} | admin: {}",
        vault_id,
        vault.num_assets,
        vault.performance_fee_bps,
        ADMIN_PUBKEY,
    );
    Ok(())
}

// ── Account context ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct CreateEtf<'info> {
    /// Program-wide singleton — must already be initialised via init_global_state.
    /// `total_vaults` is read here (pre-handler) to derive this vault's PDA seeds.
    #[account(
        mut,
        seeds = [GLOBAL_STATE_SEED],
        bump,
    )]
    pub global_state: Box<Account<'info, GlobalState>>,

    /// The new vault state PDA, keyed by the current global vault counter.
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, &global_state.total_vaults.to_le_bytes()],
        bump,
        space = ANCHOR_DISCRIMINATOR + Vault::INIT_SPACE,
    )]
    pub vault: Box<Account<'info, Vault>>,

    /// Per-vault PDA that signs CPIs on behalf of this vault.
    #[account(seeds = [VAULT_AUTHORITY_SEED, &global_state.total_vaults.to_le_bytes()], bump)]
    /// CHECK: program-derived signer — no data stored
    pub vault_authority: AccountInfo<'info>,

    /// Share (LP) token mint for this vault — Token-2022. Created manually in the
    /// handler (not via Anchor's `init` + `mint::…` macro) because the
    /// `MetadataPointer` extension must be initialized *before* `InitializeMint2`,
    /// and this workspace's anchor-spl (0.31.0) doesn't yet support declaring
    /// mint extensions through the account macro (added in 0.31.1).
    #[account(
        mut,
        seeds = [SHARES_MINT_SEED, &global_state.total_vaults.to_le_bytes()],
        bump,
    )]
    /// CHECK: uninitialized PDA — manually created + initialized as a Token-2022
    /// mint (with MetadataPointer extension) in the handler below.
    pub shares_mint: UncheckedAccount<'info>,

    /// USDC token account custodied by this vault.
    #[account(
        init,
        payer = authority,
        seeds = [USDC_VAULT_SEED, usdc_mint.key().as_ref(), &global_state.total_vaults.to_le_bytes()],
        bump,
        token::mint      = usdc_mint,
        token::authority = vault_authority,
    )]
    pub usdc_vault: Box<Account<'info, TokenAccount>>,

    /// The USDC mint (base currency for all deposits and redemptions).
    pub usdc_mint: Box<Account<'info, TokenMint>>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    /// Token-2022 program — used for the share mint.
    pub shares_token_program: Interface<'info, TokenInterface>,
    /// Classic SPL Token program — used for the USDC vault account.
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[event]
pub struct ShareMetadataCreatedEvent {
    pub vault_id: u64,
    pub vault_manager: Pubkey,
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub timestamp: i64,
}
```

- [ ] **Step 2: Delete `create_metadata.rs` and update `mod.rs`**

```bash
rm /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault/programs/vault/src/vault/create_metadata.rs
```

Replace `c_vault/programs/vault/src/vault/mod.rs` with:

```rust
pub mod create_etf;
pub mod vault_ops;

pub use create_etf::*;
pub use vault_ops::*;
```

- [ ] **Step 3: Update `lib.rs` entrypoints**

In `c_vault/programs/vault/src/lib.rs`, replace lines 31-47:

```rust
    /// Create a new ETF fund vault. The new vault's id is always
    /// `global_state.total_vaults`; PDA seeds are derived from it directly. The
    /// counter is incremented by 1 once the vault is initialised.
    pub fn create_etf(ctx: Context<CreateEtf>, params: state::InitializeParams) -> Result<()> {
        create_etf::create_etf_handler(ctx, params)
    }

    /// Initialize inline Token-2022 metadata on an existing vault's share mint.
    pub fn create_share_metadata(
        ctx: Context<CreateShareMetadata>,
        vault_id: u64,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        create_metadata::create_share_metadata_handler(ctx, vault_id, name, symbol, uri)
    }
```

with:

```rust
    /// Create a new ETF fund vault, including its Token-2022 share metadata,
    /// in a single transaction. The new vault's id is always
    /// `global_state.total_vaults`; PDA seeds are derived from it directly. The
    /// counter is incremented by 1 once the vault is initialised.
    pub fn create_etf(
        ctx: Context<CreateEtf>,
        params: state::InitializeParams,
        name: String,
        symbol: String,
        uri: String,
    ) -> Result<()> {
        create_etf::create_etf_handler(ctx, params, name, symbol, uri)
    }
```

- [ ] **Step 4: Build the program**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && anchor build`

Expected: build succeeds with no errors. If `token_2022::spl_token_2022::extension::BaseStateWithExtensions` or `pod::PodMint` imports collide with existing names already imported at the top of `create_etf.rs` (they didn't exist there before), fix any "unused import" or "duplicate import" warnings/errors that surface — this is the only file where both instructions' imports now combine.

- [ ] **Step 5: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault
git add programs/vault/src/vault/create_etf.rs programs/vault/src/vault/mod.rs programs/vault/src/lib.rs
git rm programs/vault/src/vault/create_metadata.rs
git commit -m "$(cat <<'EOF'
Merge create_share_metadata into create_etf as a single instruction

Vault creation and Token-2022 share metadata init now happen in one
transaction instead of two, removing the window where a vault exists
with an unnamed share mint.
EOF
)"
```

---

## Task 2: Update program tests for the merged instruction

**Files:**
- Modify: `c_vault/tests/unit/utils/helpers.ts`
- Modify: `c_vault/tests/unit/create_etf.test.ts`
- Modify: `c_vault/tests/integration/utils/vault_env.ts`
- Delete: `c_vault/tests/integration/create_share_metadata.test.ts`

**Interfaces:**
- Consumes: `program.methods.createEtf(params, name, symbol, uri)` (new 4-arg IDL method produced by Task 1, after `anchor build` regenerates `target/idl/c_vault.json` and `target/types/c_vault.ts`).
- Produces: `makeSimpleEtfParams(feeRecipient: PublicKey)` unchanged return shape (still just the `InitializeParams`-shaped object; name/symbol/uri are passed as separate call args, not folded into this object) — `testEtfParams(feeRecipient: PublicKey)` in `vault_env.ts` likewise unchanged return shape.

- [ ] **Step 1: Update `makeSimpleEtfParams` call sites in `create_etf.test.ts`**

In `c_vault/tests/unit/create_etf.test.ts`, every `.createEtf(makeSimpleEtfParams(...) as any)` or `.createEtf(params as any)` call must become a 4-arg call. There are 7 call sites (lines 102, 150, 185, 225, 256, 288, 322, 349 — the `it.skip` one too, update it for consistency). For each, change:

```typescript
    const tx = (await program.methods
      .createEtf(makeSimpleEtfParams(authority.publicKey) as any)
```

to:

```typescript
    const tx = (await program.methods
      .createEtf(
        makeSimpleEtfParams(authority.publicKey) as any,
        "Test Vault Shares",
        "TVS",
        "https://example.com/metadata.json",
      )
```

And for the `params` variable call sites (Tests 1.2.4, 1.2.5, 1.2.6, 1.2.7), change:

```typescript
    const tx = (await program.methods
      .createEtf(params as any)
```

to:

```typescript
    const tx = (await program.methods
      .createEtf(
        params as any,
        "Test Vault Shares",
        "TVS",
        "https://example.com/metadata.json",
      )
```

- [ ] **Step 2: Add a metadata assertion to the happy-path test (Test 1.2.1)**

In `c_vault/tests/unit/create_etf.test.ts`, add the import at the top:

```typescript
import { getToken2022Details } from "./utils/helpers";
```

(add `getToken2022Details` to the existing `import { startSvm, createProgram, sendTx, expectTxToFail, makeSimpleEtfParams, injectMockSplMint } from "./utils/helpers";` line instead of a new import line.)

Then at the end of `it("Test 1.2.1: happy — ...")`, after the existing `expect(svm.getAccount(usdcVault)).to.not.be.null;` line, add:

```typescript

    const shareDetails = getToken2022Details(svm, sharesMint);
    expect(shareDetails.metadata?.name).to.equal("Test Vault Shares");
    expect(shareDetails.metadata?.symbol).to.equal("TVS");
    expect(shareDetails.metadata?.uri).to.equal(
      "https://example.com/metadata.json",
    );
```

- [ ] **Step 3: Run the unit test suite**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && anchor build && npx mocha -r ts-node/register tests/unit/create_etf.test.ts --timeout 60000`

Expected: all `create_etf (LiteSVM)` tests pass, including the new metadata assertions in Test 1.2.1.

- [ ] **Step 4: Update `vault_env.ts`'s `createTestEtf` to pass metadata args**

In `c_vault/tests/integration/utils/vault_env.ts`, find `createTestEtf` (around line 415-430):

```typescript
export async function createTestEtf(env: VaultEnv): Promise<void> {
  const gs = await env.program.account.globalState.fetch(env.globalStatePda);
  const vaultId = gs.totalVaults.toNumber();

  await env.program.methods
    .createEtf(testEtfParams(env.admin))
    .accounts({
      authority: env.admin,
      usdcMint: USDC_MINT,
    } as any)
    .rpc();
```

Change the `.createEtf(...)` call to:

```typescript
  await env.program.methods
    .createEtf(
      testEtfParams(env.admin),
      "cVault Test Shares",
      "CVTS",
      "https://example.com/test-metadata.json",
    )
    .accounts({
      authority: env.admin,
      usdcMint: USDC_MINT,
    } as any)
    .rpc();
```

Leave `testEtfParams` itself (the object builder, lines 247-270ish) unchanged — it still returns only the `InitializeParams` shape.

- [ ] **Step 5: Delete the standalone `create_share_metadata.test.ts` and port its assertions**

```bash
rm /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault/tests/integration/create_share_metadata.test.ts
```

Its happy-path assertion (Token-2022 metadata fields correct) is now covered inline wherever `createTestEtf`/direct `createEtf` calls are made in integration tests, since the metadata is set as part of vault creation. Its "non-vault_manager signer is rejected" guard (Test 1.3.2) no longer expresses a distinct check — there is no second instruction with its own signer constraint anymore. Do not port that specific test; note this in the CHANGELOG (Task 4) as an intentional behavior simplification: metadata is now set by whoever creates the vault (`authority`), with no separate later-editable step.

- [ ] **Step 6: Search for any other integration test file directly calling `createShareMetadata`**

Run: `grep -rln "createShareMetadata" /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault/tests`

Expected: no output (all references were in the file deleted in Step 5). If any remain, open each file and remove/adapt the call the same way Step 5 describes.

- [ ] **Step 7: Run the full test suite**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && anchor test`

Expected: all tests pass (unit + integration), with no references to `createShareMetadata` remaining and `createEtf` calls everywhere passing 4 args.

- [ ] **Step 8: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault
git add tests/unit/create_etf.test.ts tests/unit/utils/helpers.ts tests/integration/utils/vault_env.ts
git rm tests/integration/create_share_metadata.test.ts
git commit -m "$(cat <<'EOF'
Update tests for merged create_etf instruction

All createEtf() calls now pass name/symbol/uri directly; the standalone
create_share_metadata test file is folded into create_etf's happy path.
EOF
)"
```

---

## Task 3: Update CHANGELOG.md

**Files:**
- Modify: `c_vault/CHANGELOG.md`

**Interfaces:**
- Consumes: nothing (documentation only).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add an Unreleased/Changed entry**

In `c_vault/CHANGELOG.md`, insert a new section directly under the `## [1.1.0] - 2026-07-04` heading's own place (i.e., add a new version block above it, or an `## [Unreleased]` block if that's this project's convention — this repo has no existing `[Unreleased]` section, so add one at the very top, right after the format-description paragraph on line 6):

```markdown
## [Unreleased]

### Changed
- **Breaking:** `create_etf` and `create_share_metadata` are merged into a single `create_etf` instruction. `create_etf` now takes `(params, name, symbol, uri)` and creates the vault plus its Token-2022 share metadata in one transaction. The standalone `create_share_metadata` instruction no longer exists.

```

- [ ] **Step 2: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault
git add CHANGELOG.md
git commit -m "Document create_etf/create_share_metadata merge in CHANGELOG"
```

---

## Task 4: Sync the IDL/types into `c_vault_ui`

**Files:**
- Modify (copy): `c_vault_ui/idl/*` (whatever IDL JSON and/or generated TS types live there — inspect the directory first)

**Interfaces:**
- Consumes: `c_vault/target/idl/c_vault.json` and `c_vault/target/types/c_vault.ts`, produced by `anchor build` in Task 1.
- Produces: an IDL in `c_vault_ui` whose `createEtf` instruction definition has 4 args (`params`, `name`, `symbol`, `uri`) and no `createShareMetadata` entry — required by Task 5/6's TypeScript changes to type-check.

- [ ] **Step 1: Inspect what's vendored in `c_vault_ui/idl`**

Run: `ls -la /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl`

Expected: shows one or more files (e.g. `c_vault.json`, possibly a `.ts` types file). Note the exact filename(s).

- [ ] **Step 2: Confirm how `lib/program.ts` (or wherever `createProgram` lives) imports the IDL**

Run: `grep -rn "idl" /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/lib/program.ts`

Expected: shows an import path like `import IDL from "@/idl/c_vault.json"` (or similar) — confirms exactly which file(s) need overwriting.

- [ ] **Step 3: Copy the freshly built IDL/types from `c_vault` into `c_vault_ui`**

Run (adjust filenames based on Step 1/2 findings — this is the common case where the UI vendors the raw IDL JSON):

```bash
cp /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault/target/idl/c_vault.json /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.json
```

If a `.ts` types file is also vendored (check Step 1's output), copy it too:

```bash
cp /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault/target/types/c_vault.ts /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.ts
```

(Skip this second copy if no such file exists in `c_vault_ui/idl`.)

- [ ] **Step 4: Verify the new IDL has no `createShareMetadata` entry and `createEtf` has 4 args**

Run: `grep -A 3 '"name": "createEtf"' /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.json`

Expected: shows an `args` array with 4 entries (`params`, `name`, `symbol`, `uri`).

Run: `grep -c "createShareMetadata" /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.json`

Expected: `0`.

- [ ] **Step 5: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add idl/
git commit -m "Sync IDL: create_etf/create_share_metadata merge"
```

---

## Task 5: Merge `createEtf`/`createShareMetadata` in `lib/cvault.tsx`

**Files:**
- Modify: `c_vault_ui/lib/cvault.tsx:118-160`

**Interfaces:**
- Consumes: `createProgram(wallet, connection)` (unchanged), the new IDL from Task 4.
- Produces: `createEtf(connection: Connection, wallet: AnchorWallet, params: CreateEtfParams, name: string, symbol: string, uri: string, network: Network): Promise<{ tx: string; link: string }>` — the signature Task 6 must call.

- [ ] **Step 1: Replace the two exported functions**

In `c_vault_ui/lib/cvault.tsx`, replace lines 128-160 (the `createEtf` and `createShareMetadata` functions) with:

```typescript
export async function createEtf(
  connection: Connection,
  wallet: AnchorWallet,
  params: CreateEtfParams,
  name: string,
  symbol: string,
  uri: string,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .createEtf(params, name, symbol, uri)
    .accounts({
      authority: wallet.publicKey,
      usdcMint: USDC_MINT,
    } as any)
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}
```

- [ ] **Step 2: Type-check**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui && npx tsc --noEmit`

Expected: no errors originating from `lib/cvault.tsx` about `createEtf`'s signature (errors from `execute-vault-function.ts` still calling the old `createShareMetadata` are expected here — fixed in Task 6).

- [ ] **Step 3: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add lib/cvault.tsx
git commit -m "Merge createEtf/createShareMetadata into one client call"
```

---

## Task 6: Update `function-defs.ts` — remove Feeds tab, add Vault tab

**Files:**
- Modify: `c_vault_ui/app/components/function-defs.ts`

**Interfaces:**
- Consumes: `ADMIN_PUBKEY, WBTC_MINT, WSOL_USDC_POOL, WSOL_WBTC_POOL` from `@/lib/cvault` (already imported).
- Produces: `VAULT_FUNCTIONS: FunctionDef[]` (new export, one entry, id `"create_etf"`) and `SectionId = "view" | "deposit" | "redeem" | "vault" | "admin"` — both consumed by Task 7 (`page.tsx`) and Task 8 (`execute-vault-function.ts`).

- [ ] **Step 1: Update `SectionId`**

In `c_vault_ui/app/components/function-defs.ts`, change line 8:

```typescript
export type SectionId = "view" | "deposit" | "redeem" | "feeds" | "admin";
```

to:

```typescript
export type SectionId = "view" | "deposit" | "redeem" | "vault" | "admin";
```

- [ ] **Step 2: Remove `create_etf` (4B) and `create_share_metadata` (4C) from `ADMIN_FUNCTIONS`, add `VAULT_FUNCTIONS`**

In `ADMIN_FUNCTIONS` (currently lines 293-412), delete the two entries with `id: "create_etf"` (4B, lines 302-350) and `id: "create_share_metadata"` (4C, lines 351-362) entirely, leaving `init_global_state` (4A) immediately followed by `set_paused` (renumber its label from 4D — keep as-is since these are just display numbers referenced nowhere else; leave `number: "4D"` etc. unchanged to minimize diff).

Immediately after the closing `];` of `ADMIN_FUNCTIONS`, add a new exported array:

```typescript
export const VAULT_FUNCTIONS: FunctionDef[] = [
  {
    id: "create_etf",
    number: "5A",
    title: "Create Vault",
    description:
      "Creates a new vault at vault_id = GlobalState.total_vaults and sets its Token-2022 share metadata — both in one transaction. Every field below is manual — no hardcoded basket.",
    fields: [
      { name: "fee_recipient", label: "Fee Recipient", placeholder: ADMIN_PUBKEY.toBase58() },
      {
        name: "performance_fee_bps",
        label: "Performance Fee (BPS, max 2000)",
        type: "number",
        placeholder: "1000",
      },
      {
        name: "usdc_sol_pool",
        label: "USDC/wSOL Pool (blank if all DirectUsdc)",
        placeholder: WSOL_USDC_POOL.toBase58(),
      },
      {
        name: "assets_json",
        label: "Assets (JSON array, see hint)",
        type: "text",
        hint: '[{"mint":"...","poolAddress":"...","pythFeedId":"hex64","allocationBps":3000,"decimals":9,"route":"ViaSol"}, ...]',
      },
      {
        name: "fund_type",
        label: "Fund Type",
        type: "select",
        options: [
          { label: "Dynamic", value: "dynamic" },
          { label: "Fixed", value: "fixed" },
        ],
      },
      {
        name: "max_assets",
        label: "Max Assets (Fixed only)",
        type: "number",
        placeholder: "",
      },
      {
        name: "max_shares",
        label: "Max Shares (Fixed only, raw units)",
        type: "number",
        placeholder: "",
      },
      { name: "name", label: "Share Token Name", placeholder: "cVault Shares" },
      { name: "symbol", label: "Share Token Symbol", placeholder: "CVS" },
      { name: "uri", label: "Share Metadata URI", placeholder: "https://..." },
    ],
    submitLabel: "Create Vault",
  },
];
```

- [ ] **Step 3: Update `REQUIRES_WALLET`**

In `REQUIRES_WALLET` (around line 414-432), remove `"create_share_metadata"` from the set (`"create_etf"` stays, since the merged function still uses that id):

```typescript
export const REQUIRES_WALLET = new Set([
  "deposit",
  "ensure_atas",
  "swap_usdc_to_sol",
  "swap_usdc_to_asset",
  "swap_sol_to_asset",
  "request_redeem",
  "swap_asset_to_sol",
  "swap_sol_to_usdc",
  "swap_asset_to_usdc",
  "claim",
  "init_global_state",
  "create_etf",
  "set_paused",
  "emergency_exit",
  "resume",
  "set_redeem_cooldown",
]);
```

- [ ] **Step 4: Update `TABS`**

Replace the `TABS` array (around line 436-442):

```typescript
export const TABS: { id: SectionId; label: string; eyebrow: string }[] = [
  { id: "view", label: "View", eyebrow: "READ" },
  { id: "deposit", label: "Deposit", eyebrow: "INFLOW" },
  { id: "redeem", label: "Redeem", eyebrow: "OUTFLOW" },
  { id: "admin", label: "Admin", eyebrow: "CONTROL" },
  { id: "vault", label: "Vault", eyebrow: "VAULT OPS" },
];
```

- [ ] **Step 5: Update `SECTION_EYEBROWS`**

Replace the `SECTION_EYEBROWS` object (around line 444-450):

```typescript
export const SECTION_EYEBROWS: Record<SectionId, string> = {
  view: "/// READ STATE",
  deposit: "/// INFLOW OPS",
  redeem: "/// OUTFLOW OPS",
  admin: "/// ADMIN CONTROL",
  vault: "/// VAULT OPS",
};
```

- [ ] **Step 6: Verify no leftover reference to `"feeds"` as a `SectionId` in this file**

Run: `grep -n '"feeds"' /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/app/components/function-defs.ts`

Expected: no output.

- [ ] **Step 7: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add app/components/function-defs.ts
git commit -m "Replace Feeds tab with Vault tab; merge create_etf/create_share_metadata field defs"
```

---

## Task 7: Wire the merged call in `execute-vault-function.ts`

**Files:**
- Modify: `c_vault_ui/app/components/execute-vault-function.ts`

**Interfaces:**
- Consumes: `createEtf(connection, anchorWallet, params, name, symbol, uri, network)` from Task 5; `VAULT_FUNCTIONS` is not imported here directly (this file dispatches purely on `fn.id`, which stays `"create_etf"`).

- [ ] **Step 1: Remove the `createShareMetadata` import and its dispatch branch**

In `c_vault_ui/app/components/execute-vault-function.ts`, remove `createShareMetadata` from the import block (currently line 8):

```typescript
import {
  initGlobalState,
  createEtf,
  createShareMetadata,
  emergencyExit,
  ...
```

becomes:

```typescript
import {
  initGlobalState,
  createEtf,
  emergencyExit,
  ...
```

Delete the entire `if (fn.id === "create_share_metadata") { ... }` block (currently lines 243-255).

- [ ] **Step 2: Update the `create_etf` branch to pass name/symbol/uri**

Replace the existing `if (fn.id === "create_etf") { ... }` block (currently lines 209-242):

```typescript
  if (fn.id === "create_etf") {
    if (!anchorWallet) throw new Error("Wallet required");
    const rawAssets = JSON.parse(v.assets_json || "[]");
    const assets = rawAssets.map((a: {
      mint: string;
      poolAddress: string;
      pythFeedId: string;
      allocationBps: number;
      decimals: number;
      route: string;
    }) => ({
      mint: new PublicKey(a.mint),
      poolAddress: new PublicKey(a.poolAddress),
      pythFeedId: Array.from(Buffer.from(a.pythFeedId, "hex")),
      allocationBps: a.allocationBps,
      decimals: a.decimals,
      route: a.route === "ViaSol" ? { viaSol: {} } : { directUsdc: {} },
    }));
    const r = await createEtf(
      connection,
      anchorWallet,
      {
        feeRecipient: v.fee_recipient?.trim() ? pk(v.fee_recipient) : ADMIN_PUBKEY,
        performanceFeeBps: Number(v.performance_fee_bps || 0),
        usdcSolPool: v.usdc_sol_pool?.trim() ? pk(v.usdc_sol_pool) : null,
        assets,
        fundType: v.fund_type === "fixed" ? { fixed: {} } : { dynamic: {} },
        maxAssets: v.max_assets?.trim() ? Number(v.max_assets) : null,
        maxShares: v.max_shares?.trim() ? bn(v.max_shares) : null,
      },
      v.name || "",
      v.symbol || "",
      v.uri || "",
      net,
    );
    return { tx: r.tx, solscan: r.link };
  }
```

- [ ] **Step 3: Type-check**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add app/components/execute-vault-function.ts
git commit -m "Wire merged create_etf call (name/symbol/uri) in execute-vault-function"
```

---

## Task 8: Update `page.tsx` — remove Feeds render branch, add Vault

**Files:**
- Modify: `c_vault_ui/app/page.tsx`

**Interfaces:**
- Consumes: `VAULT_FUNCTIONS` from `@/app/components/function-defs` (new import); `SectionBlock` (unchanged props: `id: SectionId, label: string, functions: FunctionDef[], network: Network, savedFeeds: PythFeedRow[]`).

- [ ] **Step 1: Update imports**

In `c_vault_ui/app/page.tsx`, remove the `FeedsPanel` import (line 9):

```typescript
import { FeedsPanel } from '@/app/components/feeds-panel';
```

Update the `function-defs` import (lines 10-16) to include `VAULT_FUNCTIONS`:

```typescript
import {
  VIEW_FUNCTIONS,
  DEPOSIT_FUNCTIONS,
  REDEEM_FUNCTIONS,
  ADMIN_FUNCTIONS,
  VAULT_FUNCTIONS,
  type SectionId,
} from '@/app/components/function-defs';
```

- [ ] **Step 2: Replace the `feeds` render branch with `vault`**

Replace (currently lines 128-130):

```typescript
          {activeTab === 'feeds' && (
            <FeedsPanel savedFeeds={savedFeeds} onChange={loadFeeds} />
          )}
```

with:

```typescript
          {activeTab === 'vault' && (
            <SectionBlock
              id="vault"
              label="Vault"
              functions={VAULT_FUNCTIONS}
              network={network}
              savedFeeds={savedFeeds}
            />
          )}
```

Leave this new block after the existing `admin` block (order in JSX doesn't need to match `TABS` order — React renders whichever `activeTab` matches).

- [ ] **Step 3: Confirm `savedFeeds`/`loadFeeds` still used elsewhere**

Run: `grep -n "savedFeeds\|loadFeeds" /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/app/page.tsx`

Expected: `savedFeeds` state, `loadFeeds` function, and its `useEffect` call remain (still passed into every `SectionBlock` for the `feed`-type fields in View/Deposit/Redeem) — this plan does not remove any of that.

- [ ] **Step 4: Type-check and start the dev server**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui && npx tsc --noEmit`

Expected: no errors.

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui && npm run dev`

Expected: dev server starts. Open the app in a browser, confirm the tab bar now reads View / Deposit / Redeem / Admin / Vault (no "Feeds" tab), and clicking "Vault" shows the merged "Create Vault" form with fee recipient, fee bps, pool, assets JSON, fund type, max assets/shares, name, symbol, and uri fields all in one accordion item. Stop the dev server after confirming (Ctrl-C).

- [ ] **Step 5: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add app/page.tsx
git commit -m "Replace Feeds tab with Vault tab in page.tsx"
```

---

## Task 9: End-to-end verification against localnet

**Files:** none (manual verification task)

**Interfaces:**
- Consumes: the full merged flow — `c_vault` program deployed locally, `c_vault_ui` dev server running against `localnet`.

- [ ] **Step 1: Start a local validator with the updated program deployed**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && solana-test-validator --reset &` (background), then `anchor deploy --provider.cluster localnet`.

Expected: program deploys successfully to the local validator.

- [ ] **Step 2: Run the UI against localnet and exercise the Vault tab**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui && npm run dev`

In the browser: connect a wallet funded on localnet, switch network toggle to "localnet", go to the "Vault" tab, fill in a minimal single-asset config (e.g. one DirectUsdc WSOL asset at 10000 bps, Dynamic fund type) plus name/symbol/uri, and submit.

Expected: one transaction confirms; the resulting Solscan-style link (or raw signature) is shown in the output panel. Use the "View" tab's "View Vault State" (1B) to confirm the new vault_id exists with the expected `num_assets`, `performance_fee_bps`, etc.

- [ ] **Step 3: Confirm on-chain metadata was set**

Run (from `c_vault` repo, using the vault_id and shares_mint derived from the vault you just created — substitute `<VAULT_ID>`):

```bash
node -e "
const { Connection, PublicKey } = require('@solana/web3.js');
const { getTokenMetadata } = require('@solana/spl-token');
(async () => {
  const connection = new Connection('http://127.0.0.1:8899');
  const [sharesMint] = PublicKey.findProgramAddressSync(
    [Buffer.from('shares_mint'), Buffer.from(new Uint8Array(new BigUint64Array([BigInt(<VAULT_ID>)]).buffer))],
    new PublicKey('2YW9wGokqo321EtDNWWH2CSQxFiJz3uMoNxa9dgbHn2P'),
  );
  const metadata = await getTokenMetadata(connection, sharesMint);
  console.log(metadata);
})();
"
```

Expected: prints the `name`/`symbol`/`uri` you entered in the form, confirming the merged transaction set both the vault and its share metadata correctly.

- [ ] **Step 4: Stop the local validator**

```bash
pkill -f solana-test-validator
```

- [ ] **Step 5: No commit needed** — this task is manual verification only; if any bug surfaces, fix it in the relevant task's files and re-run this task.

---

## Self-Review Notes

- **Spec coverage:** Task 1-3 cover the Rust merge + tests + changelog (spec §"Program change" and §"Tests" and §"CHANGELOG.md"). Task 4 covers IDL sync (spec §"IDL / generated types"). Tasks 5-8 cover all four UI files named in the spec (`cvault.tsx`, `function-defs.ts`, `execute-vault-function.ts`, `page.tsx`). Task 9 covers the spec's "Testing plan" section (manual localnet exercise + metadata confirmation). The spec's explicit call-out about the unauthorized-signer test collapsing is handled in Task 2 Step 5.
- **Placeholder scan:** no TBD/TODO; the one open question (exact IDL filename(s) in `c_vault_ui/idl`) is resolved via an inspection step (Task 4 Step 1) rather than left vague, with the copy command adjustable based on that step's real output.
- **Type consistency:** `createEtf(connection, wallet, params, name, symbol, uri, network)` signature is identical across Task 5 (definition) and Task 7 (call site). `create_etf_handler(ctx, params, name, symbol, uri)` is identical across Task 1 (definition) and `lib.rs`'s call in the same task. `VAULT_FUNCTIONS` name matches between Task 6 (definition) and Task 8 (import/usage).

# Vault Section + Merged create_etf/create_metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the `create_etf` and `create_share_metadata` Anchor instructions into one `create_etf` call (vault + Token-2022 share metadata created in a single transaction); replace the UI's standalone "Feeds" tab with a new "Vault" tab hosting this merged creation flow plus `set_fee_recipient`; and close a UI coverage gap by fixing the broken Emergency Exit/Resume buttons and adding the 5 unexposed `admin_ops.rs` functions to the Admin tab — all without touching any Pyth-feed code.

**Architecture:** The Rust handler in `create_etf.rs` absorbs the metadata-init logic formerly in `create_metadata.rs`, so `create_etf` takes three extra `String` args (`name`, `symbol`, `uri`) and performs both steps signed by the same transaction; `create_share_metadata` and its file are deleted. **Status: this Rust change (Task 1) and its test updates (Task 2) are already present, uncommitted, in the `c_vault` working tree as of 2026-07-06 — verify and commit them, don't redo the edits.** On the UI side, `function-defs.ts` drops the `feeds` tab/id and old `create_etf`/`create_share_metadata` function defs, adding a `VAULT_FUNCTIONS` array (merged create-vault + `set_fee_recipient`) rendered under a new `vault` tab; `ADMIN_FUNCTIONS` gains 5 new `admin_ops.rs`-backed entries and has its Emergency Exit/Resume entries fixed to call the real `set_emergency` instruction; `cvault.tsx` and `execute-vault-function.ts` are extended to wire all of this.

**Tech Stack:** Anchor (Rust) for the program in `c_vault/programs/vault`; mocha/chai + LiteSVM/surfpool for program tests in `c_vault/tests`; Next.js/React + `@coral-xyz/anchor` client in `c_vault_ui`.

## Global Constraints

- Do not modify anything related to Pyth feeds: `/api/pyth-feeds/*`, `FeedsPanel`, `feed-select-field.tsx`, `fetchFeeds`, `savedFeeds` plumbing, or any `type: "feed"` field definition.
- `create_share_metadata` is fully removed (not kept for backward compatibility) — this is an intentional breaking change to the on-chain interface.
- `set_paused` and `set_redeem_cooldown` stay in `ADMIN_FUNCTIONS` (not moved to Vault) — only vault *creation* and `set_fee_recipient` move to the Vault tab.
- `vault_ops::resume(vault_id)` (the per-vault, post-`set_paused` resume) is intentionally **not** exposed anywhere in the UI — do not add a button for it.
- Tab order after the change: View → Deposit → Redeem → Admin → Vault.
- Follow existing code conventions in each touched file (comment style, section-divider banners in Rust files, etc.) — don't introduce new patterns.

---


## Task 1: Merge the Rust handler (`create_etf` absorbs `create_share_metadata`) — VERIFY ONLY, already applied

**Files:**
- Modify (already done, uncommitted): `c_vault/programs/vault/src/vault/create_etf.rs`
- Modify (already done, uncommitted): `c_vault/programs/vault/src/vault/mod.rs`
- Delete (already done, uncommitted): `c_vault/programs/vault/src/vault/create_metadata.rs`
- Modify (already done, uncommitted): `c_vault/programs/vault/src/lib.rs`

**Interfaces:**
- Consumes: existing `crate::state::{AssetInfo, FundType, GlobalState, InitializeParams, Vault}`, `crate::constants::*`, `crate::errors::VaultError`.
- Produces: `pub fn create_etf_handler(ctx: Context<CreateEtf>, params: InitializeParams, name: String, symbol: String, uri: String) -> Result<()>` — the signature every later task (tests, IDL, TS clients) must match.

As of 2026-07-06, this merge is **already present as uncommitted changes** in the `c_vault` working tree (confirmed via `git status`/`git diff` — `create_metadata.rs` deleted, `create_etf.rs`/`mod.rs`/`lib.rs` modified to match this exact design). Do not re-apply the edits — only verify and commit them.

- [ ] **Step 1: Confirm the working tree has the expected changes**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && git status --short`

Expected output includes:
```
 M programs/vault/src/lib.rs
 M programs/vault/src/vault/create_etf.rs
D  programs/vault/src/vault/create_metadata.rs
 M programs/vault/src/vault/mod.rs
```
(other unrelated modified/untracked files from prior work may also be listed — ignore those, they are not part of this plan)

- [ ] **Step 2: Confirm `create_etf_handler`'s signature matches**

Run: `grep -n "pub fn create_etf_handler" /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault/programs/vault/src/vault/create_etf.rs`

Expected: `pub fn create_etf_handler(ctx: Context<CreateEtf>, params: InitializeParams, name: String, symbol: String, uri: String) -> Result<()> {` (4 params after `ctx`, matching the Interfaces block above).

- [ ] **Step 3: Build the program**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && anchor build`

Expected: build succeeds with no errors.

- [ ] **Step 4: Commit**

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

## Task 2: Update program tests for the merged instruction — VERIFY ONLY, already applied

**Files:**
- Modify (already done, uncommitted): `c_vault/tests/unit/utils/helpers.ts`
- Modify (already done, uncommitted): `c_vault/tests/unit/create_etf.test.ts`
- Modify (already done, uncommitted): `c_vault/tests/integration/utils/vault_env.ts`
- Delete (already done, uncommitted): `c_vault/tests/integration/create_share_metadata.test.ts`

**Interfaces:**
- Consumes: `program.methods.createEtf(params, name, symbol, uri)` (4-arg IDL method from Task 1).

As of 2026-07-06, these test updates are **already present as uncommitted changes** in the `c_vault` working tree (confirmed via `git status` — `create_share_metadata.test.ts` deleted, `create_etf.test.ts`/`vault_env.ts` modified; new untracked `tests/unit/deposit.test.ts` and `tests/unit/vault_ops.test.ts` files also exist from this same prior pass). Do not re-apply the edits — only verify, run, and commit them.

- [ ] **Step 1: Confirm no leftover `createShareMetadata` references**

Run: `grep -rln "createShareMetadata" /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault/tests`

Expected: no output.

- [ ] **Step 2: Run the unit test suite**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && anchor build && npx mocha -r ts-node/register tests/unit/create_etf.test.ts --timeout 60000`

Expected: all `create_etf (LiteSVM)` tests pass.

- [ ] **Step 3: Run the full test suite**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && anchor test`

Expected: all tests pass (unit + integration). If any pre-existing unrelated test fails (e.g. from the untracked `deposit.test.ts`/`vault_ops.test.ts` files not covered by this plan), note it but don't block on fixing tests outside this plan's scope — only ensure nothing here regresses `create_etf`-related coverage.

- [ ] **Step 4: Commit**

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

Note: `tests/unit/deposit.test.ts`, `tests/unit/vault_ops.test.ts`, and the modification to `tests/unit/admin_ops.test.ts` visible in `git status` are outside this plan's scope (not related to the create_etf/create_metadata merge) — leave them uncommitted for the user to handle separately, unless the user asks otherwise.

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


## Task 4: Verify the IDL/types vendored in `c_vault_ui` — VERIFY ONLY, already in sync

**Files:**
- Verify only: `c_vault_ui/idl/c_vault.json`

**Interfaces:**
- Consumes: `c_vault/target/idl/c_vault.json`, produced by `anchor build` in Task 1.
- Produces: confirmation that `c_vault_ui/idl/c_vault.json`'s `createEtf` instruction has 4 args (`params`, `name`, `symbol`, `uri`), no `createShareMetadata` entry, and already includes `set_fee_recipient`, `set_emergency`, `set_deposit_disable`, `add_eligible_base_mint`, `remove_eligible_base_mint`, `update_platform_fee_bps`, `update_treasury_addr` — all required by Task 5/6/10/11's TypeScript changes to type-check.

As of 2026-07-06, `c_vault_ui/idl/c_vault.json` was already confirmed (by direct inspection) to already reflect the merged `create_etf` and all of the `vault_ops.rs`/`admin_ops.rs` instructions this plan wires up. No copy is needed unless the Rust source changes again before this plan finishes executing.

- [ ] **Step 1: Confirm `createEtf` has 4 args and no `createShareMetadata` entry**

Run: `grep -A 3 '"name": "create_etf"' /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.json | head -5`

Then run: `python3 -c "import json; d = json.load(open('/Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.json')); names = [i['name'] for i in d['instructions']]; print('create_etf' in names, 'create_share_metadata' in names); ce = [i for i in d['instructions'] if i['name']=='create_etf'][0]; print([a['name'] for a in ce['args']])"`

Expected: `True False` on the first line, and `['params', 'name', 'symbol', 'uri']` on the second.

- [ ] **Step 2: Confirm the vault_ops/admin_ops instructions are present**

Run: `python3 -c "
import json
d = json.load(open('/Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.json'))
names = set(i['name'] for i in d['instructions'])
needed = {'set_fee_recipient','set_emergency','set_deposit_disable','add_eligible_base_mint','remove_eligible_base_mint','update_platform_fee_bps','update_treasury_addr'}
print(needed - names)
"`

Expected: `set()` (empty set — every needed instruction is present).

- [ ] **Step 3: If Step 1 or Step 2 fails, rebuild and copy**

Only if either check above fails: run `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault && anchor build`, then `cp target/idl/c_vault.json /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/idl/c_vault.json`, then re-run Steps 1-2 to confirm.

- [ ] **Step 4: Commit (only if Step 3 was needed and the file actually changed)**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git status --short idl/
```
If this shows `idl/c_vault.json` as modified, commit it:
```bash
git add idl/c_vault.json
git commit -m "Sync IDL: create_etf merge + vault_ops/admin_ops instructions"
```
If `git status --short idl/` shows no output, skip committing — the file was already correct and untouched.

---

## Task 5: Merge `createEtf`/`createShareMetadata`, add `setFeeRecipient` and the 5 `admin_ops.rs` client functions in `lib/cvault.tsx`

**Files:**
- Modify: `c_vault_ui/lib/cvault.tsx`

**Interfaces:**
- Consumes: `createProgram(wallet, connection)` (unchanged), `deriveGlobalStatePda()` and `deriveVaultPdas(vaultId)` from `./pda` (already imported), the IDL from Task 4.
- Produces:
  - `createEtf(connection, wallet, params: CreateEtfParams, name: string, symbol: string, uri: string, network): Promise<{ tx: string; link: string }>` — consumed by Task 7.
  - `setFeeRecipient(connection, wallet, vaultId: number, feeRecipient: PublicKey, network): Promise<{ tx: string; link: string }>` — consumed by Task 7.
  - `updateTreasuryAddr(connection, wallet, treasuryAddr: PublicKey, network)`, `updatePlatformFeeBps(connection, wallet, platformFeeBps: number, network)`, `setDepositDisable(connection, wallet, depositDisable: boolean, network)`, `addEligibleBaseMint(connection, wallet, mint: PublicKey, network)`, `removeEligibleBaseMint(connection, wallet, mint: PublicKey, network)` — all `Promise<{ tx: string; link: string }>`, all consumed by Task 7.
  - `globalAdminAccounts(admin: PublicKey)` — internal helper, not exported, used by the 5 functions above.

- [ ] **Step 1: Replace `createEtf`/`createShareMetadata` with the merged `createEtf`**

In `c_vault_ui/lib/cvault.tsx`, replace the `createEtf` and `createShareMetadata` functions (currently lines 128-160) with:

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

- [ ] **Step 2: Add a `globalAdminAccounts` helper next to the existing `adminAccounts` helper**

Immediately after the existing `adminAccounts` function (the one used by `emergencyExit`/`resume`/`setPaused`/`setRedeemCooldown` — it derives `{ globalState, vault, admin }`), add:

```typescript
function globalAdminAccounts(admin: PublicKey) {
  const globalState = deriveGlobalStatePda();
  return { globalState, admin } as any;
}
```

This is deliberately separate from `adminAccounts` (which also derives a `vault` PDA from a `vaultId`) — the 5 `admin_ops.rs` functions and `set_fee_recipient` operate on `AdminGlobalState`/`VaultManagerOnly` account contexts that don't need a `vault` PDA at all for the former, or need it keyed by `vaultId` for the latter (handled directly in `setFeeRecipient` itself, not through this helper).

- [ ] **Step 3: Add `setFeeRecipient`**

Immediately after `setRedeemCooldown` (the last function in the "Admin instructions" section, right before the "Core: deposit / request_redeem / claim" section divider comment), add:

```typescript
export async function setFeeRecipient(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  feeRecipient: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .setFeeRecipient(new BN(vaultId), feeRecipient)
    .accounts(adminAccounts(vaultId, wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}
```

- [ ] **Step 4: Add the 5 `admin_ops.rs` client functions**

Immediately after `setFeeRecipient` (still within the "Admin instructions" section), add:

```typescript
export async function updateTreasuryAddr(
  connection: Connection,
  wallet: AnchorWallet,
  treasuryAddr: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .updateTreasuryAddr(treasuryAddr)
    .accounts(globalAdminAccounts(wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function updatePlatformFeeBps(
  connection: Connection,
  wallet: AnchorWallet,
  platformFeeBps: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .updatePlatformFeeBps(new BN(platformFeeBps))
    .accounts(globalAdminAccounts(wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function setDepositDisable(
  connection: Connection,
  wallet: AnchorWallet,
  depositDisable: boolean,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .setDepositDisable(depositDisable)
    .accounts(globalAdminAccounts(wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function addEligibleBaseMint(
  connection: Connection,
  wallet: AnchorWallet,
  mint: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .addEligibleBaseMint(mint)
    .accounts(globalAdminAccounts(wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function removeEligibleBaseMint(
  connection: Connection,
  wallet: AnchorWallet,
  mint: PublicKey,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .removeEligibleBaseMint(mint)
    .accounts(globalAdminAccounts(wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}
```

- [ ] **Step 5: Fix `emergencyExit`/`resume` to call the real `set_emergency` instruction**

Find the existing `emergencyExit` and `resume` functions (they currently call `program.methods.emergencyExit(...)` and `program.methods.resume(...)` — the former doesn't exist on the IDL at all, the latter exists but is the *per-vault* `vault_ops::resume`, not what the Admin tab's "Resume" button should pair with). Replace both with:

```typescript
export async function emergencyExit(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .setEmergency(true)
    .accounts(globalAdminAccounts(wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}

export async function resume(
  connection: Connection,
  wallet: AnchorWallet,
  vaultId: number,
  network: Network,
) {
  const program = createProgram(wallet, connection);
  const sig = await program.methods
    .setEmergency(false)
    .accounts(globalAdminAccounts(wallet.publicKey))
    .rpc();
  return { tx: sig, link: solscanLink(sig, network) };
}
```

Both functions keep their existing `(connection, wallet, vaultId, network)` signature (so Task 7's existing call sites in `execute-vault-function.ts` don't need to change) even though `vaultId` is now unused in the body — this keeps the diff minimal and avoids touching the dispatch layer for a behavior-only fix. The unused `vaultId` parameter is intentional here, not an oversight — do not remove it.

- [ ] **Step 6: Type-check**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui && npx tsc --noEmit`

Expected: no errors originating from `lib/cvault.tsx`. Errors about `execute-vault-function.ts` still calling the old `createShareMetadata` (or not yet calling the new functions) are expected here — fixed in Task 7.

- [ ] **Step 7: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add lib/cvault.tsx
git commit -m "$(cat <<'EOF'
Merge createEtf/createShareMetadata; add setFeeRecipient + admin_ops.rs client functions

Also fixes emergencyExit/resume, which previously called a nonexistent
emergency_exit program method — they now call the real set_emergency(true/false).
EOF
)"
```

---

## Task 6: Update `function-defs.ts` — remove Feeds tab, add Vault tab, add missing vault_ops/admin_ops functions

**Files:**
- Modify: `c_vault_ui/app/components/function-defs.ts`

**Interfaces:**
- Consumes: `ADMIN_PUBKEY, WBTC_MINT, WSOL_USDC_POOL, WSOL_WBTC_POOL` from `@/lib/cvault` (already imported).
- Produces: `VAULT_FUNCTIONS: FunctionDef[]` (new export, 2 entries: `"create_etf"`, `"set_fee_recipient"`) and `SectionId = "view" | "deposit" | "redeem" | "vault" | "admin"` — both consumed by Task 8 (`page.tsx`) and Task 7 (`execute-vault-function.ts`). `ADMIN_FUNCTIONS` gains 5 new entries (`update_treasury_addr`, `update_platform_fee_bps`, `set_deposit_disable`, `add_eligible_base_mint`, `remove_eligible_base_mint`).

- [ ] **Step 1: Update `SectionId`**

In `c_vault_ui/app/components/function-defs.ts`, change:

```typescript
export type SectionId = "view" | "deposit" | "redeem" | "feeds" | "admin";
```

to:

```typescript
export type SectionId = "view" | "deposit" | "redeem" | "vault" | "admin";
```

- [ ] **Step 2: Remove `create_etf` (4B) and `create_share_metadata` (4C) from `ADMIN_FUNCTIONS`; fix Emergency Exit/Resume descriptions**

In `ADMIN_FUNCTIONS`, delete the two entries with `id: "create_etf"` (4B) and `id: "create_share_metadata"` (4C) entirely, leaving `init_global_state` (4A) immediately followed by `set_paused` (4D).

Update the `emergency_exit` (4E) and `resume` (4F) entries' `description` to reflect that they now correctly call `set_emergency` (the actual program instruction — previously these called a nonexistent `emergency_exit` method):

```typescript
  {
    id: "emergency_exit",
    number: "4E",
    title: "Emergency Exit",
    description:
      "Admin-only hard stop: sets global_state.is_emergency = true program-wide. Blocks new deposits until Resume is called.",
    fields: [],
    submitLabel: "Trigger Emergency Exit",
  },
  {
    id: "resume",
    number: "4F",
    title: "Resume from Emergency",
    description: "Clears global_state.is_emergency program-wide (sets it to false).",
    fields: [],
    submitLabel: "Resume",
  },
```

(Only the `description` text changes here — `id`, `number`, `fields: []`, and `submitLabel` all stay exactly as they were. The client-side behavior fix happens in Task 7.)

- [ ] **Step 3: Add 5 new `admin_ops.rs`-backed entries to `ADMIN_FUNCTIONS`**

Immediately after the `set_redeem_cooldown` (4G) entry — the last entry in `ADMIN_FUNCTIONS` — and still inside the array (before its closing `];`), add:

```typescript
  {
    id: "update_treasury_addr",
    number: "4H",
    title: "Update Treasury Address",
    description: "Program-wide: change the pubkey that receives the platform's treasury funds.",
    fields: [
      { name: "treasury_addr", label: "New Treasury Address", placeholder: ADMIN_PUBKEY.toBase58() },
    ],
    submitLabel: "Update Treasury Address",
  },
  {
    id: "update_platform_fee_bps",
    number: "4I",
    title: "Update Platform Fee (BPS)",
    description: "Program-wide: change the platform fee taken on deposit + claim (max 2000 bps = 20%).",
    fields: [
      {
        name: "platform_fee_bps",
        label: "Platform Fee (BPS, max 2000)",
        type: "number",
        placeholder: "500",
      },
    ],
    submitLabel: "Update Platform Fee",
  },
  {
    id: "set_deposit_disable",
    number: "4J",
    title: "Set Deposit Disable",
    description: "Program-wide: block or unblock all new deposits (separate from emergency mode).",
    fields: [
      {
        name: "deposit_disable",
        label: "Deposit Disabled?",
        type: "select",
        options: [
          { label: "true", value: "true" },
          { label: "false", value: "false" },
        ],
      },
    ],
    submitLabel: "Set Deposit Disable",
  },
  {
    id: "add_eligible_base_mint",
    number: "4K",
    title: "Add Eligible Base Mint",
    description: "Program-wide: add a company-approved stable mint to the eligible base_mint allowlist (max 10).",
    fields: [
      { name: "mint", label: "Mint Address", placeholder: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    ],
    submitLabel: "Add Eligible Base Mint",
  },
  {
    id: "remove_eligible_base_mint",
    number: "4L",
    title: "Remove Eligible Base Mint",
    description: "Program-wide: remove a mint from the eligible base_mint allowlist.",
    fields: [
      { name: "mint", label: "Mint Address", placeholder: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
    ],
    submitLabel: "Remove Eligible Base Mint",
  },
```

- [ ] **Step 4: Add `VAULT_FUNCTIONS` with both `create_etf` and `set_fee_recipient`**

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
  {
    id: "set_fee_recipient",
    number: "5B",
    title: "Set Fee Recipient",
    description: "Vault-manager-only: change the pubkey that receives this vault's accrued performance fees.",
    fields: [
      { name: "fee_recipient", label: "New Fee Recipient", placeholder: ADMIN_PUBKEY.toBase58() },
    ],
    submitLabel: "Set Fee Recipient",
  },
];
```

- [ ] **Step 5: Update `REQUIRES_WALLET`**

Replace the `REQUIRES_WALLET` set to add `"set_fee_recipient"` and the 5 new admin_ops ids (remove `"create_share_metadata"`, keep everything else):

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
  "set_fee_recipient",
  "set_paused",
  "emergency_exit",
  "resume",
  "set_redeem_cooldown",
  "update_treasury_addr",
  "update_platform_fee_bps",
  "set_deposit_disable",
  "add_eligible_base_mint",
  "remove_eligible_base_mint",
]);
```

- [ ] **Step 6: Update `TABS`**

Replace the `TABS` array:

```typescript
export const TABS: { id: SectionId; label: string; eyebrow: string }[] = [
  { id: "view", label: "View", eyebrow: "READ" },
  { id: "deposit", label: "Deposit", eyebrow: "INFLOW" },
  { id: "redeem", label: "Redeem", eyebrow: "OUTFLOW" },
  { id: "admin", label: "Admin", eyebrow: "CONTROL" },
  { id: "vault", label: "Vault", eyebrow: "VAULT OPS" },
];
```

- [ ] **Step 7: Update `SECTION_EYEBROWS`**

Replace the `SECTION_EYEBROWS` object:

```typescript
export const SECTION_EYEBROWS: Record<SectionId, string> = {
  view: "/// READ STATE",
  deposit: "/// INFLOW OPS",
  redeem: "/// OUTFLOW OPS",
  admin: "/// ADMIN CONTROL",
  vault: "/// VAULT OPS",
};
```

- [ ] **Step 8: Verify no leftover reference to `"feeds"` as a `SectionId`, and that both new arrays are exported**

Run: `grep -n '"feeds"' /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/app/components/function-defs.ts`

Expected: no output.

Run: `grep -n "export const VAULT_FUNCTIONS\|export const ADMIN_FUNCTIONS" /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui/app/components/function-defs.ts`

Expected: both lines present.

- [ ] **Step 9: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add app/components/function-defs.ts
git commit -m "$(cat <<'EOF'
Replace Feeds tab with Vault tab; expose vault_ops/admin_ops functions

- Vault tab: merged create_etf (create_etf + create_share_metadata) plus
  the previously-unexposed set_fee_recipient.
- Admin tab: fix Emergency Exit/Resume descriptions (they call
  set_emergency, not a nonexistent emergency_exit method) and add the 5
  previously-unexposed admin_ops.rs functions.
EOF
)"
```

---

## Task 7: Wire the merged + new calls in `execute-vault-function.ts`

**Files:**
- Modify: `c_vault_ui/app/components/execute-vault-function.ts`

**Interfaces:**
- Consumes: `createEtf(connection, anchorWallet, params, name, symbol, uri, network)`, `setFeeRecipient(connection, anchorWallet, vaultId, feeRecipient, network)`, `updateTreasuryAddr`, `updatePlatformFeeBps`, `setDepositDisable`, `addEligibleBaseMint`, `removeEligibleBaseMint` (all from Task 5). `fn.id` values `"create_etf"`, `"set_fee_recipient"`, `"update_treasury_addr"`, `"update_platform_fee_bps"`, `"set_deposit_disable"`, `"add_eligible_base_mint"`, `"remove_eligible_base_mint"` (all from Task 6's `VAULT_FUNCTIONS`/`ADMIN_FUNCTIONS`).

- [ ] **Step 1: Remove the `createShareMetadata` import, add the new function imports**

In `c_vault_ui/app/components/execute-vault-function.ts`, replace the import block's admin-instruction names:

```typescript
import {
  initGlobalState,
  createEtf,
  createShareMetadata,
  emergencyExit,
  resume,
  setPaused,
  setRedeemCooldown,
  deposit,
  requestRedeem,
  claim,
  swapUsdcToSol,
  swapUsdcToAsset,
  swapSolToAsset,
  swapAssetToSol,
  swapSolToUsdc,
  swapAssetToUsdc,
  getGlobalState,
  getVaultState,
  getTotalNavView,
  previewDeposit,
  previewRedeem,
  getUserPosition,
  ensureUserAtas,
  DEFAULT_VAULT_ID,
  ADMIN_PUBKEY,
  type Network,
} from "@/lib/cvault";
```

with:

```typescript
import {
  initGlobalState,
  createEtf,
  setFeeRecipient,
  emergencyExit,
  resume,
  setPaused,
  setRedeemCooldown,
  updateTreasuryAddr,
  updatePlatformFeeBps,
  setDepositDisable,
  addEligibleBaseMint,
  removeEligibleBaseMint,
  deposit,
  requestRedeem,
  claim,
  swapUsdcToSol,
  swapUsdcToAsset,
  swapSolToAsset,
  swapAssetToSol,
  swapSolToUsdc,
  swapAssetToUsdc,
  getGlobalState,
  getVaultState,
  getTotalNavView,
  previewDeposit,
  previewRedeem,
  getUserPosition,
  ensureUserAtas,
  DEFAULT_VAULT_ID,
  ADMIN_PUBKEY,
  type Network,
} from "@/lib/cvault";
```

- [ ] **Step 2: Update the `create_etf` branch to pass name/symbol/uri; delete the `create_share_metadata` branch**

Replace the existing `if (fn.id === "create_etf") { ... }` block and the `if (fn.id === "create_share_metadata") { ... }` block immediately after it with:

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
  if (fn.id === "set_fee_recipient") {
    if (!anchorWallet) throw new Error("Wallet required");
    const r = await setFeeRecipient(
      connection,
      anchorWallet,
      DEFAULT_VAULT_ID,
      pk(v.fee_recipient),
      net,
    );
    return { tx: r.tx, solscan: r.link };
  }
```

- [ ] **Step 3: Add dispatch branches for the 5 new admin_ops functions**

Immediately after the `if (fn.id === "set_redeem_cooldown") { ... }` block (the last function-dispatch block in the file, right before `throw new Error(\`Unknown function: ${fn.id}\`);`), add:

```typescript
  if (fn.id === "update_treasury_addr") {
    if (!anchorWallet) throw new Error("Wallet required");
    const r = await updateTreasuryAddr(connection, anchorWallet, pk(v.treasury_addr), net);
    return { tx: r.tx, solscan: r.link };
  }
  if (fn.id === "update_platform_fee_bps") {
    if (!anchorWallet) throw new Error("Wallet required");
    const r = await updatePlatformFeeBps(
      connection,
      anchorWallet,
      Number(v.platform_fee_bps || 0),
      net,
    );
    return { tx: r.tx, solscan: r.link };
  }
  if (fn.id === "set_deposit_disable") {
    if (!anchorWallet) throw new Error("Wallet required");
    const r = await setDepositDisable(connection, anchorWallet, v.deposit_disable === "true", net);
    return { tx: r.tx, solscan: r.link };
  }
  if (fn.id === "add_eligible_base_mint") {
    if (!anchorWallet) throw new Error("Wallet required");
    const r = await addEligibleBaseMint(connection, anchorWallet, pk(v.mint), net);
    return { tx: r.tx, solscan: r.link };
  }
  if (fn.id === "remove_eligible_base_mint") {
    if (!anchorWallet) throw new Error("Wallet required");
    const r = await removeEligibleBaseMint(connection, anchorWallet, pk(v.mint), net);
    return { tx: r.tx, solscan: r.link };
  }
```

- [ ] **Step 4: Type-check**

Run: `cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui && npx tsc --noEmit`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd /Users/soumalyapaul/Documents/SOLANA/c_vault_all/c_vault_ui
git add app/components/execute-vault-function.ts
git commit -m "Wire merged create_etf, set_fee_recipient, and admin_ops.rs calls in execute-vault-function"
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

- [ ] **Step 4: Exercise `set_fee_recipient` and the fixed Emergency Exit/Resume pair**

Still in the browser (Vault tab): use "Set Fee Recipient" (5B) to change the vault's fee recipient to a new address; confirm via the "View Vault State" (1B) that `feeRecipient` updated on-chain.

Then in the Admin tab: click "Emergency Exit" and confirm via "View Global State" (1A) that `isEmergency` is now `true`; click "Resume" and confirm `isEmergency` is back to `false`. This exercises the fix from Task 5 Step 5 (previously "Emergency Exit" called a nonexistent program method and would have failed outright).

- [ ] **Step 5: Exercise the 5 new admin_ops.rs functions**

Still in the Admin tab: try "Update Platform Fee (BPS)" with a small value (e.g. `500`) and "Set Deposit Disable" with `true` then `false` — both should confirm without error (no on-chain view currently surfaces `platformFeeBps`/`depositDisable`, so success is "transaction confirms, no thrown error"). Try "Add Eligible Base Mint" with a fresh test mint address, then "Remove Eligible Base Mint" with the same address, confirming each transaction succeeds. Skip "Update Treasury Address" unless you have a throwaway address to set it to (it's a real state change with no easy undo path beyond calling it again).

- [ ] **Step 6: Stop the local validator**

```bash
pkill -f solana-test-validator
```

- [ ] **Step 7: No commit needed** — this task is manual verification only; if any bug surfaces, fix it in the relevant task's files and re-run this task.

---

## Self-Review Notes

- **Spec coverage:** Task 1-3 cover the Rust merge + tests + changelog (spec §"Program change" and §"Tests" and §"CHANGELOG.md"). Task 4 covers IDL sync (spec §"IDL / generated types"), now verify-only since the IDL was already confirmed in sync. Tasks 5-8 cover all four UI files named in the spec (`cvault.tsx`, `function-defs.ts`, `execute-vault-function.ts`, `page.tsx`) plus the addendum's `set_fee_recipient`/`admin_ops.rs`/Emergency-Exit-fix scope. Task 9 covers the spec's "Testing plan" section (manual localnet exercise + metadata confirmation) extended with the addendum's new functions. The spec's explicit call-out about the unauthorized-signer test collapsing is handled in Task 2 Step 4 (folded into the "already applied" verify step, since that test change is also already present in the working tree).
- **Placeholder scan:** no TBD/TODO. Task 1/2/4 are now explicitly marked "VERIFY ONLY, already applied" rather than left ambiguous about whether to redo work that's already done.
- **Type consistency:** `createEtf(connection, wallet, params, name, symbol, uri, network)` signature is identical across Task 5 (definition) and Task 7 (call site). `create_etf_handler(ctx, params, name, symbol, uri)` matches between Task 1's verification grep and Task 5's client call. `VAULT_FUNCTIONS`/`ADMIN_FUNCTIONS` names match between Task 6 (definition) and Task 8 (import/usage). `setFeeRecipient`, `updateTreasuryAddr`, `updatePlatformFeeBps`, `setDepositDisable`, `addEligibleBaseMint`, `removeEligibleBaseMint` signatures are identical between Task 5 (definition) and Task 7 (call site). `emergencyExit`/`resume` keep their original `(connection, wallet, vaultId, network)` signature across Task 5 (redefinition) and Task 7 (unchanged call sites, not touched in this pass since they weren't in the diff).

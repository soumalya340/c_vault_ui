# Vault section + merged create_etf/create_metadata — Design

Date: 2026-07-06

## Summary

Two changes, one unit of work:

1. **Program (`c_vault`)**: merge the `create_etf` and `create_share_metadata`
   instructions into a single `create_etf` instruction, so a new vault and its
   Token-2022 share metadata are created in one transaction instead of two.
   Old `create_share_metadata` instruction is removed.
2. **UI (`c_vault_ui`)**: remove the standalone "Feeds" tab (Pyth oracle feed
   manager) from the console nav, replacing that tab slot with a new "Vault"
   tab that hosts vault-creation (the merged instruction above). All other
   Pyth/feeds code (API routes, DB, `FeedsPanel`, `feed-select-field`,
   `type: "feed"` fields elsewhere) is left completely untouched — only the
   nav entry for "Feeds" is removed.

## Out of scope

- No changes to `/api/pyth-feeds/*`, the feeds DB/store, `FeedsPanel`,
  `feed-select-field.tsx`, or any `type: "feed"` field in View/Deposit/Redeem
  forms.
- No regrouping of other Admin functions (`init_global_state`, `set_paused`,
  `emergency_exit`, `resume`, `set_redeem_cooldown`) — they stay in Admin.
- No changes to deposit/redeem/swap instructions.

## Program change: `c_vault/programs/vault/src/vault/`

### `create_etf_handler`

Extend the existing handler in `create_etf.rs` to also perform the Token-2022
metadata init that currently lives in `create_metadata.rs`:

- New instruction signature:
  `create_etf(ctx: Context<CreateEtf>, params: InitializeParams, name: String, symbol: String, uri: String) -> Result<()>`
- After the existing vault/mint initialization logic completes (share mint
  created + metadata pointer initialized + mint initialized + `Vault` account
  populated + `global_state.total_vaults` incremented), append the metadata
  step ported from `create_share_metadata_handler`:
  - Build `TokenMetadata` struct, compute `try_get_new_account_len_for_variable_len_extension`,
    top up rent via `system_program::transfer` from `authority` if needed.
  - Call `token_metadata_initialize` CPI signed by the `vault_authority` PDA
    (same seeds already derived in the handler for the mint creation step).
  - Emit `ShareMetadataCreatedEvent` (kept as-is, still useful for indexers).
- `authority` already becomes `vault.vault_manager` earlier in the same
  handler, so there's no separate vault-manager signer needed for the
  metadata step — it signs once as part of the single transaction.

### `CreateEtf` Accounts struct

No new accounts needed. `create_share_metadata`'s account list (`vault`,
`vault_authority`, `shares_mint`, `vault_manager`/`system_program`) is already
a subset of what `CreateEtf` declares, since `vault_authority` and
`shares_mint` are already present and `authority` doubles as payer/manager.

### Files removed

- `c_vault/programs/vault/src/vault/create_metadata.rs` — deleted.
- `c_vault/programs/vault/src/vault/mod.rs` — drop `create_metadata` module
  and its re-export.
- `c_vault/programs/vault/src/lib.rs` — remove the `create_share_metadata`
  `#[program]` entrypoint; update the `create_etf` entrypoint's signature and
  doc comment.

### Tests

- `c_vault/tests/unit/create_etf.test.ts` (LiteSVM): update all `createEtf(...)`
  calls to pass `name`/`symbol`/`uri`; add assertions currently covered by
  `create_share_metadata.test.ts`'s happy path (Token-2022 metadata fields
  correct) directly into the create_etf success case.
- `c_vault/tests/integration/create_share_metadata.test.ts` — delete. Port its
  two cases into `create_etf.test.ts`/relevant integration test:
  - happy path: metadata fields match what was passed to `create_etf`
    (already covered once merged — no separate call needed).
  - unauthorized-signer guard: re-express as "someone other than the
    transaction's `authority` cannot have created the vault with attacker
    metadata" — since there's no longer a separate `vault_manager` signer
    check on a second instruction, this guard collapses into normal
    transaction-signing semantics (whoever signs `create_etf` sets the
    metadata). Drop the test if it no longer expresses a distinct guard;
    note this explicitly in the test file if removed.
- `c_vault/tests/integration/utils/vault_env.ts` — update `createTestEtf`
  and `testEtfParams` (or its call site) to include name/symbol/uri args.
- `c_vault/tests/unit/utils/helpers.ts` — update `makeSimpleEtfParams`
  call sites the same way.

### CHANGELOG.md

Add a `### Changed` entry noting `create_etf` and `create_share_metadata`
were merged into a single instruction (breaking change).

## UI change: `c_vault_ui/`

### `app/components/function-defs.ts`

- `SectionId`: `"view" | "deposit" | "redeem" | "vault" | "admin"` (drop
  `"feeds"`, add `"vault"`).
- New `VAULT_FUNCTIONS: FunctionDef[]` containing one merged function def,
  id `create_etf`, whose `fields` is the union of the current `create_etf`
  (4B) and `create_share_metadata` (4C) fields: fee recipient, performance
  fee bps, usdc/sol pool, assets json, fund type, max assets, max shares,
  name, symbol, uri.
- Remove the old `create_etf` (4B) and `create_share_metadata` (4C) entries
  from `ADMIN_FUNCTIONS`.
- `TABS`: replace the `feeds` entry with
  `{ id: "vault", label: "Vault", eyebrow: "VAULT OPS" }`, keeping array
  order View → Deposit → Redeem → Admin → Vault (Vault takes the trailing
  slot where Feeds was, per approved preview).
- `SECTION_EYEBROWS`: replace `feeds: "/// PYTH FEEDS"` with
  `vault: "/// VAULT OPS"`.
- `REQUIRES_WALLET`: unchanged (`create_etf` id already present; no new ids
  since `create_share_metadata` id is removed).

### `app/page.tsx`

- Remove the `FeedsPanel` import and its render branch
  (`{activeTab === 'feeds' && <FeedsPanel .../>}`).
- Add `{activeTab === 'vault' && <SectionBlock id="vault" label="Vault" functions={VAULT_FUNCTIONS} network={network} savedFeeds={savedFeeds} />}`.
- `savedFeeds`/`loadFeeds` plumbing stays exactly as-is (still needed by the
  `feed`-type fields used elsewhere) — not touched.

### `app/components/execute-vault-function.ts`

- Replace the separate `fn.id === "create_etf"` and
  `fn.id === "create_share_metadata"` branches with one `create_etf` branch
  that parses `assets_json` as before, and calls the new single `createEtf(...)`
  passing `name`, `symbol`, `uri` alongside the existing params.

### `lib/cvault.tsx`

- Merge `createEtf` and `createShareMetadata` into one `createEtf(...)`
  function matching the new on-chain instruction: same params object plus
  `name: string, symbol: string, uri: string` args, single `.rpc()` call.
- Remove the standalone `createShareMetadata` export.

### IDL / generated types

- `c_vault_ui/idl/` (wherever the IDL JSON/types are vendored) needs to be
  regenerated/copied from the program build after the Rust change, since the
  `createEtf` method signature and the removal of `createShareMetadata`
  change the IDL shape that `@coral-xyz/anchor`'s `program.methods` relies on.

## Data flow after change

```
User fills "Vault" tab form (fee recipient, fee bps, pool, assets json,
fund type, max assets/shares, name, symbol, uri)
  → execute-vault-function.ts: fn.id === "create_etf"
  → lib/cvault.tsx: createEtf(connection, wallet, params, name, symbol, uri, network)
  → program.methods.createEtf(params, name, symbol, uri).accounts({...}).rpc()
  → on-chain: create_etf_handler — creates vault + share mint + sets
    Token-2022 metadata, all in one transaction
```

## Testing plan

- Rust: `anchor build` compiles cleanly; run `c_vault`'s existing test suite
  (unit LiteSVM + integration) after updating call sites; confirm the merged
  happy-path assertions (vault created + metadata fields correct) pass.
- UI: `npm run build`/`tsc` type-checks cleanly against the regenerated IDL;
  manually exercise the "Vault" tab against localnet — fill the form, submit,
  confirm a single transaction creates the vault with correct on-chain
  metadata (name/symbol/uri visible via `getTokenMetadata`).
- Confirm the "Feeds" tab button no longer appears in nav, and no other tab
  regresses (View/Deposit/Redeem/Admin unaffected, `feed`-type fields still
  work using the untouched `savedFeeds`/`FeedsPanel` plumbing).

## Addendum (2026-07-06): expand UI coverage of vault_ops.rs and admin.rs

While implementing the plan above, the Rust-side `create_etf`/`create_metadata`
merge (Task 1/2) was found already applied in the working tree, matching this
spec. Separately, a gap was found: the UI's Admin tab does not expose all
program instructions that already exist in
`c_vault/programs/vault/src/vault/vault_ops.rs` and
`c_vault/programs/vault/src/admin/`. This addendum extends scope to close
that gap in the same pass.

### vault_ops.rs gap

`vault_ops.rs` defines 4 functions on the `VaultManagerOnly` account context
(`vault_id: u64` + `vault_manager: Signer` matching `vault.vault_manager`):
`resume`, `set_paused`, `set_fee_recipient`, `set_redeem_cooldown`. The UI
already wires `set_paused` and `set_redeem_cooldown` correctly. It's missing
`set_fee_recipient` entirely, and its "Emergency Exit"/"Resume" buttons call
a `emergencyExit` client function that invokes a program method
(`emergency_exit`) that **does not exist** in `lib.rs` — this is a
pre-existing bug, not something introduced by this work.

Decisions:
- Add `set_fee_recipient(vault_id, fee_recipient)` as a new function in the
  **Vault** tab (it's vault-scoped admin, alongside vault creation).
- Fix "Emergency Exit" to call the real `set_emergency(true)` program method
  (program-wide), and fix "Resume" to call `set_emergency(false)` (the
  symmetric global counterpart) — both live in `admin_ops.rs`'s
  `AdminGlobalState` context (`global_state` + `admin: Signer` matching
  `ADMIN_PUBKEY` exactly, no `vault_id`).
- `vault_ops::resume(vault_id)` (the per-vault, post-`set_paused` resume) is
  **not** exposed in the UI for now — there's no matching "pause a specific
  vault and later resume it" UI flow to hang it off, since `set_paused`
  already exists as a direct toggle. Leaving it unexposed is an explicit
  choice, not an oversight.

### admin.rs gap

`admin_ops.rs` defines 5 functions on the `AdminGlobalState` account context
(`global_state` + `admin: Signer` constrained to `ADMIN_PUBKEY`), none of
which have any UI today: `update_treasury_addr`, `update_platform_fee_bps`,
`set_deposit_disable`, `add_eligible_base_mint`, `remove_eligible_base_mint`.

Decision: add all 5 to the **Admin** tab, alongside the existing
`init_global_state`/`set_paused` (wait — `set_paused`/`set_redeem_cooldown`
stay put per the original scope decision; only the fixed
`emergency_exit`/`resume` pair and these 5 new entries are Admin-tab
additions).

### Updated Admin tab contents (after this addendum)

```
Admin:
  Init Global State           (unchanged: init_global_state)
  Set Paused                  (unchanged: set_paused, vault-scoped)
  Emergency Exit               [FIXED] -> set_emergency(true)
  Resume                       [FIXED] -> set_emergency(false)
  Set Redeem Cooldown          (unchanged: set_redeem_cooldown, vault-scoped)
  Update Treasury Address      [NEW]   -> update_treasury_addr(treasury_addr)
  Update Platform Fee (BPS)    [NEW]   -> update_platform_fee_bps(platform_fee_bps)
  Set Deposit Disable          [NEW]   -> set_deposit_disable(deposit_disable)
  Add Eligible Base Mint       [NEW]   -> add_eligible_base_mint(mint)
  Remove Eligible Base Mint    [NEW]   -> remove_eligible_base_mint(mint)
```

### Updated Vault tab contents (after this addendum)

```
Vault:
  Create Vault           (unchanged from original design: merged create_etf)
  Set Fee Recipient       [NEW] -> set_fee_recipient(vault_id, fee_recipient)
```

### Account-wiring notes for implementation

- `set_fee_recipient`, like the existing `set_paused`/`set_redeem_cooldown`,
  uses `adminAccounts(vaultId, admin)` in `cvault.tsx` — same
  `{ globalState, vault: vaultPda, admin }` shape already used by those two
  (despite the helper's name, it's really "vault-manager accounts": the IDL
  calls this signer `vault_manager`, constrained to equal `vault.vault_manager`,
  not the program's `ADMIN_PUBKEY`).
- The 5 `admin_ops.rs` functions and the fixed `set_emergency` calls use a
  **different**, simpler account shape: just `{ globalState, admin }` where
  `admin` is constrained to the hardcoded `ADMIN_PUBKEY` — no `vault_id`,
  no `vaultPda`. This needs its own small helper (e.g.
  `globalAdminAccounts(admin: PublicKey)`) distinct from `adminAccounts`.
- IDL: already regenerated and vendored at `c_vault_ui/idl/c_vault.json`
  reflecting all of the above (`create_etf` with `name`/`symbol`/`uri`, and
  `set_fee_recipient`/`set_emergency`/`set_deposit_disable`/
  `add_eligible_base_mint`/`remove_eligible_base_mint`/
  `update_platform_fee_bps`/`update_treasury_addr` all present, no
  `create_share_metadata`). Task 4 (IDL sync) of the implementation plan is
  effectively already satisfied — verify only, no copy needed, unless the
  Rust source changes further before implementation finishes.

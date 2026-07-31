# BUG: Vault permanently bricked after full redemption to 0 shares

## Status
Open — root cause identified, fix not yet implemented (pending decision on recovery strategy).

## Symptom
User deposits into a vault that previously had its genesis deposit fully redeemed
(`total_shares == 0`). The `deposit` instruction is refused on-chain for *any*
amount entered:

```
TRANSACTION · REFUSED
Amount must be greater than zero
The program rejected a zero amount.

Instruction  Deposit
Code         ZeroAmount · 6000 (0x1770)
```

This happens regardless of how much USDC the user enters — the deposit UI
correctly rejects a literal 0 amount client-side, so the on-chain rejection is
for a *different*, internally-computed zero, not the user's input.

## Root cause

File: `programs/vault/src/instructions/vault_core/deposit.rs`
File: `programs/vault/src/pricing/calculate_nav.rs`
File: `programs/vault/src/account_state/state.rs`

1. `genesis_deposit_handler` sets `vault.genesis_done = true` via
   `set_genesis_done(true)` (`deposit.rs:87`). This flag is a **one-way
   latch** — nothing in the program ever sets it back to `false`
   (`state.rs:170-178`).

2. `redeem_handler` (`redeem.rs`) allows a user to redeem shares all the way
   down to `total_shares == 0`. The only guards are `require!(shares > 0,
   ZeroAmount)` and `InsufficientShares` (`redeem.rs:46,53`) — there is no
   floor preventing the *last* redeemer from draining `total_shares` to
   exactly 0.

3. `deposit_handler`'s only "has this vault been initialized" guard is:
   ```rust
   require!(vault.is_genesis_done(), VaultError::GenesisNotSeeded);
   ```
   (`deposit.rs:218`). This checks the one-way latch, **not**
   `total_shares > 0`. After a full drain, `genesis_done` is still `true`,
   so this guard passes.

4. Execution reaches `compute_shares_to_mint`
   (`calculate_nav.rs:125-149`):
   ```rust
   let shares = (usdc_deposit as u128)
       .checked_mul(total_shares as u128)   // total_shares == 0
       .ok_or(VaultError::MathOverflow)?
       .checked_div(total_nav as u128)
       .ok_or(VaultError::MathOverflow)? as u64;
   ```
   With `total_shares == 0`, `shares` is **always 0**, no matter what
   `usdc_deposit` is.

5. Back in `deposit_handler` (`deposit.rs:291`):
   ```rust
   require!(shares_to_mint > 0, VaultError::ZeroAmount);
   ```
   This always fires → the `ZeroAmount · 6000` error seen in the UI.

## Why the vault can't recover on its own

- `deposit` can never succeed once `total_shares == 0`, for any input amount
  (step 4 above always yields 0 shares).
- `genesis_deposit` also can't be re-run to reseed the vault, because it
  requires:
  ```rust
  require!(!vault.is_genesis_done(), VaultError::GenesisAlreadySeeded);
  ```
  (`deposit.rs:43`), and `genesis_done` is permanently `true` after the
  first seed.

**Net effect: once a vault is drained to exactly 0 shares, it is permanently
bricked** — no further deposits or genesis reseed are possible through any
existing instruction.

## Reproduction

1. Admin/vault manager calls `genesis_deposit` on a fresh vault
   (`genesis_done: false → true`, `total_shares: 0 → X`).
2. Holder(s) redeem 100% of outstanding shares via `redeem`
   (`total_shares: X → 0`; `genesis_done` remains `true`).
3. Any user calls `deposit` with any nonzero `usdc_amount`.
4. Transaction fails with `ZeroAmount (6000)` on the `Deposit` instruction,
   as shown in the UI's "Transaction Refused" dialog.

## Candidate fixes (not yet chosen/implemented)

1. **Prevent full drain in `redeem`** — add a floor so the last redeemer
   cannot burn `total_shares` down to exactly 0 (e.g. require an explicit
   "close vault" path instead of allowing organic drain to zero).
2. **Allow re-genesis after full drain** — when `redeem` burns
   `total_shares` to 0, reset `vault.genesis_done = false` so
   `genesis_deposit` can be called again to reseed the vault.
3. **Make `deposit` self-heal when `total_shares == 0`** — detect this case
   inside `deposit_handler` and fall back to genesis-style reverse-price
   share calculation instead of the proportional formula, so a normal user
   deposit revives the vault without a separate admin action.

Each option has different implications for existing invariants (e.g.
`VaultNotEmpty` / `delete_etf` logic, tests in `tests/genesis_seed.rs` and
`tests/calculate_nav_test.rs` that assume `total_shares == 0` means
"pre-genesis"). Needs a decision before implementation.

## Affected files
- `programs/vault/src/instructions/vault_core/deposit.rs`
- `programs/vault/src/instructions/vault_core/redeem.rs`
- `programs/vault/src/pricing/calculate_nav.rs`
- `programs/vault/src/account_state/state.rs`

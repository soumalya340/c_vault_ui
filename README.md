# C-Vault

Multi-asset ETF vault protocol on Solana. Users deposit USDC into vaults that hold a basket of assets; share tokens track proportional ownership of the vault's NAV.

## Actors

There are three roles on-chain:

| Actor                       | Who               | What they do                                                                       |
| --------------------------- | ----------------- | ---------------------------------------------------------------------------------- |
| **Admin (company)**         | Protocol operator | Bootstraps the program, lists assets, sets global safety rails, can lock any vault |
| **Vault creator (manager)** | Fund issuer       | Creates an ETF vault, pauses deposits, sets fee recipient, seeds genesis           |
| **End user (investor)**     | Depositor         | Deposits USDC, redeems shares, claims USDC — no admin power                        |

Permissionless swap legs and a TWAP keeper sit outside these three roles and keep vaults operational without privileged keys.

---

## Admin (company)

Top-level operator. Controls program-wide config, the asset catalog, and emergency controls. Must run `init_global_state` once before anything else works.

### `init_global_state`

Creates the `GlobalState` singleton and the wSOL genesis asset (id `0`) in one transaction. **Must be called once** before any vault is created. Passes SOL asset params for the genesis listing.

### `create_asset`

Lists a new global asset (mint, pool, venue, Pyth feed, route). Pool / TVL / ownership checks run at listing time; vaults later reference the asset by id only.

### `set_asset_active`

Activates or deactivates a listed asset. Deactivation only blocks **new** `create_etf` inclusion — vaults that already hold the asset are unaffected.

### `update_treasury_addr`

Sets the program-wide treasury recipient that receives protocol fees.

### `set_emergency`

Turns global emergency mode on or off. When on, **new deposits are blocked program-wide**. Withdrawals / redemptions stay open.

### `set_vault_emergency_lock`

Locks or unlocks **deposits for a single vault**. Independent of the vault manager's own `set_paused`. Redemptions always remain open.

### `set_twap_keeper`

Assigns (or clears via `Pubkey::default()`) the wallet allowed to call `update_dex_twap`.

---

## Vault creator (manager)

Creates and operates one or more ETF funds. Does not control global asset listings or program-wide emergency mode.

### `create_etf`

Creates a new ETF fund vault and its Token-2022 share mint metadata in one transaction. Vault id is always `global_state.total_vaults` (counter increments after init). Params include basket composition, fees, share cap mode, etc., plus share `name` / `symbol` / `uri`.

### `genesis_deposit`

One-time seed: **1 USDC, no fee**, pins `baseline_share_price`. Callable by **admin or vault manager**. Vault must have `total_shares == 0`. Required before normal deposits so share pricing has a baseline.

### `set_paused`

Pauses or unpauses **deposits for this vault**. Withdrawals always stay open. Manager-level control (admin can still use `set_vault_emergency_lock` separately).

### `set_fee_recipient`

Updates the pubkey that receives accrued **performance fees** for this vault.

---

## End user (investor)

Only invests and exits. No vault creation, no asset listing, no emergency toggles.

### `deposit`

Transfers USDC, prices shares against pre-swap NAV, mints share tokens. Must be followed by per-asset swap legs in the **same transaction** so idle USDC is deployed into the basket. For `Fixed` vaults near `max_shares`, the deposit is clamped to remaining headroom rather than rejected. Slippage protected via `min_shares_out`.

### `request_redeem`

**Step 1 of 3.** Burns shares, records proportional asset amounts owed, starts a **24-hour cooldown**. Opens a `RedeemState` for the user.

### `claim`

**Step 3 of 3.** After cooldown and all asset→USDC swap legs, sends pending USDC to the user and closes `RedeemState`.

### Read-only views (no signature)

Call with `.view()` from the TypeScript client — wallet signature not required.

| Instruction          | Returns                                             |
| -------------------- | --------------------------------------------------- |
| `get_total_nav_view` | Live NAV, share price, total shares                 |
| `preview_deposit`    | How many shares a given USDC amount would mint now  |
| `preview_redeem`     | Asset amounts + estimated USDC for burning N shares |

---

## Permissionless swap legs

Anyone can submit these once amounts are pending on-chain. They keep deposit deployment and redeem conversion moving without the user or admin signing every hop. Amounts are derived on-chain; instructions no-op when nothing is pending.

### Deposit path (after `deposit`)

| Instruction          | Role                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------- |
| `swap_usdc_to_sol`   | Convert ViaSol-bound pending USDC → wSOL                                                 |
| `swap_usdc_to_asset` | Deploy pending USDC into one DirectUsdc asset slot                                       |
| `swap_sol_to_asset`  | Deploy pending wSOL into one ViaSol asset slot (`pending_sol × sol_target_bps / 10_000`) |

### Redeem path (after cooldown, before `claim`)

| Instruction          | Role                                                                         |
| -------------------- | ---------------------------------------------------------------------------- |
| `swap_asset_to_usdc` | DirectUsdc: one asset slot → USDC; net USDC into `pending_usdc`              |
| `swap_asset_to_sol`  | ViaSol leg 1: one asset slot → wSOL                                          |
| `swap_sol_to_usdc`   | ViaSol leg 2: wSOL → USDC, deduct performance fee, accumulate `pending_usdc` |

All swap legs take slippage floors (`min_*_out`) and an `a_to_b` pool direction flag.

---

## TWAP keeper

### `update_dex_twap`

Keeper-only (wallet set by admin via `set_twap_keeper`). Advances TWAP for one DEX-priced global asset without minting shares. Writes `twap_live_state` into `asset.twap.last_price_x64` and stamps `last_update_twap_keeper_ts`.

---

## User flows (quick map)

```
Admin bootstrap
  init_global_state → create_asset (×N) → [optional set_twap_keeper / update_treasury_addr]

Vault launch
  create_etf → genesis_deposit → (manager: set_fee_recipient as needed)

Invest
  preview_deposit → deposit → swap_usdc_to_sol? → swap_usdc_to_asset / swap_sol_to_asset (per leg)

Exit
  preview_redeem → request_redeem → (wait 24h)
    → swap_asset_to_usdc  and/or  swap_asset_to_sol → swap_sol_to_usdc
    → claim

Emergency
  Admin: set_emergency (global) | set_vault_emergency_lock (one vault)
  Manager: set_paused (own vault deposits only)
```

---

## Getting started (UI)

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Program source of truth for instruction docs: `deps/c_vault/programs/vault/src/lib.rs`.

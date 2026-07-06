# c_vault_ui Backend Plan — Strict Instructions

## Goal

`c_vault_ui` must remain completely stunning and amazing. This plan covers **backend work only**.

---

## Section 1 — Vault UI & Ops

### 1.1 Remove Pyth (c_vault legacy UI)

- The old `c_vault` UI (with Pyth and Admin) is **redundant**.
- **Remove Pyth completely.** Do not retain Pyth-related code, UI, or dependencies in `c_vault_ui`.

### 1.2 Vault Ops (new section)

- Create a new section: **Vault Ops**.
- Vault Ops must carry **all vault-related functions**.

### 1.3 ETF + metadata (single flow)

- In Vault Ops, **`create_etf.rs`** and **`create_metadata`** must run **in one go** (single combined flow). Do not split them into separate user steps unless required by the program.

### 1.4 Other vault operations

- All other vault operations must come from **`vault_op.rs`**.

### 1.5 Admin section

- Admin section **already has the required functions**.
- **Connect Admin to devnet** only — wire existing Admin UI/actions to devnet; do not redesign Admin unless needed for connectivity.

### 1.6 Devnet connection reference

- Use the **integration tests** as the source of truth for how to connect to devnet (RPC, accounts, signing, etc.).

---

## Section 2 — Create Vault & Deposit / Redeem

### 2.1 Add Asset — source from forge token list

- When creating a vault, the **Add Asset** picker **must** load tokens from the forge Supabase **`token_registry`** table (`forge/supabase/migrations/0001_token_registry.sql`).
- Do **not** hardcode asset lists or maintain a separate token catalog in `c_vault_ui`.
- Reuse the same Supabase connection pattern as **`forge`** (`forge/lib/supabase/server.ts` and env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`).
- Each selectable asset must expose at minimum: `mint`, `symbol`, `name`, `decimals` (and any other fields required by vault creation).

### 2.2 Vault data — new Supabase table

- Create a **new Supabase table** via migration: **`forge/supabase/migrations/0004_vaults.sql`** (paste into Supabase SQL editor or run as migration).
- Table name: **`vaults`**. This is the **single source of truth** for vaults shown in `c_vault_ui`.
- Columns mirror on-chain create-etf output + metadata:
  - **Identity:** `vault_address` (PK), `vault_id`, `network`
  - **PDAs:** `vault_authority`, `shares_mint`, `usdc_vault`, `base_mint`
  - **Metadata:** `name`, `symbol`, `uri`
  - **Config:** `fee_recipient`, `performance_fee_bps`, `fund_type`, `max_shares`, `usdc_sol_pool`
  - **Assets:** `assets` (JSONB array — mint, pool_address, allocation_bps, decimals, route, pyth_feed_id)
  - **Provenance:** `creator`, `tx_signature`, `created_at`
- RLS: anon **select / insert / update** (same pattern as `orca_pools`, with update for post-create fixes).
- After on-chain vault creation succeeds, **insert/update** the vault row in `vaults`. Do not rely on local-only state for vault listing.

### 2.3 Deposit & Redeem — unified vault view (no separate sections)

- **Remove** standalone **Deposit** and **Redeem** sections/pages. They must **not** exist as separate nav items or flows.
- The UI **must fetch vaults** from the new vault Supabase table and render them as a list (or grid) of vault cards/rows.
- Each vault entry **must** expose exactly two actions: **Deposit** and **Redeem** (inline buttons on the vault row/card, or equivalent in-vault modal flow).
- Deposit and Redeem actions operate on **that vault’s** on-chain accounts — selected vault context comes from the fetched row, not a global picker.

---

## Constraints (MUST follow)

| Rule           | Detail                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Scope**      | Changes **only** in `c_vault_ui`, **except** the vault Supabase migration under `forge/supabase/migrations/` (Section 2.2).                            |
| **Reference**  | Take implementation patterns and behavior from **`forge`** and **`c_vault`**. Token list from **`token_registry`**; Supabase patterns from **`forge`**. |
| **UI quality** | Do not regress `c_vault_ui` visual polish; backend work must fit the existing stunning UI.                                                               |

---

## Out of scope (this document) [MUST BE MAINTAINED ]

- Implementing the plan (format/instructions only).
- Changes outside `c_vault_ui` unless explicitly required for devnet wiring and covered by forge/c_vault reference.

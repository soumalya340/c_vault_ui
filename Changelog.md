# Changelog

## 2026-07-19 — `new_ui/portfolio-vault-ops-relocation`

### Changes
- Moved **Vault Operations** (Genesis deposit, Set vault paused, Set fee recipient) off the Vault Ops plate (№03) and into **Portfolio → My Vaults**, inline under each vault's **Manage** row. Vault creation (Create ETF) stays on Vault Ops unchanged.
- `VaultOpsPanel` is now scoped to a single vault (`vault` prop) instead of listing every vault in a dropdown — since Manage is clicked from a known vault row, the vault selector was removed from all three operations (it was redundant with the row/panel header already showing which vault is active).
- Removed the **Vault TVL** stat from each My Vaults row (redundant with data shown elsewhere).
- `/portfolio` no longer shows the 01 VIEW / 02 VAULTS / 03 VAULT OPS section tabs in the header — it's a wallet-scoped destination (reached from the wallet menu, like Admin Dashboard), not a console section. Header now shows a **"← Back to app"** link and a "Portfolio" sublabel, mirroring the existing `/admin` header pattern.

### Reason
Vault Operations are per-vault manager actions; picking a vault twice (once to get to Vault Ops, again from a dropdown) was redundant when the operator already clicked Manage from that vault's row in Portfolio. Portfolio's nav also inherited the 3-tab console chrome even though it isn't one of the three sections — same category as `/admin`, which already gets its own back-link header instead of tabs.

### Files changed
- `app/(console)/vaults-ops/page.tsx` — removed `VaultOpsPanel`; Create ETF panel unchanged
- `app/components/vault-ops-panel.tsx` — `VaultOpsPanel` now takes `vault: VaultRecord` instead of listing/selecting vaults; removed vault dropdown/readout from all 3 operations; lighter chrome for inline embedding
- `app/components/portfolio-panel.tsx` — My Vaults rows: Manage button toggles inline `VaultOpsPanel` per vault; removed Vault TVL stat
- `app/components/site-nav.tsx` — `/portfolio` renders "← Back to app" instead of section tabs, with a "Portfolio" header sublabel
- `Changelog.md` — this entry

---

## 2026-07-19 — `admin/asset-state-to-onchain-calls`

### Changes
- Moved **Asset State** (`view_asset_state`) from View plate (№04 under Read operations) to **Admin → On-chain calls** plate as №09.
- Added registry **name** enrichment to Asset State output — the admin now sees the human-readable asset name alongside on-chain fields.
- Changed wallet dropdown link text from **"Dashboard"** to **"Admin Dashboard"** for clarity.
- Removed unused `VIEW_ASSET_ID_FIELD` constant; Asset State now uses `ASSET_ID_FIELD` like other admin functions.

### Files changed
- `app/components/function-defs.ts` — moved `view_asset_state` to `ADMIN_FUNCTIONS` (№09); removed `VIEW_ASSET_ID_FIELD`
- `app/components/execute-vault-function.ts` — parallel registry lookup for asset name
- `app/components/view-display.ts` — `humanizeAssetState` now includes `name` field
- `app/components/wallet-button.tsx` — "Dashboard" → "Admin Dashboard"
- `Changelog.md` — this entry

---

## 2026-07-19 — `new_ui/ui-components-relocation`

### Changes
- Moved **Asset State** (`view_asset_state`) off the main console View plate and out of a single Admin operations list.
- Added a dedicated **Admin view** plate on `/admin` → On-chain calls, with Asset State as №01.
- Kept **Admin operations** as write-only instruments (№01–08).
- Enriched Asset State readout with registry **name** when available.
- Moved **localhost / mainnet** network toggle into the wallet dropdown (header chrome on console + admin no longer shows a separate toggle).

### Reason
Keep Asset State off the public View UI so end users don’t see admin-only inspection; put it under Admin view instead of Admin operations. Network switch lives under the wallet menu so the header stays uncluttered.

### Files changed
- `app/components/function-defs.ts` — `ADMIN_VIEW_FUNCTIONS`; removed Asset State from `VIEW_FUNCTIONS` / ops list
- `app/components/admin/admin-onchain-section.tsx` — render Admin view + Admin operations plates
- `app/components/execute-vault-function.ts` — registry name enrichment for `view_asset_state`
- `app/components/view-display.ts` — display asset name in humanized Asset State output
- `app/components/wallet-button.tsx` — network toggle inside connected wallet menu; beside Connect when disconnected
- `app/components/site-nav.tsx` — remove header network toggle; pass network into `WalletButton`
- `app/admin/page.tsx` — remove header `NetworkTabs`; pass network into `WalletButton`
- `Changelog.md` — this entry

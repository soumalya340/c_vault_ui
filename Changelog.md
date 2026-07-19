# Changelog

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

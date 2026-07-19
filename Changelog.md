# Changelog

## 2026-07-19 — `new_ui/ui-components-relocation`

### Changes
- Moved **Asset State** (`view_asset_state`) off the main console View plate and out of a single Admin operations list.
- Added a dedicated **Admin view** plate on `/admin` → On-chain calls, with Asset State as №01.
- Kept **Admin operations** as write-only instruments (№01–08).
- Enriched Asset State readout with registry **name** when available.

### Reason
Keep Asset State off the public View UI so end users don’t see admin-only inspection; put it under Admin view instead of Admin operations.

### Files changed
- `app/components/function-defs.ts` — `ADMIN_VIEW_FUNCTIONS`; removed Asset State from `VIEW_FUNCTIONS` / ops list
- `app/components/admin/admin-onchain-section.tsx` — render Admin view + Admin operations plates
- `app/components/execute-vault-function.ts` — registry name enrichment for `view_asset_state`
- `app/components/view-display.ts` — display asset name in humanized Asset State output
- `Changelog.md` — this entry

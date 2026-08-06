# c_vault_ui — On-Chain Call Architecture

**Purpose of this document:** a precise, code-verified account of how vault pricing (NAV, share price, deposit/redeem quotes) is computed and displayed, for a client who wants to know exactly what runs on-chain vs. off-chain, and what is automatic vs. user-triggered.

**Read this first:** the on-chain Solana program is built to be 100% self-contained for pricing — no off-chain oracle server, no aggregator API. However, the **current UI client does not fully use that on-chain path on mainnet.** There are two real deviations from "everything on-chain, manual trigger only," detailed in §3 and §4. This report states plainly what is true today and what would need to change to make the "strictly on-chain, strictly manual" claim accurate end-to-end.

---

## 1. The on-chain pricing design (Rust program, `deps/programs/vault/src/`)

The vault program ships three read-only "view" instructions, each one an Anchor instruction that is *simulated* (not sent as a state-changing transaction) and returns a computed result:

| Instruction | File | Returns |
|---|---|---|
| `get_total_nav_view` | `instructions/view/nav_view.rs` | `tvl`, `share_price`, `total_shares` |
| `preview_deposit` | `instructions/view/preview_deposit.rs` | `shares_to_mint`, `total_nav`, `share_price`, fee split |
| `preview_redeem` | `instructions/view/preview_redeem.rs` | per-asset payout amounts, `estimated_usdc_value`, fee split |

All three follow the same pattern: read the vault's `AssetInfo` PDAs, read live token account balances for the vault's asset ATAs (minus any reserved/in-flight redeem amount), then price each asset via `pricing::calculate_nav::sum_nav` (`pricing/calculate_nav.rs`).

### How an asset is priced, on-chain, per asset type (`pricing/asset_valuation.rs`, `pricing/fetch_dex_price.rs`, `pricing/fetch_pyth_price.rs`)

Every `AssetInfo` declares one pricing venue, validated against a `price_pool_address` pinned at asset-listing time (so a caller cannot substitute an attacker-controlled pool). Three paths:

1. **Pyth-priced** — the instruction is passed a Pyth `PriceUpdateV2` account (owned by the Pyth receiver program on-chain); the program deserializes it directly and reads the price with a staleness check (`PYTH_MAX_AGE_SECS`). This is a Solana account read, not an HTTP call to any Pyth service.
2. **DEX DirectUsdc** — asset priced off a Meteora DAMM v2 pool or an Orca Whirlpool whose quote leg is USDC. The program reads the pool account's raw bytes at hand-verified byte offsets to get `sqrt_price` and the two mints, and derives spot price directly from that. No oracle account involved; USDC is treated as pegged 1:1 to USD.
3. **DEX ViaSol** — same DEX spot-price read, but the pool's quote leg is wSOL, so the result is converted to USD via a separate SOL/USD Pyth feed (also an on-chain account read).

There is no stored/cached price anywhere in the account state, no on-chain TWAP or averaging — every quote is computed fresh from whatever the passed-in accounts contain at simulation time. This is the architecture that supports the "everything on-chain, nothing automatic" pitch: the client is only ever the messenger, assembling accounts and asking the program to compute a number.

`preview_redeem.rs` additionally requires the caller to identify a `user_share_account` (read-only — no signature required to *preview*) so it can sanity-check share balance, and applies the vault's redeem fee split the same way the real `claim` instruction would.

---

## 2. What the TS client SDK exposes (`lib/onchain/cvault.tsx`)

Relevant exported functions (all called only from explicit UI actions — see §4):

- `getTotalNavView(connection, vaultId, network, wallet?)` — live NAV + share price.
- `previewDeposit(connection, vaultId, usdcAmount, network, wallet?)` — deposit quote.
- `previewRedeem(connection, vaultId, shares, network, wallet?)` — redeem quote.
- `getVaultSharePriceQuote(...)` — wraps `getTotalNavView`, falls back to the vault's genesis `baseline_share_price` only if live NAV comes back zero/unavailable (used to seed a secondary-market pool price, not for user-facing deposit/redeem math).
- `deposit`, `requestRedeem`, `claim`, `depositAndDeploy`, `genesisDepositAndDeploy`, `redeemSwap`, `redeemAndClaim`, `createEtf`, `createAsset` — the real, state-changing transactions. Every one of these is invoked from a component's `onClick` handler (form submit / button press) — confirmed no `setInterval`, `useSWR`, `react-query`, or scheduled re-submission anywhere in `app/` or `lib/`.

---

## 3. ⚠️ Deviation #1 — mainnet NAV/preview does NOT call the on-chain view instructions

This is the most important finding for the client conversation.

`getTotalNavView`, `previewDeposit`, and `previewRedeem` all branch on network (`lib/onchain/cvault.tsx:3097-3101`, `~3278`, `~3328`):

```ts
if (network === 'mainnet') {
  return computeNavFromChain(connection, ctx, vaultId);
}
// else (localhost): builds and .view()-simulates the real Anchor
// get_total_nav_view / preview_deposit / preview_redeem instruction
```

- **Localhost** genuinely calls the on-chain program's view instructions via Anchor's `.view()` (a simulated transaction against the real `nav_view.rs` / `preview_deposit.rs` / `preview_redeem.rs` code path described in §1).
- **Mainnet** does *not*. `computeNavFromChain` (`lib/onchain/cvault.tsx:3035`) instead:
  1. Reads the vault's asset token account balances directly via RPC (`fetchVaultAssetHoldings`) — this part is on-chain state.
  2. Prices every non-quote asset by calling `fetchUsdPrices()` from **`lib/jupiterPrice.ts`**, which hits `app/api/prices/route.ts`, a Next.js server route that proxies to **Jupiter's Price API v3** (`https://api.jup.ag/price/v3`) using a server-held `JUP_API_KEY`.
  3. Computes NAV/share price client-side from balances × Jupiter prices.

The code comment explains why: an Anchor `.view()` simulation is a transaction under the hood, and Solana caps transaction size at 1232 bytes — with enough assets in a basket plus their pool/oracle accounts, the real `get_total_nav_view` instruction doesn't fit. The Jupiter path was added as a workaround specifically for mainnet. Localhost (Surfpool) keeps the real on-chain path because it also needs to price synthetic test mints Jupiter doesn't know about.

**Net effect:** on mainnet today, the NAV/price the user sees is *not* the same number the on-chain program would return, and it is *not* an on-chain call at all for the pricing step — it's Jupiter's aggregator price for each mint, fetched over HTTPS. This directly contradicts a "no Jupiter, everything on-chain" claim, and should either be fixed (e.g. splitting the view call across multiple simulated transactions, or address-lookup-table compression to fit the real instruction under 1232 bytes) or disclosed to the client as a known interim limitation before that claim is made externally.

---

## 4. Deviation #2 — NAV load on the vault detail page is not purely button-triggered

`app/components/vault-detail-view.tsx:307-311`:

```ts
// Live NAV once per mount (and when wallet becomes available for ATA simulation).
useEffect(() => {
  if (vaultId === null || !vault) return;
  void loadNav(false);
}, [vaultId, vault, loadNav]);
```

Opening a vault's detail page automatically fires one `getTotalNavView` call on mount (and again if the wallet connects afterward). There is **no interval/polling** — it does not refetch on a timer — but it is not a manual click either. A manual "refresh" button (`onClick={() => void loadNav(true)}`) exists alongside it for re-querying afterward. `deposit-modal.tsx` and `redeem-modal.tsx`, by contrast, only call `previewDeposit`/`previewRedeem` from an explicit "Preview" button click — no auto-fetch there.

If the client's requirement is literally "the program is never queried unless the user clicks something," this one auto-call on page load needs to move behind a button too (or be described honestly as "fetched once when you open the vault, not polled").

---

## 5. Confirmed: no automatic RPC polling for financial data

Searched all of `app/` and `lib/` for `setInterval`, `useSWR`, `react-query`/`useQuery`, `refetchInterval`. The only hit is `app/components/cluster-status.tsx:92`, a `setInterval` that polls **RPC cluster health** (is the local validator up), gated to `network === 'localhost'` only, and unrelated to any vault, price, or NAV data. No component polls prices, balances, or NAV on a timer.

---

## 6. Confirmed: Supabase is used, but only for off-chain convenience data — never for price/NAV

Supabase (`lib/supabase/server.ts`, `lib/db/supabase.ts`) is real and present, but every use is a **registry/catalog concern**, not a source of financial truth:

| Table / route | Used for | Ever used for price/NAV? |
|---|---|---|
| `vaults` (`app/api/vaults/route.ts`) | Vault metadata cache (name, symbol, URI, addresses) written after an on-chain `create_etf` succeeds — "single source of truth for **which vaults exist and their addresses**," not their value. Includes a legacy `total_usdc_value` column that is always written as `'0'` and never read for display — it's dead, left over from a removed on-chain counter. | No |
| `vaults.additional_metadata` | A nullable text column that mirrors the vault's on-chain `additional_metadata` key/value pairs, which are written on-chain via `set_share_metadata_fields` (`lib/onchain/cvault.tsx:938-944`) in the same transaction as `create_etf`. On-chain state is the source of truth here — Supabase just carries a copy for the registry row. **Important correction:** this column is not currently rendered anywhere. The descriptive paragraph shown on the vault detail page ("On-chain ETF vault. Deposit USDC to mint shares...") is a hardcoded static string in `app/components/vault-detail-view.tsx:453-456`, not pulled from `additional_metadata`, Supabase, or any API call. | No — and not yet wired to any display at all |
| `PythInfo` (`app/api/pyth/route.ts`) | Convenience lookup so vault-creation UI can auto-fill a Pyth feed ID for a mint. Feed IDs can also be entered manually. | No — feed *id*, not a feed *price* |
| `orca_pools` (`app/api/pools/route.ts`) | Convenience pool-address suggestions for the "Create ETF" flow; any pool address can still be typed in directly. | No |
| `token_registry` (`app/api/tokens/route.ts`) | Asset picker catalog (symbol, decimals, mint) for building a new vault's basket. | No |
| `app/api/vault-metadata/{upload-image,upload-json,generate}` | Vault image/JSON metadata upload — off-chain descriptive content only. | No |
| `app/api/presets/route.ts`, `app/api/admin/db/*` | Preset basket templates; admin table browser for the DB itself. | No |

**Verdict:** the "no Supabase for vault pricing" claim holds — Supabase never appears anywhere in the NAV/preview-deposit/preview-redeem code paths (§1–§3). It only backs address books, metadata, and creation-flow convenience lookups. The one place a client should be precise in wording: Supabase *is* used, just not for anything that determines a number the user is trusting financially.

---

## 7. Summary verdict against the three constraints

| Constraint | Status | Detail |
|---|---|---|
| No Supabase for pricing/NAV | ✅ True | Supabase only touches vault registry metadata, address/pool/token/pyth-id convenience lookups, and image/JSON metadata — never price math. |
| No automatic background RPC polling | ✅ Mostly true, with one caveat | No interval-based polling anywhere for price/NAV/balances. `vault-detail-view.tsx` does fire one automatic (non-interval) NAV fetch on page mount — not a click, but not a recurring poll either (§4). |
| No Jupiter, everything priced on-chain | ❌ Not true on mainnet today | The on-chain program (`nav_view.rs`, `preview_deposit.rs`, `preview_redeem.rs`, `calculate_nav.rs`) genuinely prices everything via Pyth accounts + DEX pool spot reads, with zero Jupiter involvement. But the **mainnet client bypasses that program path entirely** and prices assets via Jupiter's Price API v3 through a server proxy, due to a transaction-size limit on the real on-chain view instruction (§3). Localhost still uses the real on-chain path. |

**Recommendation before presenting this to the client as "100% on-chain, manual-trigger only":** either (a) fix the mainnet NAV/preview path so it genuinely calls the on-chain view instructions (e.g., via ALT-compressed accounts or a chunked simulation), or (b) be upfront that the current mainnet build uses Jupiter as an interim price source for display purposes while deposit/redeem/claim execution itself still settles against real on-chain pool/oracle reads inside the program. Conflating the two would misrepresent the current build to the client.

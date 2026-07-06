# cVault Design System — "The Specimen Note"

The visual identity for the cVault operator console. Every styling decision in this
repo should trace back to this document.

---

## 1. Concept

cVault operates a vault that issues ETF shares on Solana. The design leans into what
those words have always meant in finance:

- A **share** is a *certificate*.
- A **vault** is *custody*.
- A **devnet deployment** is a *specimen* — banknote printers overprint pre-issue
  notes in red with the word SPECIMEN to mark them as real but not legal tender.
  That is exactly what devnet is.

So the console is not a dark crypto terminal. It is an **engraved bank certificate**:
sage security paper, intaglio ink, guilloche engraving, red serial numbers, microprint
rules, and a rubber-stamped `SPECIMEN · DEVNET` overprint. The chrome is ceremonial;
the forms inside stay strictly operational (monospace, dense, unambiguous).

**Tone in one line:** a 19th-century bearer certificate operated from a 21st-century
keyboard.

---

## 2. Color

Defined as CSS variables in `app/globals.css` and mapped to Tailwind tokens via
`@theme inline`. Never introduce ad-hoc hex values in components — extend the tokens.

| Token | Hex / value | Role |
|---|---|---|
| `--background` (paper) | `#E5E8DB` | Sage banknote paper. The only background color. |
| `--foreground` (ink) | `#17251C` | Intaglio green-black. All primary text. |
| `--accent` (engrave) | `#2E5C44` | Engraving green. Active tab fill, primary buttons, guilloche, "safe" sections (view / deposit / feeds). |
| `--seal` | `#A63A2B` | Treasury-seal red. Serial numbers, the SPECIMEN stamp, "hot" sections (redeem / admin). Signals *importance*, not error. |
| `--destructive` | `#96301F` | Errors only. Deliberately close to seal red but darker — errors read as ink, not decoration. |
| `--muted-foreground` | `rgba(23,37,28,0.62)` | Secondary text, labels, legends. |
| `--border` | `rgba(23,37,28,0.22)` | Hairline rules, row dividers, input borders. |
| `--border-strong` | `rgba(23,37,28,0.55)` | Frame rules, panel headers, tab strip outline. |

Rules:

- **Light only.** Paper does not have a dark mode. `color-scheme: light` is intentional.
- Green and red never mix in one element. Green = mechanism, red = provenance/authority.
- No gradients, no glassmorphism, no colored glows. Depth comes from rules (borders),
  not elevation.
- Tint surfaces with `foreground/[0.03–0.05]`, never with new colors.
- Paper texture: fine horizontal chain lines + faint green radial wash, defined once
  on `body` in `globals.css`. Never repeat it on inner surfaces.

## 3. Typography

Three faces, three jobs. Loaded via `next/font/google` in `app/layout.tsx`.

| Role | Face | Tailwind | Usage |
|---|---|---|---|
| Display | **Bodoni Moda** | `font-display` | The engraved voice. Masthead (`VAULT OPERATIONS`), wordmark, section titles, modal headings. Always with positive tracking (`0.02em–0.18em`); uppercase for titles. Never for body text or anything under ~16px. |
| Body / UI | **Archivo** | `font-sans` (default) | Instruction titles, descriptions, prose. Neutral and legible; carries no ornament. |
| Data / official | **IBM Plex Mono** | `font-mono` | Everything machine-adjacent: addresses, serials, field labels, tab labels, buttons, inputs, outputs, microprint, stamps. If a value could appear on-chain, it is set in mono. |

Scale and treatment:

- Masthead: `clamp(40px, 7vw, 92px)`, Bodoni bold, uppercase, tracking `0.06em`, centered.
- Section titles: Bodoni semibold ~16px, uppercase, tracking `0.18em`, colored by
  the section accent.
- Field labels: Plex Mono 10px bold, uppercase, tracking `0.14em`, muted.
- Serials: Plex Mono 11px bold, tracking `0.1em`, seal red, `tabular-nums`, prefixed `№`.
- Microprint: Plex Mono 5px, tracking `0.35em` — decorative security texture, always
  `aria-hidden`.
- The hierarchy is vertical and symmetric: the masthead is centered like a note
  legend, not left-aligned like a SaaS hero.

## 4. Signature devices

These are the elements the design is remembered by. Use them exactly as specified;
do not invent variants.

### Guilloche rosette (`GuillocheRosette`, `app/page.tsx`)
Engine-turned SVG rosette (rotated ellipse layers + concentric circles) in engraving
green at ~0.11 opacity, bleeding off the top-right corner behind the masthead.
Rotates once per 240s (`.guilloche`) — a lathe at rest. One per page, maximum.
Frozen under `prefers-reduced-motion`.

### Certificate frame (`.cert-frame`)
Double rule: 1.5px strong outer border with an inset hairline (box-shadow trick).
Used on the page shell, section panels, modals, menus. Sharp corners — frames are
never rounded. Controls inside may use `rounded-[2px]` at most.

### Microprint rule (`.microprint`)
A 5px repeating line of `CVAULT · ON-CHAIN ETF OPERATIONS · DEVNET SPECIMEN ·`
bounded by hairlines, under the nav and above the footer. It is texture that happens
to be true. Always `aria-hidden`, never interactive, never enlarged.

### Specimen stamp (`.stamp`)
Seal-red double-bordered rubber stamp, rotated −2°, distressed with an SVG noise
mask, reading `SPECIMEN · DEVNET`. This *is* the network indicator. When mainnet
ships, the stamp is removed (a mainnet note is not a specimen) — do not restyle it
green.

### Serial numbers
Every identity is a serial in seal-red mono: the vault PDA (`№ CVLT-0 · …`), the
program ID (`PROGRAM · …`), and every instruction row (`№ 01`). Serials use `№`,
tabular numerals, and truncated base58 (`8 chars … 8 chars`).

## 5. Layout & components

- **Structure:** one centered column inside the certificate frame; page padding
  `p-3 md:p-6` outside the frame so paper shows around the note edge.
- **Tab strip:** joined full-width cells with hairline dividers inside a strong
  border (a denomination strip). Active cell = solid section-accent fill with paper
  text. No pills, no underlines.
- **Instruction rows (ledger):** rows divided by hairlines inside one panel — never
  gapped cards. Anatomy: red serial → Archivo title → dotted leader → chevron.
  Open state tints the row `foreground/[0.03]`.
- **Forms:** 2-column grid on `sm+`, mono inputs on paper with hairline borders,
  `rounded-[2px]`. Primary button: engraving-green fill, mono uppercase, tracking
  `0.18em`. Section accents come from `SECTION_STYLE` in
  `app/components/function-defs.ts` (green for view/deposit/feeds, seal red for
  redeem/admin).
- **Output panels:** framed `OUTPUT` register with a `>` prompt prefix; success in
  ink, errors in destructive, info muted.
- **Wallet:** the connected wallet is the **bearer** of the note — the connected
  address chip is labeled `BEARER`, and the connect modal is titled "bearer
  registration."
- Shared class strings live in `app/components/ui-classes.ts`; change them there,
  not inline.

## 6. Motion

Motion is scarce and ceremonial:

- Page load: a single orchestrated `cert-fadeup` cascade (0.1s → 0.8s delays), top
  to bottom. One per page life, nothing re-triggers.
- Guilloche: 240s linear rotation, nothing faster.
- Devnet dot: slow `cert-blink` (1.6s).
- Accordions: 0.2s grid-rows ease-out.
- Nothing else. No hover lifts, no parallax, no springs. All motion is gated behind
  `prefers-reduced-motion` (global media query in `globals.css`).

## 7. Voice & copy

- Certificate vernacular for chrome: *series 2026*, *instruments*, *bearer*,
  *specimen*, *№*. Plain operator language for actions: buttons say exactly what
  the instruction does ("Deposit", "Fetch vault", "Save feed").
- Sentence case for prose; uppercase is reserved for mono labels and Bodoni titles.
- Errors state what happened and what to do, without apology or humor.
- The wit lives in the frame (SPECIMEN, bearer), never in the forms. Never joke
  near a transaction.

## 8. Quality floor

Non-negotiables that ship with every change:

- Responsive to 390px (tabs compress via `sm:` variants; the serial strip stacks).
- Visible keyboard focus everywhere: `focus-visible:ring-2 ring-accent`
  (`ring-inset` inside frames).
- `prefers-reduced-motion` fully respected.
- Decorative devices (guilloche, microprint, leaders, chevrons) are `aria-hidden`;
  semantic roles (`tablist`, `status`, `dialog`) are preserved.
- Contrast: ink on paper ≥ 12:1; engraving green and seal red stay ≥ 4.5:1 on paper
  at text sizes. Do not lighten tokens for aesthetics.

## 9. Don'ts

- No dark mode, no dark panels, no neon.
- No rounded cards, pills, or drop shadows for depth.
- No new accent colors; extend with tints of ink only.
- No second guilloche, no stamp variants, no colored stamps.
- No Bodoni below 16px, no Archivo for on-chain data, no mono for long prose.
- No decorative animation beyond §6.

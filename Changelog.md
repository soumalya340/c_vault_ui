# Changelog

## 2026-07-19 — Sage banknote background restored (white “glitch”)

### What looked broken

The Operations Console (hero + page chrome) rendered as a **plain white page**. The sage paper field, guilloche watermark, and certificate look were gone. It felt like a missing background or a visual glitch.

The components were still there (hero plate, `GuillocheRosette` SVG, serial rails, laid-paper CSS). Only the **colors** that made them readable were wrong. Correct reference: `deps/c_vault/old_ui`.

### Root cause (the glitch)

Not a deleted component. Not a browser bug.

In commit `d3a2944` (“Update dependencies and enhance global styles”), **shadcn default light-theme tokens** were dropped into `app/globals.css` and **overwrote the specimen-note brand palette**:

| Token | Intended (banknote) | After glitch |
| --- | --- | --- |
| `--background` | `#E5E8DB` sage paper | `oklch(1 0 0)` pure white |
| `--foreground` | `#17251C` forest ink | neutral near-black |
| `--accent` | `#2E5C44` forest green | `oklch(0.97 0 0)` near-white |
| muted / border / destructive | green-ink greys | stock neutral greys |
| card / popover / primary / sidebar | (should follow paper) | pure white / neutral |

**Why it looked empty:** the guilloche uses `text-accent` at ~16% opacity. Green-on-sage is a watermark; **near-white on pure white is invisible**. Laid-paper lines stayed in CSS but had no contrast, so the UI looked blank and slightly glitchy. The `:root` comment still said “specimen-note palette” while the values did not.

### How it was fixed

In `app/globals.css`:

1. **Restored brand tokens** from the known-good palette (`deps/c_vault/old_ui` / pre-`d3a2944`):
   - `--background: #E5E8DB`
   - `--foreground: #17251C`
   - `--accent: #2E5C44`
   - `--destructive`, `--muted-foreground`, `--border` back to banknote ink values
2. **Remapped shadcn structural tokens** (`--card`, `--popover`, `--primary`, `--muted`, `--sidebar`, charts, etc.) onto the same sage/forest set so panels cannot reintroduce pure white.
3. **Hardened `body`** with explicit `background-color: var(--background)` and `color: var(--foreground)` under the existing laid-paper `background-image`, so the paper field always shows.

Left in place: shadcn imports, theme maps, motion tokens. Brand tokens stay authoritative over stock light-theme neutrals.

**Result:** sage paper, visible guilloche, forest ink, certificate chrome — back to intended look.

### Files

- `app/globals.css` — palette restore + shadcn remaps + body base color
- `Changelog.md` — this entry

### Lesson

When adding a design system (shadcn, etc.), **do not replace product CSS variables with stock white/neutral defaults**. Map the system onto the specimen-note tokens; keep brand palette ownership explicit.

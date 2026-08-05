# Brand — c_vault_ui

_Status: deferred_

The user chose to defer formal brand-design setup in favor of matching the existing hand-built console aesthetic already present in the codebase (font-mono uppercase labels, `border-strong` section dividers, `accent`/`seal` CSS variables, certificate-style panels). The `frontend-design-guidelines` skill will quietly match that existing system and will not prompt again.

To set up a real brand palette, typography, and voice at any time, run:

    /brand-design

or say: "pick brand colors"

When `brand-design` runs, it will detect this deferred state, skip the "confirm overwrite" step, and proceed directly to the full brand setup.

_Deferred at: 2026-08-05_

## Todo

# IMMEDIATE 

1. Clear the db 









## FUTURE

### 1. Update the Smart Contracts

- Review and update the vault creation program (Anchor/Rust)
- Ensure on-chain accounts match the new ETF vault structure
- Update CPI instructions if any downstream programs depend on vault accounts
- Update IDL types and regenerate client bindings
- Run `anchor test` / integration tests to confirm no regressions
- Deploy updated program to devnet and verify

### 2. "Create ETF Vault" Button (Top-Right, 3D Shadow)

- Add a **"Create ETF Vault"** button in the top-right corner of the header, immediately to the left of the wallet connect button
- Give it a **3D shadow effect**: use `box-shadow` with multiple layers (e.g., a tight dark shadow + a softer offset shadow) and a slight `translateY` on `:active` to create depth
- Match the existing header height/alignment so it sits flush with the wallet button
- Use the brand primary color (or a vault-specific accent) to differentiate it from the wallet button
- Add a subtle hover lift (`translateY(-1px)` + shadow intensifies) and an active-press (`translateY(1px)` + shadow shrinks)
- Open a modal or navigate to a dedicated vault-creation flow on click

### 3. Remove the View Section

- Remove the current view section entirely
- Build an internal UI specific to each individual vault

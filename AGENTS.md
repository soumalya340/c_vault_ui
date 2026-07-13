<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Production repo — investor-facing, zero tolerance for bugs

This repository is production code being shown to investors. There must be NO bugs in this repo.

- Treat every change as production-grade, not a prototype or demo hack.
- Thoroughly check any code you touch: read the surrounding logic, verify call sites, confirm types line up end-to-end (client → API route → DB), and typecheck before considering work done.
- When changing a schema, table name, or function signature, grep for every caller and update them all in the same pass — do not leave stale references.
- Do not guess at behavior; verify against the actual code and, where relevant, actual DB/schema state.
- If you are not confident a change is correct and complete, say so explicitly rather than reporting success.

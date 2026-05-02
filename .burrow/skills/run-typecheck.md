---
description: Run the TypeScript typechecker before reporting work as done
---

Run `bun run typecheck` from the project root. Treat any error as a blocker —
fix it before reporting the task complete. The typecheck script is defined in
`package.json` as `tsc --noEmit`.

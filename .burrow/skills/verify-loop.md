---
description: Verify loop for the Burrow codebase
---

# Verify loop

The Burrow project's verify loop is a single command:

```bash
bun run typecheck
```

That script (defined in `package.json` as `tsc --noEmit`) is the only gate.
Run it from the project root after every change. Treat any error as a blocker
— fix the underlying issue and re-run the full loop. Repeat until it passes
cleanly.

---
description: Run the project's verification loop until it passes
---

The Verify Loop is the project-defined sequence of checks that must pass before
work is considered complete. It is language- and stack-agnostic: this skill does
not assume any specific tool, command, or runtime.

How to find the loop:

1. If the project has a `.burrow/skills/verify-loop.md`, follow its instructions
   verbatim — it overrides this default.
2. Otherwise look in the project for the conventional verification entrypoint.
   In order of preference:
   - A `verify` script in `package.json` / `pyproject.toml` / `Makefile` /
     `justfile` / equivalent.
   - A `check` or `test` script in the same files.
   - The CI configuration (`.github/workflows/`, `.gitlab-ci.yml`, etc.) — pick
     the steps that gate the build.
3. If nothing is configured, ask the user once for the verify command and stop.
   Do not invent one.

How to run it:

1. Run the loop from the project root.
2. Treat any non-zero exit as a blocker. Fix the underlying issue and re-run
   the entire loop — never partially.
3. Repeat until the loop passes cleanly. Only then report the work as done.

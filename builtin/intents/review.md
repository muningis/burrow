---
description: Review code or a pull request for correctness and style
when: User asks to review check audit feedback critique inspect pull request diff
type: Review
agents: [reviewer]
---

## Goal

Produce a structured review covering correctness, design, and consistency with
the surrounding code.

## Steps

1. Read the changed files and at least one neighboring file for context.
2. Surface concrete issues with file:line references.
3. Separate must-fix from nits.

---
description: Security review of recent changes or a specific component
when: User asks about security vulnerability vulnerabilities exploit injection sandbox escape unsafe
type: Security
agents: [reviewer]
skills: [run-typecheck]
---

## Goal

Identify security-relevant issues in the targeted code: sandbox escapes, unsafe
shell construction, missing input validation, secret handling, and supply chain.

## Steps

1. Enumerate trust boundaries crossed by the code.
2. For each boundary, check input handling and output escaping.
3. Report findings with severity and a concrete remediation.

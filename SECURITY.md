# Security policy

sprintailab is a security control, so reports about bypasses are welcome.

## Report a vulnerability

Please do not open a public issue for a security problem. Use GitHub's private
reporting: **Security tab, then "Report a vulnerability"**. If that is not
available, email contact@sprintailab.com with the subject "sprintailab security".

Include the version or commit, what you did, what you expected, and what happened.
We aim to acknowledge a report within 5 working days. This is an early project run
by a small team, so there is no bug bounty.

## In scope

- Ways for an agent to run a tool without a covering authorization
- Ways to forge, widen or extend an authorization
- Tier policy bypasses, including unknown tools or tier 3 tools getting through
- Audit log tampering that `verify-audit` fails to detect
- Target detection gaps that let a named target go unchecked

## Known limits (not vulnerabilities)

These are documented in the README under "Security model and known limits": same-user
file access, declarations that are recorded but not verified, whole-file audit
rewrites, partial MCP coverage, and direct use of upstream REA.

## Out of scope

Vulnerabilities in REA itself belong to [morluto/rea](https://github.com/morluto/rea).
Vulnerabilities in analysis engines (Ghidra, Hopper, IDA, JADX) belong to their vendors.

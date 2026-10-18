# Governance and AI policy

Status: **draft for legal review**. This is engineering intent, not legal advice.

## Controls

| # | Control | Purpose | State |
| --- | --- | --- | --- |
| 1 | Authorization declaration per target, scoped, expiring (4h default, 24h max), revocable | Make a person state ownership or written permission before analysis | Built |
| 2 | Tool risk tiers; unknown tools denied | Separate read-only tools from tools that run or change things | Built |
| 3 | Reference id required for tier 2 (live system) work | Tie live-system access to a ticket, contract or permission | Built |
| 4 | Tier 3 denied until a sandbox exists | Never execute an unknown target on a workstation | Built as a block; sandbox not built |
| 5 | Append-only, hash-chained audit log | Who analyzed what, when, under which declaration | Built, local file only |
| 6 | Blocked target categories (banking, payments, government, telecom, client deny lists) | Refuse sensitive software outright | Not built |
| 7 | Roles and second approval | Only vetted staff use higher tiers | Not built |
| 8 | Acceptable-use policy and contract terms | Legal backstop for what code cannot prevent | Commercial process |

## What the person declares

The recorded statement (version 1) is: *"I own this target or hold written permission to analyze it, and I
will use the results lawfully."* Each authorization stores the declarant, method (prompt or terminal),
scopes, highest tier, reference, start and expiry, and the statement version. The audit log copies this
the first time the authorization is relied on.

## Tool tiers

Every REA tool is classified into one of four tiers from REA's own effect flags
(207 tools in REA 6.6.0): Tier 0 read-only (95), Tier 1 local analysis (50),
Tier 2 live system (38), Tier 3 executes or modifies (24).

- Full tables and rules: [tool-tiers.md](tool-tiers.md) (generated, do not edit by hand)
- Machine-readable policy input: `policy/tool-tiers.json`
- Unknown tools are denied (fail closed). Regenerate and review the diff on every upstream bump.

## Items for Indian legal counsel

These are questions to bring to a lawyer, not conclusions.

1. Copyright Act, 1957: scope of permitted acts for interoperability and decompilation.
2. Information Technology Act, 2000: unauthorized access exposure for users and for us.
3. DPDP Act, 2023: obligations if personal data appears in analyzed targets or flows
   to a model provider; data-residency position.
4. Contract terms: liability limits, indemnity, acceptable-use clauses.
5. Export or sector rules for security tooling, if any apply.
6. Vendor terms of IDA, Hopper and JEB for automated and commercial use.

## Residual risks we cannot code away

- Declarations can be false. They are recorded, not verified.
- An agent with shell access as the same OS user can write the authorizations file directly. Run the proxy and its files under a different OS user, or centrally, for real separation.
- Target detection is heuristic; see the README.
- Upstream REA can be run without our proxy.
- Model providers see tool results unless a private deployment is used.

# Governance and AI policy

Status: **draft for legal review**. This is engineering intent, not legal advice.

## Controls

| # | Control | Purpose | Enforced by |
| --- | --- | --- | --- |
| 1 | Authorization declaration per target | Make users state ownership or written permission before analysis | Authorization gate |
| 2 | Tool risk tiers | Separate read-only static tools from tools that run the target | Policy engine |
| 3 | Blocked target categories | Refuse banking and payment apps, government and telecom software, and anything on a client-specific deny list | Policy engine |
| 4 | Sandbox for runtime tools | Never execute an unknown target on a user workstation | Sandbox controller |
| 5 | Roles | Only vetted staff can use high-tier tools | Policy engine |
| 6 | Append-only audit log | Who analyzed what, when, under which declaration | Audit log |
| 7 | Acceptable-use policy and contract terms | Legal backstop for what code cannot prevent | Commercial process |

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

- Declarations can be false.
- Upstream REA can be run without our proxy.
- Model providers see tool results unless a private deployment is used.

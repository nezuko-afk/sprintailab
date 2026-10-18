# sprintailab

A governed layer on top of [REA (Reverse Engineer Anything)](https://github.com/morluto/rea)
for **authorized** software analysis, aimed at the Indian market.

**Status:** early design. Docs and scaffolding exist; our own code in `src/` is not written yet.

## Overview

REA lets an AI agent investigate software without its source: native binaries,
Electron apps, APKs, websites, .NET assemblies, firmware and more, returning
findings with evidence. That power can be misused.

sprintailab wraps REA with controls a services business can stand behind:

- proof of authorization per target
- tool risk tiers and blocked target categories
- sandboxing for anything that runs the target
- an append-only audit trail

Target use cases: legacy and undocumented system modernization, vendor software
due diligence, interoperability work, and first-pass security review.

## Architecture

Agents talk MCP to a **governance proxy**. The proxy checks policy, logs, and
forwards approved calls to an unmodified `rea mcp` process.

See [docs/architecture/architecture.md](docs/architecture/architecture.md) for the
component diagram, trust boundaries and known limits.

## Sequence diagrams

Approved request, denied request, and runtime-capture flows:
[docs/sequence/analysis-request.md](docs/sequence/analysis-request.md).

## Governance and AI policy

Controls and the list of questions for Indian legal counsel:
[docs/governance/policy.md](docs/governance/policy.md). Tool risk tiers for all 207 REA tools:
[docs/governance/tool-tiers.md](docs/governance/tool-tiers.md). This is a draft, not legal advice.

## Getting started

Prerequisites: Node.js 22.19+, 24.11+ or 26+ (Node 25 is not supported by REA), and git.

```bash
git clone --recurse-submodules <this-repo-url>
cd sprintailab
# already cloned without submodules?
git submodule update --init --depth 1
```

Run upstream REA for a quick check (until our proxy exists):

```bash
npx rea-agents setup
```

Update the pinned upstream later:

```bash
git submodule update --remote upstream/rea
git add upstream/rea && git commit -m "Bump upstream REA"
```

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Our code: governance proxy, policy engine, audit log (not started) |
| `upstream/rea/` | Official REA as a git submodule, unmodified |
| `docs/architecture/` | Architecture and trust boundaries |
| `docs/sequence/` | Sequence diagrams |
| `docs/governance/` | Policy, controls, generated tool tiers and legal checklist |
| `policy/` | Machine-readable policy data (`tool-tiers.json`) for the proxy |
| `scripts/` | Generators, e.g. `generate-tool-tiers.mjs` |
| `NOTICE.md` | Upstream attribution and license obligations |

## Roadmap

1. [x] Repo scaffold, upstream submodule, architecture, sequence and policy drafts
2. [x] Classify REA tools into risk tiers from its generated tool catalog (207 tools)
3. [ ] MCP governance proxy skeleton that forwards to `rea mcp`
4. [ ] Authorization gate and audit log
5. [ ] Sandbox controller for runtime-capture tools
6. [ ] Hindi and Marathi guides
7. [ ] Legal review and acceptable-use policy

## Licensing

Built on REA (MIT, Copyright (c) 2026 morluto). Keep upstream license files intact;
see [NOTICE.md](NOTICE.md). License for our own code: _to be decided._
Do not present this project as the official REA.

## Responsible use

Use only on software you own or are authorized to analyze. Check licenses and
local law before commercial use. IDA, Hopper and JEB require their own licenses.

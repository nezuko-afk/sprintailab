# sprintailab

A governed layer on top of [REA (Reverse Engineer Anything)](https://github.com/morluto/rea)
for **authorized** software analysis, aimed at the Indian market.

**Status:** early. The governance proxy skeleton works end to end against real REA: tier filtering, fail-closed unknown tools, hash-chained audit log. The authorization gate and sandbox are not built yet.

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

## Running the governance proxy

Build and test (Node 22.19+, 24.11+ or 26+):

```bash
npm install
npm run build
npm test
```

Register the proxy with your agent instead of REA. Example for Claude Code:

```bash
claude mcp add sprintailab -- node /absolute/path/to/sprintailab/dist/index.js
```

By default the proxy starts REA with `npx -y rea-agents@<version in policy/tool-tiers.json> mcp`
and allows tools up to **tier 1** (read-only and local analysis). Tier 2 and 3 tools are hidden
from the agent and denied if called. Tools not in the tier list are always denied.

| Variable | Meaning | Default |
| --- | --- | --- |
| `SPRINTAIL_MAX_TIER` | Highest allowed tier, 0 to 3 | `1` |
| `SPRINTAIL_REA_COMMAND` | Command that starts REA | `npx` |
| `SPRINTAIL_REA_ARGS` | JSON array of arguments | `["-y","rea-agents@<tiers version>","mcp"]` |
| `SPRINTAIL_AUDIT_PATH` | Audit log file | `./audit/audit.jsonl` |
| `SPRINTAIL_ACTOR` | Identity written to the audit log | OS user name |

If that exact REA version is not on npm yet, point the proxy at your own build instead:

```bash
export SPRINTAIL_REA_COMMAND=node
export SPRINTAIL_REA_ARGS='["/path/to/rea/scripts/rea.mjs","mcp"]'
```

Check it end to end with `npm run smoke`. The audit log records tool name, tier, decision,
rule id and a hash of the arguments, never the arguments themselves. Raising the tier limit
above 1 is not recommended until the authorization gate exists.

Current limits: only `tools/list` and `tools/call` are proxied (REA prompts and resources are
not), there is no authorization prompt yet, and tier handling is a single global limit rather
than per-role.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Our code: governance proxy, policy, audit log, with tests |
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
3. [x] MCP governance proxy skeleton that forwards to `rea mcp` (tier limit, fail closed, audit log)
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

# sprintailab

A governed layer on top of [REA (Reverse Engineer Anything)](https://github.com/morluto/rea)
for **authorized** software analysis, aimed at the Indian market.

**Status:** early but working end to end against real REA 6.6.0. Built: tier policy, fail-closed
unknown tools, authorization gate (prompt or terminal), hash-chained audit log. Not built: sandbox
for tier 3 tools, roles, central deployment. Not legal advice; see the licensing and legal notes.

## Overview

REA lets an AI agent investigate software without its source: native binaries, Electron apps,
APKs, websites, .NET assemblies, firmware and more, returning findings with evidence. That power
can be misused. sprintailab wraps REA with controls a services business can stand behind:

- a person must declare ownership or permission for each target, with a reference for live-system work
- all 207 REA tools sorted into risk tiers; code-executing tools are blocked until a sandbox exists
- an append-only, hash-chained audit trail of who analyzed what

Target use cases: legacy and undocumented system modernization, vendor software due diligence,
interoperability work, and first-pass security review.

## How it works

The agent talks MCP to a governance proxy instead of to REA. For every tool call the proxy:

1. looks the tool up in `policy/tool-tiers.json`; unknown tools and tiers above the limit are denied
2. finds the targets the call names (files, URLs, devices, packages) in its arguments
3. checks that a person's unexpired authorization covers each target; if not, asks the person
4. writes the decision to the audit log, then forwards allowed calls to an unmodified `rea mcp`

Details: [architecture](docs/architecture/architecture.md),
[sequence diagrams](docs/sequence/analysis-request.md), [policy](docs/governance/policy.md),
[tool tiers](docs/governance/tool-tiers.md).

## Quick start

Node.js 22.19+, 24.11+ or 26+ is required (REA does not support Node 25).

```bash
git clone --recurse-submodules <this-repo-url> && cd sprintailab
npm install && npm run build && npm test
```

Register the proxy with your agent instead of REA. Example for Claude Code:

```bash
claude mcp add sprintailab -- node /absolute/path/to/sprintailab/dist/index.js
```

By default the proxy starts REA with `npx -y rea-agents@<version in policy/tool-tiers.json> mcp`.
If that exact version is not on npm yet, use your own build:

```bash
export SPRINTAIL_REA_COMMAND=node
export SPRINTAIL_REA_ARGS='["/path/to/rea/scripts/rea.mjs","mcp"]'
```

## Authorizing a target

Nothing that names a file, URL or device runs until a person authorizes it. Two ways:

**1. A prompt in the agent's client.** If the client supports MCP elicitation, the person sees a form
with the target, the tool, the statement *"I own this target or hold written permission to analyze
it, and I will use the results lawfully"*, a confirm box, a reference field and a duration. The
agent never sees or fills this form.

**2. The terminal.** When the client cannot prompt, the denial tells the agent to ask the person to run:

```bash
sprintailab authorize --scope /work/clientA/app --tier 1 --ttl 4h
sprintailab authorize --scope adb:R5CT123 --tier 2 --reference JIRA-482   # tier 2 needs a reference
sprintailab list
sprintailab revoke <id>
sprintailab verify-audit
```

`authorize` refuses to run without an interactive terminal and needs a typed `YES`.
(Run it as `node dist/cli-bin.js authorize ...`, or run `npm link` once to get a `sprintailab` command. The
denial messages the agent sees use the short `sprintailab` form.)

Scopes: a folder (`/work/clientA/app`), a web origin (`https://app.example.com`), `host:*.example.com`,
`adb:SERIAL`, `package:com.example.app`, `device:ID`. Whole-disk, home-folder and wildcard-everything
scopes are rejected. Authorizations last 4 hours by default and 24 hours at most.

Calls that name no target (for example adding a comment in an open binary) need any active
authorization of sufficient tier. A few status-only tools run without one; see
[tool tiers](docs/governance/tool-tiers.md).

## Settings

| Variable | Meaning | Default |
| --- | --- | --- |
| `SPRINTAIL_MAX_TIER` | Highest tier this deployment may use, 0 to 3 (tier 3 is always denied for now) | `2` |
| `SPRINTAIL_HOME` | Folder for the audit log and authorizations | `~/.sprintailab` |
| `SPRINTAIL_AUDIT_PATH` | Audit log file | `<home>/audit.jsonl` |
| `SPRINTAIL_AUTH_PATH` | Authorizations file | `<home>/authorizations.jsonl` |
| `SPRINTAIL_ELICITATION` | `off` to disable in-client prompts and require the terminal | on |
| `SPRINTAIL_REA_COMMAND` / `SPRINTAIL_REA_ARGS` | How to start REA (JSON array of args) | `npx -y rea-agents@<version> mcp` |
| `SPRINTAIL_ACTOR` | Identity written to the audit log | OS user name |

The audit log stores the tool, tier, decision, rule id, the targets (paths, origins, device ids), the
authorization ids relied on, and a SHA-256 of the arguments. It never stores other argument content
or REA's results beyond the evidence id.

## Verify it end to end

```bash
npm test          # 73 tests: policy, targets, scopes, authorizations, gate, proxy, CLI, audit
npm run smoke     # runs the built proxy in front of real REA with a throwaway home folder
```

`scripts/audit-target-coverage.mjs` checks the target extractor against every REA tool schema.
`scripts/generate-tool-tiers.mjs` regenerates the tier list; run it on every REA update and review the diff.

## Known limits

- **Same-user trust.** The authorizations file is a normal file. An agent that can run shell commands
  as the same OS user could write a grant directly. The terminal check only blocks the CLI path.
  Real separation needs the proxy and its files under a different OS user, or a central service.
- **Prompts depend on the client.** Elicitation is tested against the MCP SDK, not yet against
  Claude Code, Cursor or Codex. Without it, the terminal path applies.
- **Heuristic targets.** Targets are found by scanning arguments for URLs, absolute paths, path-like
  keys, serials and package names. Session tools that act on an already-open target rely on that
  target having been authorized when it was opened.
- **Declarations are not proof.** A false declaration is recorded, not detected.
- Only `tools/list` and `tools/call` are proxied; REA prompts and resources are not.
- No roles, no sandbox, local audit log only.

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Governance proxy, policy, gate, authorizations, audit log, CLI, with tests |
| `upstream/rea/` | Official REA as a git submodule, unmodified |
| `policy/` | Machine-readable policy data (`tool-tiers.json`) |
| `scripts/` | Tier generator, coverage audit, smoke test |
| `docs/` | Architecture, sequence diagrams, governance and legal checklist |
| `NOTICE.md` | Upstream attribution and license obligations |

## Roadmap

1. [x] Repo scaffold, upstream submodule, architecture, sequence and policy drafts
2. [x] Classify REA tools into risk tiers (207 tools)
3. [x] Governance proxy skeleton (tier limit, fail closed, audit log)
4. [x] Authorization gate: scoped, expiring declarations by prompt or terminal
5. [ ] Sandbox controller, then enable tier 3 behind it
6. [ ] Roles and second approval; central audit store and deployment as a separate OS user
7. [ ] Hindi and Marathi guides
8. [ ] Legal review and acceptable-use policy

## Licensing

Built on REA (MIT, Copyright (c) 2026 morluto). Keep upstream license files intact; see
[NOTICE.md](NOTICE.md). License for our own code: _to be decided._ Do not present this project as
the official REA.

## Responsible use

Use only on software you own or are authorized to analyze. Check licenses and local law before
commercial use. IDA, Hopper and JEB require their own licenses.

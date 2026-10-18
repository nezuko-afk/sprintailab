# sprintailab

> Working title. A governed layer on top of REA (Reverse Engineer Anything) for
> authorized software analysis, aimed at the Indian market.

**Status:** early scaffold. Sections below are filled in step by step.

## Overview
_To do: problem, target users, what this adds on top of REA._

## Architecture
_To do: components and boundaries. Diagram goes in `docs/architecture/`._

## Sequence diagram
_To do: request flow from agent to analysis result. Diagram goes in `docs/sequence/`._

## Governance and AI policy
_To do: authorization gate, audit trail, target allow/block lists, sandboxing, roles.
Details go in `docs/governance/`._

## Getting started
_To do: prerequisites (Node 22.19+, 24.11+ or 26+), install, first run._

## Repository layout

| Path | Purpose |
| --- | --- |
| `src/` | Our own code (governance wrapper and tooling) |
| `upstream/` | Vendored REA source, with its license kept intact |
| `docs/architecture/` | Architecture diagrams and notes |
| `docs/sequence/` | Sequence diagrams |
| `docs/governance/` | Policies, acceptable use, legal checklist |

## Licensing
Built on [REA](https://github.com/morluto/rea) (MIT). See [NOTICE.md](NOTICE.md).
Our own license: _to be decided._

## Responsible use
Use only on software you own or are authorized to analyze. Check licenses and
local law before commercial use.

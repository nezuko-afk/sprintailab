# Contributing

Thanks for helping. This project is small and security-sensitive, so changes are
reviewed carefully.

## Set up

```bash
git clone --recurse-submodules https://github.com/nezuko-afk/sprintailab.git
cd sprintailab
npm install
npm run typecheck && npm test && npm run build
node examples/demo.mjs
```

Node 22.19+, 24.11+ or 26+ is required (REA rejects Node 25).

## Ground rules

- **Fail closed.** If a change could let something through by accident, it should deny instead.
- **Tests with every behavior change.** Policy, gate, targets, scope and audit changes need tests that show both the allowed and the denied case.
- **Do not edit `upstream/rea`.** REA stays an unmodified submodule. Fix REA issues upstream.
- **Tier changes need a reason.** `policy/tool-tiers.json` is generated. Regenerate it with `npm run tiers:generate` and explain every re-tiered tool in the pull request.
- **No real targets in tests or examples.** Use throwaway folders you created.

## Pull requests

Keep them small, describe what changed and why, and say how you tested it. Security
problems go through [SECURITY.md](SECURITY.md), not public issues.

## Licensing

By contributing you agree that your contribution is licensed under the MIT License
in [LICENSE](LICENSE).

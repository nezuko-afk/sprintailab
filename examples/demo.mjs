#!/usr/bin/env node
// Offline demo of the governance decisions. No REA, no network, nothing is analyzed.
// It runs the real policy, authorization gate and audit log from dist/ in a throwaway folder.
// Usage: npm run build && node examples/demo.mjs
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { Policy, loadTiers } = await import(join(root, "dist/policy.js"));
const { Gate } = await import(join(root, "dist/gate.js"));
const { AuthorizationStore } = await import(join(root, "dist/authorization.js"));
const { AuditLog, verifyChain } = await import(join(root, "dist/audit.js"));

const home = mkdtempSync(join(tmpdir(), "sprintailab-demo-"));
const clientA = join(home, "work", "clientA", "app");
const clientB = join(home, "work", "clientB", "app");
mkdirSync(clientA, { recursive: true });
mkdirSync(clientB, { recursive: true });

const policy = new Policy(loadTiers(join(root, "policy/tool-tiers.json")), { maxTier: 2 });
const store = new AuthorizationStore(join(home, "authorizations.jsonl"));
const gate = new Gate(store);
const audit = new AuditLog(join(home, "audit.jsonl"), "demo");

const step = (title) => console.log(`\n${title}`);
function call(tool, args = {}) {
  const d = policy.decide(tool);
  let verdict;
  if (!d.allow) verdict = `DENY   ${d.ruleId}`;
  else {
    const g = gate.check({ tier: d.tier, args, exempt: d.authExempt, cwd: home });
    verdict = g.status === "allow" ? "ALLOW  R0-allow" : "DENY   R3-authorization-required";
  }
  audit.append("tool_call", { tool, tier: d.tier ?? null, decision: verdict.trim().split(/\s+/)[0].toLowerCase(), args: Object.keys(args) });
  console.log(`  ${verdict.padEnd(34)} ${tool}${args.input_path ? "  " + args.input_path.replace(home, "~") : ""}`);
}

step("1. An agent asks to analyze a client folder nobody has authorized");
call("analyze_javascript_application", { input_path: clientA });

step("2. A person authorizes that one folder for tier 1, for 4 hours");
const grant = store.grant({ declarant: "demo.person", method: "cli", scopes: [clientA], maxTier: 1, ttlMs: 4 * 3600_000, cwd: home });
console.log(`  authorization ${grant.id.slice(0, 8)} scope ${clientA.replace(home, "~")} expires ${grant.expiresAt}`);

step("3. The same call, then a different client's folder");
call("analyze_javascript_application", { input_path: clientA });
call("analyze_javascript_application", { input_path: clientB });

step("4. Tools the policy refuses outright");
call("capture_process_scenario", { input_path: clientA });
call("a_tool_added_upstream_tomorrow");
const raised = new Policy(loadTiers(join(root, "policy/tool-tiers.json")), { maxTier: 3 }).decide("capture_process_scenario");
console.log(`  limit raised to tier 3:            ${raised.ruleId}  (no sandbox exists, so tier 3 still cannot run)`);

step("5. The audit log is a hash chain; edit one record and verification fails");
console.log(`  before tampering: ${JSON.stringify(verifyChain(join(home, "audit.jsonl")))}`);
const lines = readFileSync(join(home, "audit.jsonl"), "utf8").split("\n").filter(Boolean);
lines[0] = lines[0].replace('"decision":"deny"', '"decision":"allow"');
writeFileSync(join(home, "audit.jsonl"), lines.join("\n") + "\n");
console.log(`  after tampering:  ${JSON.stringify(verifyChain(join(home, "audit.jsonl")))}`);

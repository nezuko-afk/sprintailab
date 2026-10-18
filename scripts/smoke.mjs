#!/usr/bin/env node
// End-to-end smoke test against a real REA. Needs `npm run build` first.
// Point it at REA with SPRINTAIL_REA_COMMAND / SPRINTAIL_REA_ARGS, otherwise the proxy uses npx.
// It uses a throwaway SPRINTAIL_HOME, so it never touches your real audit log or authorizations.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { AuthorizationStore } = await import(join(root, "dist/authorization.js"));
const { verifyChain } = await import(join(root, "dist/audit.js"));
const tiers = JSON.parse(readFileSync(join(root, "policy/tool-tiers.json"), "utf8"));

const home = mkdtempSync(join(tmpdir(), "smoke-home-"));
const work = mkdtempSync(join(tmpdir(), "smoke-work-"));
const project = join(work, "clientA", "app");
mkdirSync(project, { recursive: true });
// A tiny extracted JavaScript app: REA analyzes these statically, with no native engine and without running them.
writeFileSync(join(project, "package.json"), JSON.stringify({ name: "smoke-app", version: "1.0.0", main: "index.js" }));
writeFileSync(join(project, "index.js"), "const helper = require('./helper');\nmodule.exports = function SmokeEntry() { return helper.SmokeMarker(); };\n");
writeFileSync(join(project, "helper.js"), "exports.SmokeMarker = () => 42;\n");
const TOOL = "analyze_javascript_application";
const targetArgs = (dir) => ({ input_path: dir });
const env = { ...process.env, SPRINTAIL_HOME: home, SPRINTAIL_ACTOR: "smoke", SPRINTAIL_ELICITATION: "off" };

const agent = new Client({ name: "smoke-agent", version: "0" });
await agent.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, "dist/index.js")], env, stderr: "inherit" }));

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  | " + detail : ""}`);
  if (!ok) failures++;
};
const short = (r) => (r.content?.[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 150);

const { tools } = await agent.listTools();
const tierOf = new Map(tiers.tools.map((t) => [t.name, t.tier]));
const counts = [0, 1, 2, 3].map((n) => tools.filter((t) => tierOf.get(t.name) === n).length);
check("lists tiers 0-2 only, no unknown tools", counts[3] === 0 && tools.every((t) => tierOf.has(t.name)), `T0=${counts[0]} T1=${counts[1]} T2=${counts[2]} T3=${counts[3]}`);

const before = await agent.callTool({ name: TOOL, arguments: targetArgs(project) });
check("named target without authorization is denied (R3)", before.isError && short(before).includes("R3-authorization-required"), short(before));

// A person authorizes the project folder. This is what `sprintailab authorize` does at a terminal.
const store = new AuthorizationStore(join(home, "authorizations.jsonl"));
const grant = store.grant({ declarant: "smoke-person", method: "cli", scopes: [project], maxTier: 1, ttlMs: 3_600_000, cwd: root });

const after = await agent.callTool({ name: TOOL, arguments: targetArgs(project) });
check("same call succeeds once the folder is authorized", !after.isError && JSON.stringify(after.structuredContent ?? after.content).includes("helper.js"), short(after));

const sibling = join(work, "clientB", "app");
mkdirSync(sibling, { recursive: true });
writeFileSync(join(sibling, "index.js"), "module.exports = 1;\n");
const other = await agent.callTool({ name: TOOL, arguments: targetArgs(sibling) });
check("a different client folder stays denied", other.isError && short(other).includes("R3"), short(other));

const t3 = await agent.callTool({ name: "gdb_console", arguments: { command: "info registers" } });
check("tier 3 is denied", t3.isError && /R2|R4/.test(short(t3)), short(t3));
const unk = await agent.callTool({ name: "definitely_not_a_rea_tool", arguments: {} });
check("unknown tool is denied (R1)", unk.isError && short(unk).includes("R1"), short(unk));
const status = await agent.callTool({ name: "binary_session", arguments: {} });
check("status tool runs without authorization", !status.isError);

store.revoke(grant.id, "smoke-person");
const revoked = await agent.callTool({ name: TOOL, arguments: targetArgs(project) });
check("revoked authorization stops working", revoked.isError && short(revoked).includes("R3"), short(revoked));
await agent.close();

const cli = spawnSync(process.execPath, [join(root, "dist/cli-bin.js"), "authorize", "--scope", project], { env, input: "YES\n", encoding: "utf8" });
check("CLI refuses to authorize without an interactive terminal", cli.status === 2, (cli.stderr || "").trim().slice(0, 100));

const audit = join(home, "audit.jsonl");
const chain = verifyChain(audit);
const events = readFileSync(audit, "utf8").trim().split("\n").map((l) => JSON.parse(l));
check("audit chain verifies", chain.ok, `${chain.records} records`);
check("authorization was recorded in the audit chain", events.some((e) => e.event === "authorization_observed" && e.authorizationId === grant.id));
check("analysis content never appears in the audit log", !readFileSync(audit, "utf8").includes("SmokeMarker"));
console.log(`\nhome: ${home}\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);

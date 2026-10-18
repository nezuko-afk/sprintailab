#!/usr/bin/env node
// End-to-end smoke test: start the built proxy over stdio (as an agent would) and exercise it.
// Needs `npm run build` first. Point it at a real REA with SPRINTAIL_REA_COMMAND / SPRINTAIL_REA_ARGS,
// otherwise the proxy starts REA with npx.
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tiers = JSON.parse(readFileSync(join(root, "policy/tool-tiers.json"), "utf8"));
const auditPath = join(mkdtempSync(join(tmpdir(), "smoke-")), "audit.jsonl");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "dist/index.js")],
  env: { ...process.env, SPRINTAIL_AUDIT_PATH: auditPath, SPRINTAIL_ACTOR: "smoke" },
  stderr: "inherit",
});
const agent = new Client({ name: "smoke-agent", version: "0" });
await agent.connect(transport);

const { tools } = await agent.listTools();
const names = new Set(tools.map((t) => t.name));
const tierOf = new Map(tiers.tools.map((t) => [t.name, t.tier]));
const byTier = [0, 1, 2, 3].map((n) => tools.filter((t) => tierOf.get(t.name) === n).length);
const unknownListed = tools.filter((t) => !tierOf.has(t.name)).map((t) => t.name);
console.log(`visible tools: ${tools.length}  (by tier: T0=${byTier[0]} T1=${byTier[1]} T2=${byTier[2]} T3=${byTier[3]})`);
console.log(`unknown tools visible: ${unknownListed.length}`);

const probe = async (label, name, args = {}) => {
  const r = await agent.callTool({ name, arguments: args });
  const text = (r.content?.[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 140);
  console.log(`${label}: ${name} -> isError=${Boolean(r.isError)} | ${text}`);
  return r;
};

await probe("tier 3 (must be denied)", "gdb_console", { command: "info registers" });
await probe("tier 2 (must be denied)", "list_adb_devices");
await probe("unknown (must be denied)", "definitely_not_a_rea_tool");
if (names.has("binary_session")) await probe("session read", "binary_session", {});

await agent.close();
const lines = readFileSync(auditPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
console.log(`audit records: ${lines.length}  events: ${[...new Set(lines.map((l) => l.event))].join(", ")}`);
console.log(`audit file: ${auditPath}`);

#!/usr/bin/env node
// Lists path-like string arguments (tiers 0-2) whose RELATIVE values the target extractor would miss.
// Absolute paths and http(s) URLs are recognized under any key, so only relative values matter.
// Usage: node scripts/audit-target-coverage.mjs <mcp-tool-catalog.json>   (needs `npm run build`)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { extractTargets } = await import(join(root, "dist/targets.js"));
const catalogPath = process.argv[2];
if (!catalogPath) {
  console.error("usage: audit-target-coverage.mjs <mcp-tool-catalog.json>");
  process.exit(2);
}
const { catalog } = JSON.parse(readFileSync(catalogPath, "utf8"));
const tiers = new Map(JSON.parse(readFileSync(join(root, "policy/tool-tiers.json"), "utf8")).tools.map((t) => [t.name, t.tier]));
const looks = /path|file|dir|root|url|uri|apk|binary|executable|application|origin|serial|device|package|bundle|snapshot|manifest|capture|source|input|archive|artifact|project|module/i;
const gaps = new Map();

const walk = (tool, schema, key, depth) => {
  if (!schema || depth > 6) return;
  if ([].concat(schema.type || []).includes("string") && key && looks.test(key) && extractTargets({ [key]: "rel/dir/x" }, "/work").length === 0) {
    const e = gaps.get(key) ?? { tools: new Set(), description: (schema.description || "").slice(0, 70) };
    e.tools.add(tool);
    gaps.set(key, e);
  }
  for (const [k, v] of Object.entries(schema.properties || {})) walk(tool, v, k, depth + 1);
  for (const alt of [...(schema.anyOf || []), ...(schema.oneOf || []), ...(schema.allOf || [])]) walk(tool, alt, key, depth + 1);
  if (schema.items) walk(tool, schema.items, key, depth + 1);
};
for (const t of catalog) if (tiers.get(t.name) <= 2) walk(t.name, t.inputSchema, "", 0);

console.log(`${gaps.size} path-like argument names not recognized for relative values (review each; most are digests, ids, states or URL fields):`);
for (const [k, e] of [...gaps].sort((a, b) => b[1].tools.size - a[1].tools.size))
  console.log(`  ${k.padEnd(34)} ${String(e.tools.size).padStart(2)} tools  e.g. ${[...e.tools].slice(0, 2).join(", ")}  ${e.description}`);

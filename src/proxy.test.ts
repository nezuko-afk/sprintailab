import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AuditLog, verifyChain } from "./audit.js";
import { loadTiers, Policy } from "./policy.js";
import { createProxyServer } from "./proxy.js";

const tiers = loadTiers(new URL("../policy/tool-tiers.json", import.meta.url));
const pick = (tier: number) => tiers.tools.find((t) => t.tier === tier)!.name;
const T0 = pick(0);
const T1 = pick(1);
const T2 = pick(2);
const T3 = pick(3);
const UNKNOWN = "brand_new_upstream_tool";

let calls: Array<{ tool: string; args: unknown }>;
let agent: Client;
let auditPath: string;
let cleanup: Array<() => Promise<void>>;

async function setup(maxTier: 0 | 1 | 2 | 3) {
  calls = [];
  cleanup = [];
  auditPath = join(mkdtempSync(join(tmpdir(), "proxy-")), "audit.jsonl");

  // Fake REA: registers one tool per tier plus one unknown tool.
  const rea = new McpServer({ name: "fake-rea", version: "0" });
  for (const name of [T0, T1, T2, T3, UNKNOWN]) {
    rea.registerTool(
      name,
      { description: `fake ${name}`, inputSchema: z.object({ target: z.string().optional() }) },
      async (args: { target?: string }) => {
        calls.push({ tool: name, args });
        return {
          content: [{ type: "text" as const, text: `ran ${name}` }],
          structuredContent: { evidence_id: `ev-${name}` },
        };
      },
    );
  }
  const [upClient, upServer] = InMemoryTransport.createLinkedPair();
  const upstream = new Client({ name: "proxy-upstream", version: "0" });
  await rea.connect(upServer);
  await upstream.connect(upClient);

  const proxy = createProxyServer({
    upstream,
    policy: new Policy(tiers, maxTier),
    audit: new AuditLog(auditPath, "tester"),
  });
  const [agentTransport, proxyTransport] = InMemoryTransport.createLinkedPair();
  agent = new Client({ name: "agent", version: "0" });
  await proxy.connect(proxyTransport);
  await agent.connect(agentTransport);

  cleanup.push(
    () => agent.close(),
    () => proxy.close(),
    () => upstream.close(),
    () => rea.close(),
  );
}

afterEach(async () => {
  await Promise.allSettled(cleanup.map((fn) => fn()));
});

const records = () =>
  readFileSync(auditPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);

describe("governance proxy (limit = tier 1)", () => {
  beforeEach(() => setup(1));

  it("lists only tools at or below the limit and hides unknown ones", async () => {
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([T0, T1].sort());
    const list = records().find((r) => r.event === "tool_list")!;
    expect(list).toMatchObject({ upstreamCount: 5, listed: 2, hiddenUnknown: 1, hiddenAboveTier: 2 });
  });

  it("forwards an allowed call with its arguments and returns the evidence", async () => {
    const result = await agent.callTool({ name: T1, arguments: { target: "/tmp/app" } });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([{ tool: T1, args: { target: "/tmp/app" } }]);
    expect(result.structuredContent).toMatchObject({ evidence_id: `ev-${T1}` });
    const res = records().find((r) => r.event === "tool_result")!;
    expect(res).toMatchObject({ tool: T1, outcome: "ok", evidenceId: `ev-${T1}` });
  });

  it("denies tier 2 and tier 3 calls without contacting REA", async () => {
    for (const name of [T2, T3]) {
      const result = await agent.callTool({ name, arguments: {} });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("R2-tier-above-limit");
    }
    expect(calls).toHaveLength(0);
  });

  it("denies unknown tools, even if the upstream would run them", async () => {
    const result = await agent.callTool({ name: UNKNOWN, arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("R1-unknown-tool");
    expect(calls).toHaveLength(0);
  });

  it("writes a verifiable audit trail and never stores raw arguments", async () => {
    await agent.callTool({ name: T0, arguments: { target: "/secret/path/app.exe" } });
    await agent.callTool({ name: T3, arguments: {} });
    expect(verifyChain(auditPath).ok).toBe(true);
    const raw = readFileSync(auditPath, "utf8");
    expect(raw).not.toContain("/secret/path");
    const call = records().filter((r) => r.event === "tool_call");
    expect(call.map((r) => r.decision)).toEqual(["allow", "deny"]);
    expect(call[0]!.argsSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("governance proxy (limit = tier 3)", () => {
  beforeEach(() => setup(3));

  it("allows every known tool but still blocks unknown ones", async () => {
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([T0, T1, T2, T3].sort());
    expect((await agent.callTool({ name: T3, arguments: {} })).isError).toBeFalsy();
    expect((await agent.callTool({ name: UNKNOWN, arguments: {} })).isError).toBe(true);
  });
});

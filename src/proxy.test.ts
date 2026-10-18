import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AuditLog, verifyChain } from "./audit.js";
import { AuthorizationStore } from "./authorization.js";
import { Gate } from "./gate.js";
import { loadTiers, Policy } from "./policy.js";
import { createProxyServer } from "./proxy.js";
import type { Tier } from "./types.js";

const tiers = loadTiers(new URL("../policy/tool-tiers.json", import.meta.url));
const T0 = tiers.tools.find((t) => t.tier === 0)!.name;
const OPEN = "open_binary"; // tier 1, names a path
const ANNOTATE = "set_comment"; // tier 1, names no target
const ADB = "inspect_adb_device"; // tier 2, names a serial
const T3 = "gdb_console"; // tier 3
const STATUS = "binary_session"; // tier 1, authorization exempt
const UNKNOWN = "brand_new_upstream_tool";

type PromptAnswer = { action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> };
interface Options {
  maxTier?: Tier;
  /** When set, the agent-side client can show prompts and answers with this function. */
  answer?: (message: string, schema: unknown) => PromptAnswer;
  elicit?: boolean;
}

let calls: Array<{ tool: string; args: unknown }>;
let prompts: Array<{ message: string; schema: any }>;
let agent: Client;
let auditPath: string;
let store: AuthorizationStore;
let cleanup: Array<() => Promise<void>> = [];

async function setup(opts: Options = {}) {
  calls = [];
  prompts = [];
  const dir = mkdtempSync(join(tmpdir(), "proxy-"));
  auditPath = join(dir, "audit.jsonl");
  store = new AuthorizationStore(join(dir, "authorizations.jsonl"));

  const rea = new McpServer({ name: "fake-rea", version: "0" });
  for (const name of [T0, OPEN, ANNOTATE, ADB, T3, STATUS, UNKNOWN]) {
    rea.registerTool(name, { description: `fake ${name}`, inputSchema: z.looseObject({}) }, async (args: unknown) => {
      calls.push({ tool: name, args });
      return { content: [{ type: "text" as const, text: `ran ${name}` }], structuredContent: { evidence_id: `ev-${name}` } };
    });
  }
  const [upClient, upServer] = InMemoryTransport.createLinkedPair();
  const upstream = new Client({ name: "proxy-upstream", version: "0" });
  await rea.connect(upServer);
  await upstream.connect(upClient);

  const proxy = createProxyServer({
    upstream,
    policy: new Policy(tiers, { maxTier: opts.maxTier ?? 2 }),
    gate: new Gate(store),
    store,
    audit: new AuditLog(auditPath, "tester"),
    actor: "tester",
    cwd: "/work",
    elicit: opts.elicit,
  });

  const [agentTransport, proxyTransport] = InMemoryTransport.createLinkedPair();
  agent = new Client({ name: "agent", version: "0" }, opts.answer ? { capabilities: { elicitation: { form: {} } } } : {});
  if (opts.answer) {
    const answer = opts.answer;
    agent.setRequestHandler("elicitation/create", async (request) => {
      const p = request.params as { message: string; requestedSchema: unknown };
      prompts.push({ message: p.message, schema: p.requestedSchema });
      return answer(p.message, p.requestedSchema) as never;
    });
  }
  await proxy.connect(proxyTransport);
  await agent.connect(agentTransport);
  cleanup = [() => agent.close(), () => proxy.close(), () => upstream.close(), () => rea.close()];
}

afterEach(async () => {
  await Promise.allSettled(cleanup.map((fn) => fn()));
});

const records = () =>
  readFileSync(auditPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, any>);
const text = (r: { content?: unknown }) => JSON.stringify(r.content);
const grantDirect = (scope: string, maxTier: 0 | 1 | 2 = 1, reference: string | null = null) =>
  store.grant({ declarant: "pritam", method: "cli", scopes: [scope], maxTier, reference, ttlMs: 3_600_000, cwd: "/work" });

describe("listing", () => {
  it("shows tools up to tier 2, hides tier 3 and unknown tools", async () => {
    await setup();
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([T0, OPEN, ANNOTATE, ADB, STATUS].sort());
    expect(records().find((r) => r.event === "tool_list")).toMatchObject({
      upstreamCount: 7,
      listed: 5,
      hiddenUnknown: 1,
      hiddenAboveTier: 1,
      hiddenSandbox: 0,
    });
  });

  it("counts tier 3 as hidden because of the missing sandbox when the limit is 3", async () => {
    await setup({ maxTier: 3 });
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name)).not.toContain(T3);
    expect(records().find((r) => r.event === "tool_list")).toMatchObject({ hiddenSandbox: 1, hiddenAboveTier: 0 });
  });

  it("hides tier 2 when the deployment limit is tier 1", async () => {
    await setup({ maxTier: 1 });
    const { tools } = await agent.listTools();
    expect(tools.map((t) => t.name)).not.toContain(ADB);
  });
});

describe("authorization without a prompt (client cannot ask)", () => {
  it("runs tier 0 and exempt status tools without any authorization", async () => {
    await setup();
    expect((await agent.callTool({ name: T0, arguments: {} })).isError).toBeFalsy();
    expect((await agent.callTool({ name: STATUS, arguments: {} })).isError).toBeFalsy();
  });

  it("denies a named target with no authorization and tells the person how to authorize", async () => {
    await setup();
    const r = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("R3-authorization-required");
    expect(text(r)).toContain('sprintailab authorize --scope \\"path:/work/clientA/app\\"');
    expect(calls).toHaveLength(0);
  });

  it("allows the call once a person has authorized the target, and records the authorization", async () => {
    await setup();
    const g = grantDirect("/work/clientA");
    const r = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app", architecture: "arm64" } });
    expect(r.isError).toBeFalsy();
    expect(calls).toEqual([{ tool: OPEN, args: { path: "/work/clientA/app", architecture: "arm64" } }]);
    const recs = records();
    expect(recs.find((x) => x.event === "authorization_observed")).toMatchObject({ authorizationId: g.id, declarant: "pritam", method: "cli" });
    expect(recs.find((x) => x.event === "tool_call")).toMatchObject({
      decision: "allow",
      targets: ["path:/work/clientA/app"],
      authorizationIds: [g.id],
    });
  });

  it("does not stretch an authorization to a different folder", async () => {
    await setup();
    grantDirect("/work/clientA");
    const r = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientB/app" } });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("stops allowing after revoke", async () => {
    await setup();
    const g = grantDirect("/work/clientA");
    expect((await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/x" } })).isError).toBeFalsy();
    store.revoke(g.id, "pritam");
    expect((await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/x" } })).isError).toBe(true);
  });

  it("a tier 1 authorization does not unlock a tier 2 tool on the same device", async () => {
    await setup();
    grantDirect("adb:ABC", 1);
    expect((await agent.callTool({ name: ADB, arguments: { serial: "ABC" } })).isError).toBe(true);
    grantDirect("adb:ABC", 2, "JIRA-9");
    expect((await agent.callTool({ name: ADB, arguments: { serial: "ABC" } })).isError).toBeFalsy();
  });

  it("denies a call that names no target until some authorization is active", async () => {
    await setup();
    const r = await agent.callTool({ name: ANNOTATE, arguments: { address: "0x10", comment: "x" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("No target is named");
    grantDirect("/work/clientA");
    expect((await agent.callTool({ name: ANNOTATE, arguments: { address: "0x10", comment: "x" } })).isError).toBeFalsy();
  });

  it("denies tier 3 even with a tier 2 authorization, and unknown tools always", async () => {
    await setup({ maxTier: 3 });
    grantDirect("/work/clientA", 2, "REF");
    const t3 = await agent.callTool({ name: T3, arguments: { path: "/work/clientA/app" } });
    expect(text(t3)).toContain("R4-sandbox-required");
    const unk = await agent.callTool({ name: UNKNOWN, arguments: {} });
    expect(text(unk)).toContain("R1-unknown-tool");
    expect(calls).toHaveLength(0);
  });
});

describe("authorization by prompting the person", () => {
  it("asks once, grants for that folder only, then runs the call and later calls without asking again", async () => {
    await setup({ answer: () => ({ action: "accept", content: { confirm: true, reference: "T-1", duration: "1h" } }) });
    const first = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app" } });
    expect(first.isError).toBeFalsy();
    expect(prompts).toHaveLength(1);
    expect(prompts[0]!.message).toContain("path:/work/clientA/app");
    expect(prompts[0]!.message).toContain("I own this target or hold written permission");
    expect(prompts[0]!.schema.required).toEqual(["confirm"]);

    const second = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app/lib" } });
    expect(second.isError).toBeFalsy();
    expect(prompts).toHaveLength(1);

    const g = store.active();
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ method: "elicitation", scopes: ["path:/work/clientA/app"], maxTier: 1, reference: "T-1" });
    expect(records().map((r) => r.event)).toContain("authorization_granted");
    expect(verifyChain(auditPath).ok).toBe(true);
  });

  it("does not run the tool when the person declines", async () => {
    await setup({ answer: () => ({ action: "decline" }) });
    const r = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("R5-authorization-declined");
    expect(calls).toHaveLength(0);
    expect(store.active()).toHaveLength(0);
    expect(records().map((x) => x.event)).toContain("authorization_declined");
  });

  it("does not accept an unconfirmed form", async () => {
    await setup({ answer: () => ({ action: "accept", content: { confirm: false } }) });
    const r = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app" } });
    expect(text(r)).toContain("R5-authorization-declined");
    expect(store.active()).toHaveLength(0);
  });

  it("requires a reference for tier 2 (a blank one is refused even if the client lets it through)", async () => {
    await setup({ answer: () => ({ action: "accept", content: { confirm: true, reference: "   " } }) });
    const blank = await agent.callTool({ name: ADB, arguments: { serial: "ABC" } });
    expect(text(blank)).toContain("R5-authorization-declined");
    expect(prompts[0]!.schema.required).toEqual(["confirm", "reference"]);
    expect(store.active()).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("grants tier 2 for the device when a reference is given, and no more than that call's tier", async () => {
    await setup({ answer: () => ({ action: "accept", content: { confirm: true, reference: "SOW-7", duration: "4h" } }) });
    const ok = await agent.callTool({ name: ADB, arguments: { serial: "ABC" } });
    expect(ok.isError).toBeFalsy();
    expect(store.active()[0]).toMatchObject({ maxTier: 2, reference: "SOW-7", scopes: ["adb:ABC"] });
  });

  it("falls back to terminal instructions if the client's own form validation rejects the answer", async () => {
    await setup({ answer: () => ({ action: "accept", content: { confirm: true } }) });
    const r = await agent.callTool({ name: ADB, arguments: { serial: "ABC" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("R3-authorization-required");
    expect(calls).toHaveLength(0);
  });

  it("asks for a scope when the call names no target", async () => {
    await setup({ answer: () => ({ action: "accept", content: { confirm: true, scope: "/work/clientA/app" } }) });
    const r = await agent.callTool({ name: ANNOTATE, arguments: { address: "0x10", comment: "x" } });
    expect(r.isError).toBeFalsy();
    expect(prompts[0]!.schema.required).toEqual(["confirm", "scope"]);
    expect(store.active()[0]!.scopes).toEqual(["path:/work/clientA/app"]);
  });

  it("rejects a too-broad scope typed into the prompt", async () => {
    await setup({ answer: () => ({ action: "accept", content: { confirm: true, scope: "/" } }) });
    const r = await agent.callTool({ name: ANNOTATE, arguments: { address: "0x10", comment: "x" } });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("too broad");
    expect(calls).toHaveLength(0);
  });

  it("falls back to the terminal instructions when prompting is turned off", async () => {
    await setup({ elicit: false, answer: () => ({ action: "accept", content: { confirm: true } }) });
    const r = await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app" } });
    expect(text(r)).toContain("R3-authorization-required");
    expect(prompts).toHaveLength(0);
  });
});

describe("audit", () => {
  it("keeps a verifiable chain and stores targets but never raw argument content", async () => {
    await setup();
    grantDirect("/work/clientA");
    await agent.callTool({ name: OPEN, arguments: { path: "/work/clientA/app", entry_point: "SECRET_SYMBOL" } });
    await agent.callTool({ name: T3, arguments: {} });
    expect(verifyChain(auditPath).ok).toBe(true);
    const raw = readFileSync(auditPath, "utf8");
    expect(raw).not.toContain("SECRET_SYMBOL");
    const calls_ = records().filter((r) => r.event === "tool_call");
    expect(calls_.map((r) => r.decision)).toEqual(["allow", "deny"]);
    expect(calls_[0]!.argsSha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

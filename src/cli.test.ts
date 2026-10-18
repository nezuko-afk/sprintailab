import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog } from "./audit.js";
import { AuthorizationStore } from "./authorization.js";
import { runCli, type CliIO } from "./cli.js";

function harness(over: Partial<CliIO> = {}, answer = "YES") {
  const home = mkdtempSync(join(tmpdir(), "cli-"));
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    out: (t) => out.push(t),
    err: (t) => err.push(t),
    ask: async () => answer,
    interactive: true,
    cwd: "/work",
    env: { SPRINTAIL_HOME: home },
    actor: "pritam",
    ...over,
  };
  const store = new AuthorizationStore(join(home, "authorizations.jsonl"));
  return { io, out, err, home, store, run: (...argv: string[]) => runCli(argv, io) };
}

describe("sprintailab authorize", () => {
  it("refuses to run without an interactive terminal, so an agent's shell cannot self-authorize", async () => {
    const h = harness({ interactive: false });
    expect(await h.run("authorize", "--scope", "/work/clientA/app")).toBe(2);
    expect(h.err.join("\n")).toContain("interactive terminal");
    expect(existsSync(join(h.home, "authorizations.jsonl"))).toBe(false);
  });

  it("grants after the person types YES", async () => {
    const h = harness();
    expect(await h.run("authorize", "--scope", "/work/clientA/app", "--ttl", "2h")).toBe(0);
    expect(h.store.active()[0]).toMatchObject({ method: "cli", declarant: "pritam", scopes: ["path:/work/clientA/app"], maxTier: 1 });
  });

  it("grants nothing for any other answer", async () => {
    const h = harness({}, "yes please");
    expect(await h.run("authorize", "--scope", "/work/clientA/app")).toBe(1);
    expect(h.store.active()).toHaveLength(0);
  });

  it("enforces tier 2 reference, tier 3 refusal, scope breadth and ttl cap", async () => {
    const h = harness();
    expect(await h.run("authorize", "--scope", "adb:ABC", "--tier", "2")).toBe(1);
    expect(h.err.join("\n")).toContain("--reference");
    expect(await h.run("authorize", "--scope", "adb:ABC", "--tier", "3", "--reference", "R")).toBe(1);
    expect(await h.run("authorize", "--scope", "/", "--tier", "1")).toBe(1);
    expect(await h.run("authorize", "--scope", "/work/a/b", "--ttl", "48h")).toBe(1);
    expect(h.store.active()).toHaveLength(0);
    expect(await h.run("authorize", "--scope", "adb:ABC", "--tier", "2", "--reference", "JIRA-1")).toBe(0);
  });
});

describe("sprintailab list / revoke / verify-audit", () => {
  it("lists active authorizations and revokes by id", async () => {
    const h = harness();
    await h.run("authorize", "--scope", "/work/clientA/app");
    const id = h.store.active()[0]!.id;
    expect(await h.run("list")).toBe(0);
    expect(h.out.join("\n")).toContain(id);
    expect(await h.run("revoke", id)).toBe(0);
    expect(h.store.active()).toHaveLength(0);
    expect(await h.run("revoke", id)).toBe(1);
    h.out.length = 0;
    await h.run("list", "--all");
    expect(h.out.join("\n")).toContain("revoked");
  });

  it("verifies the audit log and flags tampering", async () => {
    const h = harness();
    const path = join(h.home, "audit.jsonl");
    const log = new AuditLog(path, "t");
    log.append("a");
    log.append("b");
    expect(await h.run("verify-audit")).toBe(0);
    writeFileSync(path, "{\"seq\":1}\n");
    expect(await h.run("verify-audit")).toBe(1);
  });

  it("prints usage for unknown commands", async () => {
    const h = harness();
    expect(await h.run("frobnicate")).toBe(2);
    expect(await h.run()).toBe(2);
  });
});

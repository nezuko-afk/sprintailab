import { mkdtempSync, readFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthorizationStore, coverage, MAX_TTL_MS, parseTtl } from "./authorization.js";

const HOUR = 3_600_000;
function setup() {
  let now = Date.parse("2026-10-18T10:00:00Z");
  const path = join(mkdtempSync(join(tmpdir(), "auth-")), "sub", "authorizations.jsonl");
  const store = new AuthorizationStore(path, () => now);
  return { store, path, advance: (ms: number) => (now += ms) };
}
const base = { declarant: "pritam", method: "cli" as const, cwd: "/work", ttlMs: 4 * HOUR };

describe("AuthorizationStore", () => {
  it("grants, lists and expires", () => {
    const { store, advance } = setup();
    const g = store.grant({ ...base, scopes: ["/work/clientA/app"], maxTier: 1 });
    expect(store.active().map((a) => a.id)).toEqual([g.id]);
    expect(g.scopes).toEqual(["path:/work/clientA/app"]);
    advance(4 * HOUR + 1);
    expect(store.active()).toEqual([]);
  });

  it("revokes", () => {
    const { store } = setup();
    const g = store.grant({ ...base, scopes: ["/work/clientA/app"], maxTier: 1 });
    expect(store.revoke(g.id, "pritam")).toBe(true);
    expect(store.active()).toEqual([]);
    expect(store.revoke(g.id, "pritam")).toBe(false);
  });

  it("requires a reference for tier 2 and caps the duration", () => {
    const { store } = setup();
    expect(() => store.grant({ ...base, scopes: ["adb:ABC"], maxTier: 2 })).toThrow(/reference/);
    expect(() => store.grant({ ...base, scopes: ["adb:ABC"], maxTier: 2, reference: "  " })).toThrow(/reference/);
    expect(store.grant({ ...base, scopes: ["adb:ABC"], maxTier: 2, reference: "JIRA-12" }).reference).toBe("JIRA-12");
    expect(() => store.grant({ ...base, scopes: ["adb:ABC"], maxTier: 1, ttlMs: MAX_TTL_MS + 1 })).toThrow(/24 hours/);
  });

  it("rejects broad scopes and empty scope lists", () => {
    const { store } = setup();
    expect(() => store.grant({ ...base, scopes: ["/"], maxTier: 1 })).toThrow(/too broad/);
    expect(() => store.grant({ ...base, scopes: [], maxTier: 1 })).toThrow();
  });

  it("ignores corrupt lines instead of granting anything", () => {
    const { store, path } = setup();
    store.grant({ ...base, scopes: ["/work/a/b"], maxTier: 1 });
    appendFileSync(path, "garbage\n{\"type\":\"grant\"\n");
    expect(store.active()).toHaveLength(1);
  });

  it("writes an owner-only file", () => {
    const { store, path } = setup();
    store.grant({ ...base, scopes: ["/work/a/b"], maxTier: 1 });
    expect(readFileSync(path, "utf8")).toContain('"type":"grant"');
  });
});

describe("coverage", () => {
  it("needs every target covered by an authorization of sufficient tier", () => {
    const { store } = setup();
    store.grant({ ...base, scopes: ["/work/a/b"], maxTier: 1 });
    const active = store.active();
    const t1 = { kind: "path" as const, value: "/work/a/b/bin" };
    const t2 = { kind: "path" as const, value: "/work/other/x" };
    expect(coverage(active, 1, [t1], "/work").covered).toBe(true);
    expect(coverage(active, 1, [t1, t2], "/work").uncovered).toEqual([t2]);
    expect(coverage(active, 2, [t1], "/work").covered).toBe(false);
  });
});

describe("parseTtl", () => {
  it("parses minutes and hours and rejects junk", () => {
    expect(parseTtl("30m")).toBe(1_800_000);
    expect(parseTtl("4h")).toBe(4 * HOUR);
    expect(() => parseTtl("4d")).toThrow();
    expect(() => parseTtl("0h")).toThrow();
  });
});

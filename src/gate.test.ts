import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuthorizationStore } from "./authorization.js";
import { Gate } from "./gate.js";

const store = () => new AuthorizationStore(join(mkdtempSync(join(tmpdir(), "gate-")), "a.jsonl"));
const grant = (s: AuthorizationStore, scope: string, maxTier: 0 | 1 | 2 = 1) =>
  s.grant({ declarant: "p", method: "cli", scopes: [scope], maxTier, reference: "REF-1", ttlMs: 3_600_000, cwd: "/work" });
const input = (over: Partial<Parameters<Gate["check"]>[0]>) => ({ tier: 1 as const, args: {}, exempt: false, cwd: "/work", ...over });

describe("Gate", () => {
  it("lets tier 0 calls that name no target run freely", () => {
    expect(new Gate(store()).check(input({ tier: 0 })).status).toBe("allow");
  });

  it("lets exempt status tools run freely", () => {
    expect(new Gate(store()).check(input({ exempt: true })).status).toBe("allow");
  });

  it("requires authorization for a named target, even at tier 0", () => {
    const g = new Gate(store());
    const r = g.check(input({ tier: 0, args: { path: "/work/app/x" } }));
    expect(r).toMatchObject({ status: "needs-authorization", noTarget: false });
  });

  it("allows a target covered by an active authorization and reports which one", () => {
    const s = store();
    const a = grant(s, "/work/app");
    const r = new Gate(s).check(input({ args: { path: "/work/app/bin/tool" } }));
    expect(r).toMatchObject({ status: "allow", authorizationIds: [a.id] });
  });

  it("reports only the uncovered targets", () => {
    const s = store();
    grant(s, "/work/app");
    const r = new Gate(s).check(input({ args: { paths: ["/work/app/a", "/work/other/b"] } }));
    expect(r.status).toBe("needs-authorization");
    if (r.status === "needs-authorization") expect(r.uncovered.map((t) => t.value)).toEqual(["/work/other/b"]);
  });

  it("does not let a tier 1 authorization cover a tier 2 call", () => {
    const s = store();
    grant(s, "adb:ABC", 1);
    expect(new Gate(s).check(input({ tier: 2, args: { serial: "ABC" } })).status).toBe("needs-authorization");
    grant(s, "adb:ABC", 2);
    expect(new Gate(s).check(input({ tier: 2, args: { serial: "ABC" } })).status).toBe("allow");
  });

  it("needs any active authorization when a tier 1 call names no target", () => {
    const s = store();
    const gate = new Gate(s);
    expect(gate.check(input({ args: { address: "0x10" } }))).toMatchObject({ status: "needs-authorization", noTarget: true });
    grant(s, "/work/app");
    expect(gate.check(input({ args: { address: "0x10" } })).status).toBe("allow");
  });

  it("stops allowing once the authorization is revoked", () => {
    const s = store();
    const a = grant(s, "/work/app");
    const gate = new Gate(s);
    expect(gate.check(input({ args: { path: "/work/app" } })).status).toBe("allow");
    s.revoke(a.id, "p");
    expect(gate.check(input({ args: { path: "/work/app" } })).status).toBe("needs-authorization");
  });
});

import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLog, verifyChain } from "./audit.js";

const tmpLog = () => join(mkdtempSync(join(tmpdir(), "audit-")), "nested", "audit.jsonl");

describe("AuditLog", () => {
  it("creates the file and verifies a clean chain", () => {
    const path = tmpLog();
    const log = new AuditLog(path, "tester");
    log.append("startup", { a: 1 });
    log.append("tool_call", { tool: "x" });
    log.append("shutdown");
    expect(verifyChain(path)).toEqual({ ok: true, records: 3 });
  });

  it("continues the chain after reopening", () => {
    const path = tmpLog();
    new AuditLog(path, "tester").append("one");
    const again = new AuditLog(path, "tester");
    const rec = again.append("two");
    expect(rec.seq).toBe(2);
    expect(verifyChain(path)).toEqual({ ok: true, records: 2 });
  });

  it("detects an edited record", () => {
    const path = tmpLog();
    const log = new AuditLog(path, "tester");
    log.append("tool_call", { tool: "a", decision: "deny" });
    log.append("tool_call", { tool: "b", decision: "allow" });
    const tampered = readFileSync(path, "utf8").replace('"decision":"deny"', '"decision":"allow"');
    writeFileSync(path, tampered);
    expect(verifyChain(path)).toMatchObject({ ok: false, brokenAt: 1, reason: "hash mismatch" });
  });

  it("detects a deleted record", () => {
    const path = tmpLog();
    const log = new AuditLog(path, "tester");
    log.append("one");
    log.append("two");
    log.append("three");
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    writeFileSync(path, [lines[0], lines[2]].join("\n") + "\n");
    expect(verifyChain(path).ok).toBe(false);
  });

  it("detects garbage appended to the file", () => {
    const path = tmpLog();
    new AuditLog(path, "tester").append("one");
    appendFileSync(path, "not json\n");
    expect(verifyChain(path)).toMatchObject({ ok: false, reason: "unparseable line" });
  });
});

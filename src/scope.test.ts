import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { parseScope, scopeCovers, scopeString } from "./scope.js";

const s = (text: string) => parseScope(text, "/work");
const covers = (scope: string, kind: string, value: string) => scopeCovers(s(scope), { kind: kind as never, value });

describe("parseScope", () => {
  it("accepts prefixed and bare forms", () => {
    expect(scopeString(s("path:/work/clientA/app"))).toBe("path:/work/clientA/app");
    expect(scopeString(s("/work/clientA/app"))).toBe("path:/work/clientA/app");
    expect(scopeString(s("https://App.example.com/x"))).toBe("origin:https://app.example.com");
    expect(scopeString(s("host:*.example.com"))).toBe("host:*.example.com");
    expect(scopeString(s("adb:R5CT123"))).toBe("adb:R5CT123");
  });

  it("rejects overly broad scopes", () => {
    for (const bad of ["path:/", "/tmp", homedir(), "host:*.com", "host:com", "host:*", "adb:*", "package:com.*"])
      expect(() => s(bad), bad).toThrow();
  });

  it("rejects things it cannot classify", () => {
    expect(() => s("somewhere")).toThrow();
    expect(() => s("")).toThrow();
  });
});

describe("scopeCovers", () => {
  it("covers the folder itself and everything under it, but not siblings with the same prefix", () => {
    expect(covers("/work/app", "path", "/work/app")).toBe(true);
    expect(covers("/work/app", "path", "/work/app/bin/tool")).toBe(true);
    expect(covers("/work/app", "path", "/work/application")).toBe(false);
    expect(covers("/work/app", "path", "/work")).toBe(false);
  });

  it("matches origins exactly and hosts by wildcard with a dot boundary", () => {
    expect(covers("origin:https://a.example.com", "origin", "https://a.example.com")).toBe(true);
    expect(covers("origin:https://a.example.com", "origin", "http://a.example.com")).toBe(false);
    expect(covers("host:*.example.com", "origin", "https://x.example.com")).toBe(true);
    expect(covers("host:*.example.com", "origin", "https://example.com")).toBe(false);
    expect(covers("host:*.example.com", "origin", "https://evilexample.com")).toBe(false);
    expect(covers("host:example.com", "origin", "https://example.com:8443")).toBe(true);
  });

  it("does not mix kinds", () => {
    expect(covers("adb:R5CT123", "adb", "R5CT123")).toBe(true);
    expect(covers("adb:R5CT123", "device", "R5CT123")).toBe(false);
    expect(covers("/work/app", "origin", "https://x.com")).toBe(false);
  });
});

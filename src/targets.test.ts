import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonPath, extractTargets, targetKey } from "./targets.js";

const keysOf = (args: unknown, cwd = "/work") => extractTargets(args, cwd).map(targetKey).sort();

describe("extractTargets", () => {
  it("finds URL origins, including nested arrays and objects", () => {
    expect(keysOf({ start_url: { url: "https://App.Example.com/login?x=1" }, allowed_origins: ["http://a.test:8080/x"] })).toEqual([
      "origin:http://a.test:8080",
      "origin:https://app.example.com",
    ]);
  });

  it("finds absolute paths under any key and relative paths under path-like keys", () => {
    expect(keysOf({ path: "app/bin", other: "/opt/client/tool", note: "hello world" }, "/work")).toEqual([
      "path:/opt/client/tool",
      "path:/work/app/bin",
    ]);
  });

  it("resolves .. so a path cannot escape its scope lexically", () => {
    expect(keysOf({ path: "/work/clientA/../clientB/app" })).toEqual(["path:/work/clientB/app"]);
  });

  it("follows symlinks so a link cannot point outside an authorized folder", () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), "tg-")));
    mkdirSync(join(base, "secret"));
    mkdirSync(join(base, "allowed"));
    symlinkSync(join(base, "secret"), join(base, "allowed", "link"));
    expect(canonPath(join(base, "allowed", "link"), "/")).toBe(join(base, "secret"));
  });

  it("expands ~", () => {
    expect(keysOf({ path: "~/proj/app" })).toEqual([`path:${canonPath(join(homedir(), "proj/app"), "/")}`]);
  });

  it("recognizes adb serials, device ids and package names", () => {
    expect(keysOf({ serial: "R5CT123", device_id: "usb", package: "com.example.app" })).toEqual([
      "adb:R5CT123",
      "device:usb",
      "package:com.example.app",
    ]);
  });

  it("handles file:// URLs", () => {
    expect(keysOf({ source: "file:///opt/client/app.js" })).toEqual(["path:/opt/client/app.js"]);
  });

  it("ignores outputs, expectations and plain text", () => {
    expect(
      keysOf({
        output_directory: "/tmp/out",
        expected_server_path: "/usr/bin/rea",
        command: "info registers",
        address: "0x401000",
        comment: "see /etc/passwd for more",
      }),
    ).toEqual([]);
  });

  it("deduplicates repeated targets", () => {
    expect(keysOf({ path: "/a/b/c", paths: ["/a/b/c", "/a/b/c"] })).toEqual(["path:/a/b/c"]);
  });

  it("copes with very deep or very large input without throwing", () => {
    let deep: unknown = { path: "/x/y/z" };
    for (let i = 0; i < 50; i++) deep = { n: deep };
    expect(() => extractTargets(deep, "/")).not.toThrow();
    const big = { paths: Array.from({ length: 10_000 }, (_, i) => `/data/f${i}`) };
    expect(extractTargets(big, "/").length).toBeLessThanOrEqual(2001);
  });
});

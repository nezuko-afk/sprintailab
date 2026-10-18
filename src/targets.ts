import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TargetKind = "path" | "origin" | "adb" | "package" | "device";

/** Something a tool call will touch: a file, a web origin, a device, a package. */
export interface Target {
  kind: TargetKind;
  value: string;
}

export const targetKey = (t: Target): string => `${t.kind}:${t.value}`;

const URL_RX = /^(https?|wss?):\/\/\S+$/i;
const FILE_URL_RX = /^file:\/\//i;
const ABS_PATH_RX = /^(\/|~\/|~$|[A-Za-z]:[\\/])/;
const WIN_DRIVE_RX = /^[A-Za-z]:[\\/]/;
/** Keys whose string values are paths even when written relative. */
const PATH_KEY_RX = /(^|_)(path|paths|dir|dirs|directory|root|roots|file|files|executable|apk)$/i;
/** Keys that describe outputs, expectations, limits or flags, not analysis targets. */
const SKIP_KEY_RX = /^(output|expected|max_|include_|fetch_)/i;

const MAX_STRINGS = 2000;
const MAX_DEPTH = 8;

/** Canonical absolute path: tilde expanded, `..` resolved, symlinks followed where the path exists. */
export function canonPath(input: string, cwd: string): string {
  let p = input;
  if (p === "~" || p.startsWith("~/")) p = homedir() + p.slice(1);
  if (WIN_DRIVE_RX.test(p)) return p[0]!.toLowerCase() + ":" + p.slice(2).replace(/\\/g, "/").replace(/\/+$/, "");
  const abs = resolve(cwd, p);
  try {
    return realpathSync(abs);
  } catch {
    // The target may not exist yet. Resolve the parent so symlinked parents still count.
    try {
      return join(realpathSync(dirname(abs)), basename(abs));
    } catch {
      return abs;
    }
  }
}

export function originOf(url: string): string | undefined {
  try {
    const u = new URL(url);
    return u.origin === "null" ? undefined : u.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Finds the targets named in a tool call's arguments by walking every string value.
 * Heuristic by design: it recognizes URLs, absolute paths, path-like keys, adb serials,
 * device ids and package names. Output locations and expectation fields are ignored.
 */
export function extractTargets(args: unknown, cwd: string): Target[] {
  const found = new Map<string, Target>();
  let visited = 0;

  const add = (t: Target): void => {
    found.set(targetKey(t), t);
  };

  const visit = (value: unknown, key: string, depth: number): void => {
    if (depth > MAX_DEPTH || visited > MAX_STRINGS) return;
    if (typeof value === "string") {
      visited++;
      if (!value || value.length > 4096 || SKIP_KEY_RX.test(key)) return;
      if (URL_RX.test(value)) {
        const origin = originOf(value);
        if (origin) add({ kind: "origin", value: origin });
        return;
      }
      if (FILE_URL_RX.test(value)) {
        try {
          add({ kind: "path", value: canonPath(fileURLToPath(value), cwd) });
        } catch {
          /* malformed file URL: ignore */
        }
        return;
      }
      if (key === "serial") return add({ kind: "adb", value });
      if (key === "device_id") return add({ kind: "device", value });
      if (key === "package" || key === "package_name") return add({ kind: "package", value });
      if (PATH_KEY_RX.test(key)) return add({ kind: "path", value: canonPath(value, cwd) });
      if (ABS_PATH_RX.test(value) && !/\s/.test(value)) add({ kind: "path", value: canonPath(value, cwd) });
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) visit(v, k, depth + 1);
    }
  };

  visit(args, "", 0);
  return [...found.values()];
}

import { homedir } from "node:os";
import { canonPath, originOf, type Target } from "./targets.js";

export type ScopeKind = "path" | "origin" | "host" | "adb" | "package" | "device";

export interface Scope {
  kind: ScopeKind;
  value: string;
}

export const scopeString = (s: Scope): string => `${s.kind}:${s.value}`;

const KINDS: ScopeKind[] = ["path", "origin", "host", "adb", "package", "device"];

/**
 * Parses a scope such as `path:/work/clientA/app`, `origin:https://app.example.com`,
 * `host:*.example.com`, `adb:R5CT123`, `package:com.example.app` or `device:local`.
 * Bare paths and URLs are accepted. Overly broad scopes are rejected.
 */
export function parseScope(input: string, cwd: string): Scope {
  const text = input.trim();
  if (!text) throw new Error("Empty scope");
  const m = /^([a-z]+):(.*)$/.exec(text);
  const prefix = m?.[1] as ScopeKind | undefined;
  if (prefix && KINDS.includes(prefix) && !/^[A-Za-z]:[\\/]/.test(text)) {
    return validate({ kind: prefix, value: m![2]!.trim() }, cwd);
  }
  if (/^https?:\/\//i.test(text)) return validate({ kind: "origin", value: text }, cwd);
  if (/^(\/|\.\/|\.\.\/|~)/.test(text) || /^[A-Za-z]:[\\/]/.test(text)) return validate({ kind: "path", value: text }, cwd);
  throw new Error(`Cannot tell what "${input}" is. Use path:, origin:, host:, adb:, package: or device:.`);
}

function validate(scope: Scope, cwd: string): Scope {
  const { kind } = scope;
  let { value } = scope;
  if (!value) throw new Error(`Empty ${kind} scope`);
  if (/[\s]/.test(value) && kind !== "path") throw new Error(`${kind} scope must not contain spaces`);

  if (kind === "path") {
    value = canonPath(value, cwd);
    const home = homedir();
    const segments = value.replace(/^[a-z]:/, "").split("/").filter(Boolean);
    if (value === "/" || value === home || home.startsWith(value + "/") || segments.length < 2)
      throw new Error(`Path scope "${value}" is too broad. Name the specific app, project or client folder.`);
    return { kind, value };
  }
  if (kind === "origin") {
    const origin = originOf(value);
    if (!origin) throw new Error(`Invalid origin "${value}". Example: https://app.example.com`);
    return { kind, value: origin };
  }
  if (kind === "host") {
    value = value.toLowerCase();
    const bare = value.startsWith("*.") ? value.slice(2) : value;
    if (bare.includes("*")) throw new Error("Wildcards are only allowed as a leading '*.'");
    if (bare.split(".").filter(Boolean).length < 2) throw new Error(`Host scope "${value}" is too broad`);
    return { kind, value };
  }
  if (value.includes("*")) throw new Error(`Wildcards are not allowed in ${kind} scopes`);
  return { kind, value };
}

function hostMatches(pattern: string, host: string): boolean {
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1;
  return host === pattern;
}

/** True when `scope` authorizes `target`. */
export function scopeCovers(scope: Scope, target: Target): boolean {
  switch (scope.kind) {
    case "path": {
      if (target.kind !== "path") return false;
      const base = scope.value.replace(/\/+$/, "");
      return target.value === base || target.value.startsWith(base + "/");
    }
    case "origin":
      return target.kind === "origin" && target.value === scope.value;
    case "host": {
      if (target.kind !== "origin") return false;
      try {
        return hostMatches(scope.value, new URL(target.value).hostname);
      } catch {
        return false;
      }
    }
    default:
      return scope.kind === target.kind && scope.value === target.value;
  }
}

import { homedir } from "node:os";
import { userInfo } from "node:os";
import { join } from "node:path";
import type { Tier } from "./types.js";

export interface ProxyConfig {
  reaCommand: string;
  reaArgs: string[];
  tiersPath: URL;
  auditPath: string;
  maxTier: Tier;
  actor: string;
}

function parseTier(value: string | undefined, fallback: Tier): Tier {
  if (value === undefined || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 3) throw new Error(`SPRINTAIL_MAX_TIER must be 0-3, got "${value}"`);
  return n as Tier;
}

function parseArgs(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string"))
    throw new Error("SPRINTAIL_REA_ARGS must be a JSON array of strings");
  return parsed;
}

/**
 * Environment variables:
 *   SPRINTAIL_MAX_TIER      highest allowed tier, 0-3 (default 1)
 *   SPRINTAIL_REA_COMMAND   command that starts REA (default "npx")
 *   SPRINTAIL_REA_ARGS      JSON array of args (default ["-y","rea-agents@<tiers version>","mcp"])
 *   SPRINTAIL_AUDIT_PATH    audit log file (default ./audit/audit.jsonl)
 *   SPRINTAIL_ACTOR         identity recorded in the audit log (default OS user)
 */
export function loadConfig(env: NodeJS.ProcessEnv, tiersVersion: string): ProxyConfig {
  return {
    reaCommand: env.SPRINTAIL_REA_COMMAND ?? "npx",
    reaArgs: env.SPRINTAIL_REA_ARGS ? parseArgs(env.SPRINTAIL_REA_ARGS) : ["-y", `rea-agents@${tiersVersion}`, "mcp"],
    tiersPath: new URL("../policy/tool-tiers.json", import.meta.url),
    auditPath: env.SPRINTAIL_AUDIT_PATH ?? join(process.cwd(), "audit", "audit.jsonl"),
    maxTier: parseTier(env.SPRINTAIL_MAX_TIER, 1),
    actor: env.SPRINTAIL_ACTOR ?? safeUser(),
  };
}

function safeUser(): string {
  try {
    return userInfo().username;
  } catch {
    return homedir();
  }
}

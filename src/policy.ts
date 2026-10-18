import { readFileSync } from "node:fs";
import type { Tier, TierToolEntry, TiersFile } from "./types.js";

export type Decision =
  | { allow: true; tier: Tier; ruleId: "R0-allow"; authExempt: boolean }
  | {
      allow: false;
      ruleId: "R1-unknown-tool" | "R2-tier-above-limit" | "R4-sandbox-required";
      reason: string;
      tier?: Tier;
    };

export function loadTiers(path: string | URL): TiersFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as TiersFile;
  if (!parsed || !Array.isArray(parsed.tools)) throw new Error("Invalid tiers file: missing tools array");
  for (const t of parsed.tools) {
    if (typeof t.name !== "string" || ![0, 1, 2, 3].includes(t.tier))
      throw new Error(`Invalid tiers file entry: ${JSON.stringify(t)}`);
  }
  return parsed;
}

export interface PolicyOptions {
  /** Highest tier this deployment may use, 0 to 3. */
  maxTier: Tier;
  /**
   * Tier 3 tools run or instrument code and must run inside a sandbox. There is no sandbox
   * controller yet, so this stays false and tier 3 is always denied. Do not make it an env flag.
   */
  sandboxAvailable?: boolean;
}

/** Tier-based allow/deny with fail-closed handling of unknown tools. */
export class Policy {
  private readonly byName = new Map<string, TierToolEntry>();
  readonly maxTier: Tier;
  private readonly sandboxAvailable: boolean;

  constructor(tiers: TiersFile, options: PolicyOptions) {
    for (const t of tiers.tools) this.byName.set(t.name, t);
    this.maxTier = options.maxTier;
    this.sandboxAvailable = options.sandboxAvailable ?? false;
  }

  decide(toolName: string): Decision {
    const entry = this.byName.get(toolName);
    if (entry === undefined)
      return {
        allow: false,
        ruleId: "R1-unknown-tool",
        reason: "Tool is not in the approved tier list (fail closed).",
      };
    const tier = entry.tier;
    if (tier > this.maxTier)
      return {
        allow: false,
        ruleId: "R2-tier-above-limit",
        tier,
        reason: `Tier ${tier} is above this deployment's limit of tier ${this.maxTier}.`,
      };
    if (tier === 3 && !this.sandboxAvailable)
      return {
        allow: false,
        ruleId: "R4-sandbox-required",
        tier,
        reason: "Tier 3 tools execute or modify things and need a sandbox, which is not available yet.",
      };
    return { allow: true, tier, ruleId: "R0-allow", authExempt: entry.authExempt === true };
  }
}

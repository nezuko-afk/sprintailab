import { readFileSync } from "node:fs";
import type { Tier, TiersFile } from "./types.js";

export type Decision =
  | { allow: true; tier: Tier; ruleId: "R0-allow" }
  | { allow: false; ruleId: "R1-unknown-tool" | "R2-tier-above-limit"; reason: string; tier?: Tier };

export function loadTiers(path: string | URL): TiersFile {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as TiersFile;
  if (!parsed || !Array.isArray(parsed.tools)) throw new Error("Invalid tiers file: missing tools array");
  for (const t of parsed.tools) {
    if (typeof t.name !== "string" || ![0, 1, 2, 3].includes(t.tier))
      throw new Error(`Invalid tiers file entry: ${JSON.stringify(t)}`);
  }
  return parsed;
}

/**
 * Phase 1 policy: tier-based allow/deny with fail-closed handling of unknown tools.
 * `maxTier` is the highest tier allowed without the authorization gate (not built yet),
 * so tiers above it are denied outright.
 */
export class Policy {
  private readonly byName = new Map<string, Tier>();

  constructor(
    tiers: TiersFile,
    readonly maxTier: Tier,
  ) {
    for (const t of tiers.tools) this.byName.set(t.name, t.tier);
  }

  tierOf(toolName: string): Tier | undefined {
    return this.byName.get(toolName);
  }

  decide(toolName: string): Decision {
    const tier = this.byName.get(toolName);
    if (tier === undefined)
      return {
        allow: false,
        ruleId: "R1-unknown-tool",
        reason: "Tool is not in the approved tier list (fail closed).",
      };
    if (tier > this.maxTier)
      return {
        allow: false,
        ruleId: "R2-tier-above-limit",
        tier,
        reason: `Tier ${tier} tools need authorization controls that are not enabled (limit is tier ${this.maxTier}).`,
      };
    return { allow: true, tier, ruleId: "R0-allow" };
  }
}

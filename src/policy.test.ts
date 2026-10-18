import { describe, expect, it } from "vitest";
import { loadTiers, Policy } from "./policy.js";

const tiers = loadTiers(new URL("../policy/tool-tiers.json", import.meta.url));
const first = (tier: number) => tiers.tools.find((t) => t.tier === tier)!.name;

describe("Policy", () => {
  it("loads all 207 REA tools", () => {
    expect(tiers.tools).toHaveLength(207);
  });

  it("allows tools at or below the limit", () => {
    const p = new Policy(tiers, 1);
    expect(p.decide(first(0))).toMatchObject({ allow: true, tier: 0 });
    expect(p.decide(first(1))).toMatchObject({ allow: true, tier: 1 });
  });

  it("denies tools above the limit with R2", () => {
    const p = new Policy(tiers, 1);
    expect(p.decide(first(2))).toMatchObject({ allow: false, ruleId: "R2-tier-above-limit", tier: 2 });
    expect(p.decide(first(3))).toMatchObject({ allow: false, ruleId: "R2-tier-above-limit", tier: 3 });
  });

  it("fails closed on unknown tools with R1", () => {
    const p = new Policy(tiers, 3);
    expect(p.decide("totally_new_tool")).toMatchObject({ allow: false, ruleId: "R1-unknown-tool" });
  });

  it("a limit of 3 allows every listed tool", () => {
    const p = new Policy(tiers, 3);
    expect(tiers.tools.every((t) => p.decide(t.name).allow)).toBe(true);
  });

  it("never allows a code-executing tool below tier 3", () => {
    const p = new Policy(tiers, 2);
    for (const name of ["gdb_console", "load_frida_script", "capture_process_scenario", "install_adb_package"])
      expect(p.decide(name).allow).toBe(false);
  });
});

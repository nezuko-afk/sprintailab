import { describe, expect, it } from "vitest";
import { loadTiers, Policy } from "./policy.js";

const tiers = loadTiers(new URL("../policy/tool-tiers.json", import.meta.url));
const first = (tier: number) => tiers.tools.find((t) => t.tier === tier)!.name;

describe("Policy", () => {
  it("loads all 207 REA tools", () => {
    expect(tiers.tools).toHaveLength(207);
  });

  it("allows tools at or below the limit", () => {
    const p = new Policy(tiers, { maxTier: 1 });
    expect(p.decide(first(0))).toMatchObject({ allow: true, tier: 0 });
    expect(p.decide(first(1))).toMatchObject({ allow: true, tier: 1 });
  });

  it("denies tools above the limit with R2", () => {
    const p = new Policy(tiers, { maxTier: 1 });
    expect(p.decide(first(2))).toMatchObject({ allow: false, ruleId: "R2-tier-above-limit", tier: 2 });
    expect(p.decide(first(3))).toMatchObject({ allow: false, ruleId: "R2-tier-above-limit", tier: 3 });
  });

  it("fails closed on unknown tools with R1", () => {
    const p = new Policy(tiers, { maxTier: 3 });
    expect(p.decide("totally_new_tool")).toMatchObject({ allow: false, ruleId: "R1-unknown-tool" });
  });

  it("always denies tier 3 with R4 while there is no sandbox, even at limit 3", () => {
    const p = new Policy(tiers, { maxTier: 3 });
    for (const t of tiers.tools.filter((x) => x.tier === 3))
      expect(p.decide(t.name)).toMatchObject({ allow: false, ruleId: "R4-sandbox-required" });
    for (const t of tiers.tools.filter((x) => x.tier < 3)) expect(p.decide(t.name).allow).toBe(true);
  });

  it("allows tier 3 only when a sandbox is declared available (tests only)", () => {
    const p = new Policy(tiers, { maxTier: 3, sandboxAvailable: true });
    expect(p.decide("gdb_console").allow).toBe(true);
  });

  it("never allows a code-executing tool below tier 3", () => {
    const p = new Policy(tiers, { maxTier: 2 });
    for (const name of ["gdb_console", "load_frida_script", "capture_process_scenario", "install_adb_package"])
      expect(p.decide(name).allow).toBe(false);
  });

  it("marks only the listed status tools as authorization exempt", () => {
    const p = new Policy(tiers, { maxTier: 2 });
    expect(p.decide("binary_session")).toMatchObject({ allow: true, authExempt: true });
    expect(p.decide("open_binary")).toMatchObject({ allow: true, authExempt: false });
    expect(tiers.tools.filter((t) => t.authExempt).map((t) => t.name).sort()).toEqual([
      "binary_session",
      "inspect_adb_client",
      "inspect_apktool_client",
      "inspect_jeb_client",
      "inspect_pcap_client",
      "list_architectures",
    ]);
  });
});

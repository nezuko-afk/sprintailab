import { coverage, type AuthorizationStore } from "./authorization.js";
import { extractTargets, type Target } from "./targets.js";
import type { Tier } from "./types.js";

export type GateResult =
  | { status: "allow"; targets: Target[]; authorizationIds: string[] }
  | { status: "needs-authorization"; targets: Target[]; uncovered: Target[]; noTarget: boolean };

export interface GateInput {
  tier: Tier;
  args: unknown;
  /** Status-only tools that name no target may run without an authorization. */
  exempt: boolean;
  cwd: string;
}

/**
 * Decides whether a call that already passed the tier policy is covered by a person's
 * authorization. Calls that name targets need each target covered. Calls that name none
 * need any active authorization of sufficient tier, unless they are read-only tier 0
 * or explicitly exempt status tools.
 */
export class Gate {
  constructor(private readonly store: AuthorizationStore) {}

  check({ tier, args, exempt, cwd }: GateInput): GateResult {
    const targets = extractTargets(args, cwd);
    if (targets.length === 0 && (tier === 0 || exempt)) return { status: "allow", targets, authorizationIds: [] };

    const active = this.store.active();
    if (targets.length === 0) {
      const usable = active.filter((a) => a.maxTier >= tier);
      return usable.length > 0
        ? { status: "allow", targets, authorizationIds: usable.map((a) => a.id) }
        : { status: "needs-authorization", targets, uncovered: [], noTarget: true };
    }

    const cov = coverage(active, tier, targets, cwd);
    return cov.covered
      ? { status: "allow", targets, authorizationIds: cov.authorizationIds }
      : { status: "needs-authorization", targets, uncovered: cov.uncovered, noTarget: false };
  }
}

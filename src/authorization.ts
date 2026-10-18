import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseScope, scopeCovers, scopeString, type Scope } from "./scope.js";
import type { Target } from "./targets.js";

export const STATEMENT_V1 =
  "I own this target or hold written permission to analyze it, and I will use the results lawfully.";

export type AuthTier = 0 | 1 | 2;

export interface Authorization {
  type: "grant";
  id: string;
  createdAt: string;
  expiresAt: string;
  declarant: string;
  method: "elicitation" | "cli";
  scopes: string[];
  maxTier: AuthTier;
  reference: string | null;
  statement: string;
  statementVersion: 1;
}

interface Revocation {
  type: "revoke";
  id: string;
  at: string;
  by: string;
}

export interface GrantInput {
  declarant: string;
  method: "elicitation" | "cli";
  scopes: string[];
  maxTier: AuthTier;
  reference?: string | null;
  ttlMs: number;
  cwd: string;
}

export const DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
export const MAX_TTL_MS = 24 * 60 * 60 * 1000;

export function parseTtl(text: string): number {
  const m = /^(\d+)(m|h)$/.exec(text.trim());
  if (!m) throw new Error(`Invalid duration "${text}". Use values like 30m, 4h.`);
  const ms = Number(m[1]) * (m[2] === "h" ? 3_600_000 : 60_000);
  if (ms <= 0) throw new Error("Duration must be positive");
  return ms;
}

/**
 * Time-limited, scoped declarations that a person owns or may analyze a target.
 * Stored as append-only JSONL (grant and revoke lines). Anyone who can write this file
 * can forge a grant, so keep it outside the agent's reach in real deployments.
 */
export class AuthorizationStore {
  constructor(
    readonly path: string,
    private readonly now: () => number = Date.now,
  ) {}

  grant(input: GrantInput): Authorization {
    if (input.scopes.length === 0) throw new Error("At least one scope is required");
    if (input.ttlMs > MAX_TTL_MS) throw new Error("Authorization may not last longer than 24 hours");
    const reference = input.reference?.trim() || null;
    if (input.maxTier >= 2 && !reference) throw new Error("Tier 2 authorization needs a reference id (ticket, contract or permission)");
    const scopes = input.scopes.map((s) => scopeString(parseScope(s, input.cwd)));
    const created = this.now();
    const record: Authorization = {
      type: "grant",
      id: randomUUID(),
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + input.ttlMs).toISOString(),
      declarant: input.declarant,
      method: input.method,
      scopes,
      maxTier: input.maxTier,
      reference,
      statement: STATEMENT_V1,
      statementVersion: 1,
    };
    this.append(record);
    return record;
  }

  revoke(id: string, by: string): boolean {
    if (!this.active().some((a) => a.id === id)) return false;
    this.append({ type: "revoke", id, at: new Date(this.now()).toISOString(), by } satisfies Revocation);
    return true;
  }

  /** All grants that have not been revoked, expired or not. */
  all(): { grants: Authorization[]; revoked: Set<string> } {
    const grants: Authorization[] = [];
    const revoked = new Set<string>();
    if (!existsSync(this.path)) return { grants, revoked };
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as Authorization | Revocation;
        if (rec.type === "grant") grants.push(rec);
        else if (rec.type === "revoke") revoked.add(rec.id);
      } catch {
        // Ignoring a bad line can only remove access, never add it.
      }
    }
    return { grants, revoked };
  }

  active(): Authorization[] {
    const { grants, revoked } = this.all();
    const now = this.now();
    return grants.filter((g) => !revoked.has(g.id) && Date.parse(g.expiresAt) > now);
  }

  private append(record: Authorization | Revocation): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    appendFileSync(this.path, JSON.stringify(record) + "\n", { mode: 0o600 });
  }
}

export interface Coverage {
  covered: boolean;
  authorizationIds: string[];
  uncovered: Target[];
}

/** Which active authorizations (at or above `tier`) cover these targets. */
export function coverage(active: Authorization[], tier: number, targets: Target[], cwd: string): Coverage {
  const usable = active.filter((a) => a.maxTier >= tier);
  const ids = new Set<string>();
  const uncovered: Target[] = [];
  for (const t of targets) {
    const hit = usable.filter((a) => a.scopes.some((s) => scopeCovers(parseScope(s, cwd) as Scope, t)));
    if (hit.length === 0) uncovered.push(t);
    for (const a of hit) ids.add(a.id);
  }
  return { covered: uncovered.length === 0, authorizationIds: [...ids], uncovered };
}

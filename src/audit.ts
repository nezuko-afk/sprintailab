import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { canonicalize, sha256 } from "./canonical.js";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditRecord {
  seq: number;
  ts: string;
  actor: string;
  event: string;
  [key: string]: unknown;
  prevHash: string;
  hash: string;
}

function hashRecord(prevHash: string, body: Record<string, unknown>): string {
  return sha256(prevHash + canonicalize(body));
}

/**
 * Append-only JSONL audit log. Each record carries the hash of the previous one, so
 * edits or deletions in the middle of the file are detectable with `verifyChain`.
 * Limit: someone with write access can rewrite the whole file. Anchoring the head
 * hash somewhere else is future work.
 */
export class AuditLog {
  private prevHash = GENESIS_HASH;
  private seq = 0;

  constructor(
    readonly path: string,
    private readonly actor: string,
  ) {
    mkdirSync(dirname(path), { recursive: true });
    if (existsSync(path)) {
      const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
      const last = lines.at(-1);
      if (last) {
        const rec = JSON.parse(last) as AuditRecord;
        this.prevHash = rec.hash;
        this.seq = rec.seq;
      }
    }
  }

  append(event: string, fields: Record<string, unknown> = {}): AuditRecord {
    const body = { seq: this.seq + 1, ts: new Date().toISOString(), actor: this.actor, event, ...fields };
    const hash = hashRecord(this.prevHash, body);
    const record = { ...body, prevHash: this.prevHash, hash } as AuditRecord;
    appendFileSync(this.path, canonicalize(record) + "\n", { mode: 0o600 });
    this.prevHash = hash;
    this.seq = record.seq;
    return record;
  }

  get headHash(): string {
    return this.prevHash;
  }
}

export interface ChainResult {
  ok: boolean;
  records: number;
  brokenAt?: number;
  reason?: string;
}

export function verifyChain(path: string): ChainResult {
  if (!existsSync(path)) return { ok: true, records: 0 };
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  let prev = GENESIS_HASH;
  let expectedSeq = 1;
  for (const [i, line] of lines.entries()) {
    let rec: AuditRecord;
    try {
      rec = JSON.parse(line) as AuditRecord;
    } catch {
      return { ok: false, records: i, brokenAt: i + 1, reason: "unparseable line" };
    }
    const { prevHash, hash, ...body } = rec;
    if (prevHash !== prev) return { ok: false, records: i, brokenAt: rec.seq, reason: "prevHash mismatch" };
    if (rec.seq !== expectedSeq) return { ok: false, records: i, brokenAt: rec.seq, reason: "sequence gap" };
    if (hashRecord(prev, body) !== hash) return { ok: false, records: i, brokenAt: rec.seq, reason: "hash mismatch" };
    prev = hash;
    expectedSeq++;
  }
  return { ok: true, records: lines.length };
}

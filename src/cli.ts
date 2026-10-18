import { parseArgs } from "node:util";
import { verifyChain } from "./audit.js";
import { AuthorizationStore, DEFAULT_TTL_MS, MAX_TTL_MS, parseTtl, STATEMENT_V1, type AuthTier } from "./authorization.js";
import { sprintailHome } from "./config.js";
import { parseScope, scopeString } from "./scope.js";
import { join } from "node:path";

export interface CliIO {
  out: (text: string) => void;
  err: (text: string) => void;
  /** Asks a question at the keyboard. Only meaningful when `interactive` is true. */
  ask: (question: string) => Promise<string>;
  /** True only when a person is at a real terminal. Authorizing refuses to run otherwise. */
  interactive: boolean;
  cwd: string;
  env: NodeJS.ProcessEnv;
  actor: string;
  now?: () => number;
}

const USAGE = `sprintailab - authorize and review what the governance proxy may analyze

Usage:
  sprintailab authorize --scope <scope> [--scope <scope> ...] [--tier 0|1|2] [--reference <id>] [--ttl 4h]
  sprintailab list [--all]
  sprintailab revoke <authorization-id>
  sprintailab verify-audit [--path <file>]

Scopes: a path (/work/clientA/app), a URL origin (https://app.example.com), or
  path:  origin:  host:*.example.com  adb:SERIAL  package:com.example.app  device:ID

Authorizing needs a person at an interactive terminal and a typed confirmation.
Tier 2 needs --reference (ticket, contract or written-permission id).
`;

export async function runCli(argv: string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  const home = sprintailHome(io.env);
  const store = new AuthorizationStore(io.env.SPRINTAIL_AUTH_PATH ?? join(home, "authorizations.jsonl"), io.now);

  try {
    switch (command) {
      case "authorize":
        return await authorize(rest, io, store);
      case "list":
        return list(rest, io, store);
      case "revoke":
        return revoke(rest, io, store);
      case "verify-audit":
        return verify(rest, io, join(home, "audit.jsonl"), io.env.SPRINTAIL_AUDIT_PATH);
      case undefined:
      case "help":
      case "--help":
        io.out(USAGE);
        return command === undefined ? 2 : 0;
      default:
        io.err(`Unknown command "${command}".\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    io.err(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

async function authorize(argv: string[], io: CliIO, store: AuthorizationStore): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      scope: { type: "string", multiple: true },
      tier: { type: "string", default: "1" },
      reference: { type: "string" },
      ttl: { type: "string", default: "4h" },
    },
    strict: true,
  });
  if (!io.interactive) {
    io.err("Authorizing needs a person at an interactive terminal. Run this yourself, not through an agent or script.");
    return 2;
  }
  const rawScopes = values.scope ?? [];
  if (rawScopes.length === 0) throw new Error("Give at least one --scope");
  const tier = Number(values.tier);
  if (![0, 1, 2].includes(tier)) throw new Error("--tier must be 0, 1 or 2 (tier 3 needs a sandbox and is not available)");
  const ttlMs = values.ttl ? parseTtl(values.ttl) : DEFAULT_TTL_MS;
  if (ttlMs > MAX_TTL_MS) throw new Error("--ttl may not exceed 24h");
  const scopes = rawScopes.map((s) => scopeString(parseScope(s, io.cwd)));
  const reference = values.reference?.trim() || null;
  if (tier >= 2 && !reference) throw new Error("Tier 2 needs --reference");

  io.out(`You are about to authorize REA analysis, up to tier ${tier}, for:\n${scopes.map((s) => `  - ${s}`).join("\n")}`);
  io.out(`Reference: ${reference ?? "(none)"}   Valid for: ${values.ttl}\n\n${STATEMENT_V1}\n`);
  const answer = (await io.ask("Type YES to confirm: ")).trim();
  if (answer !== "YES") {
    io.err("Not confirmed. Nothing was authorized.");
    return 1;
  }
  const grant = store.grant({ declarant: io.actor, method: "cli", scopes, maxTier: tier as AuthTier, reference, ttlMs, cwd: io.cwd });
  io.out(`Authorized. id ${grant.id}, expires ${grant.expiresAt}`);
  return 0;
}

function list(argv: string[], io: CliIO, store: AuthorizationStore): number {
  const { values } = parseArgs({ args: argv, options: { all: { type: "boolean" } }, strict: true });
  const { grants, revoked } = store.all();
  const active = new Set(store.active().map((a) => a.id));
  const rows = grants.filter((g) => values.all || active.has(g.id));
  if (rows.length === 0) {
    io.out(values.all ? "No authorizations recorded." : "No active authorizations.");
    return 0;
  }
  for (const g of rows) {
    const state = revoked.has(g.id) ? "revoked" : active.has(g.id) ? "active" : "expired";
    io.out(`${g.id}  ${state}  tier<=${g.maxTier}  until ${g.expiresAt}  by ${g.declarant} (${g.method})  ref ${g.reference ?? "-"}\n    ${g.scopes.join("\n    ")}`);
  }
  return 0;
}

function revoke(argv: string[], io: CliIO, store: AuthorizationStore): number {
  const id = argv[0];
  if (!id) throw new Error("Give the authorization id to revoke");
  if (!store.revoke(id, io.actor)) {
    io.err(`No active authorization with id ${id}`);
    return 1;
  }
  io.out(`Revoked ${id}`);
  return 0;
}

function verify(argv: string[], io: CliIO, defaultPath: string, envPath: string | undefined): number {
  const { values } = parseArgs({ args: argv, options: { path: { type: "string" } }, strict: true });
  const path = values.path ?? envPath ?? defaultPath;
  const result = verifyChain(path);
  if (result.ok) {
    io.out(`Audit log OK: ${result.records} records, chain intact (${path})`);
    return 0;
  }
  io.err(`Audit log BROKEN at record ${result.brokenAt}: ${result.reason} (${path})`);
  return 1;
}

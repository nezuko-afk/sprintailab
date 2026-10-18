import type { CallToolResult, Client } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { canonicalize, sha256 } from "./canonical.js";
import type { AuditLog } from "./audit.js";
import { type AuthTier, type Authorization, type AuthorizationStore } from "./authorization.js";
import { askForAuthorization } from "./elicit.js";
import type { Gate, GateResult } from "./gate.js";
import type { Policy } from "./policy.js";
import { targetKey, type Target } from "./targets.js";

export interface ProxyDeps {
  /** Connected MCP client for the upstream REA process. */
  upstream: Client;
  policy: Policy;
  gate: Gate;
  store: AuthorizationStore;
  audit: AuditLog;
  /** Identity recorded as the declarant of prompt-based authorizations. */
  actor: string;
  cwd?: string;
  /** Set false to force out-of-band (CLI) authorization only. */
  elicit?: boolean;
  version?: string;
}

type Tool = Awaited<ReturnType<Client["listTools"]>>["tools"][number];

const denied = (text: string): CallToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

function evidenceIdOf(result: CallToolResult): string | undefined {
  const sc = result.structuredContent;
  if (sc && typeof sc === "object" && "evidence_id" in sc) {
    const id = (sc as Record<string, unknown>).evidence_id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

async function listAllUpstreamTools(upstream: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await upstream.listTools(cursor ? { cursor } : undefined);
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  return tools;
}

const keys = (targets: Target[]) => targets.map(targetKey);

/**
 * Builds the MCP server the agent talks to. Only `tools/list` and `tools/call` are
 * proxied; REA prompts and resources are not forwarded.
 *
 * Call flow: tier policy (unknown, above limit, sandbox) -> authorization gate (is the
 * named target covered by a person's declaration?) -> prompt the person if not -> forward.
 */
export function createProxyServer(deps: ProxyDeps): Server {
  const { upstream, policy, gate, store, audit, actor, version = "0.2.0" } = deps;
  const cwd = deps.cwd ?? process.cwd();
  const allowPrompt = deps.elicit ?? true;
  const observed = new Set<string>();

  const server = new Server({ name: "sprintailab-governance-proxy", version }, { capabilities: { tools: {} } });

  /** Puts the full authorization record into the audit chain the first time it is relied on. */
  const observe = (ids: string[]) => {
    const fresh = ids.filter((id) => !observed.has(id));
    if (fresh.length === 0) return;
    const active = new Map(store.active().map((a) => [a.id, a]));
    for (const id of fresh) {
      observed.add(id);
      const a: Authorization | undefined = active.get(id);
      if (a)
        audit.append("authorization_observed", {
          authorizationId: a.id,
          declarant: a.declarant,
          method: a.method,
          scopes: a.scopes,
          maxTier: a.maxTier,
          reference: a.reference,
          createdAt: a.createdAt,
          expiresAt: a.expiresAt,
          statementVersion: a.statementVersion,
        });
    }
  };

  server.setRequestHandler("tools/list", async () => {
    const all = await listAllUpstreamTools(upstream);
    const visible: Tool[] = [];
    let hiddenUnknown = 0;
    let hiddenAboveTier = 0;
    let hiddenSandbox = 0;
    for (const tool of all) {
      const d = policy.decide(tool.name);
      if (d.allow) visible.push(tool);
      else if (d.ruleId === "R1-unknown-tool") hiddenUnknown++;
      else if (d.ruleId === "R4-sandbox-required") hiddenSandbox++;
      else hiddenAboveTier++;
    }
    audit.append("tool_list", {
      upstreamCount: all.length,
      listed: visible.length,
      hiddenUnknown,
      hiddenAboveTier,
      hiddenSandbox,
      maxTier: policy.maxTier,
    });
    return { tools: visible };
  });

  server.setRequestHandler("tools/call", async (request) => {
    const { name } = request.params;
    const args = request.params.arguments ?? {};
    const argsSha256 = sha256(canonicalize(args));

    const decision = policy.decide(name);
    if (!decision.allow) {
      audit.append("tool_call", {
        tool: name,
        tier: decision.tier ?? null,
        decision: "deny",
        ruleId: decision.ruleId,
        argsSha256,
      });
      return denied(`Denied by sprintailab policy ${decision.ruleId}: ${decision.reason}`);
    }

    const tier = decision.tier as AuthTier;
    const gateInput = { tier: decision.tier, args, exempt: decision.authExempt, cwd };
    let checked: GateResult = gate.check(gateInput);

    if (checked.status === "needs-authorization") {
      const need = checked;
      const targets = keys(need.uncovered);
      const denyAudit = (ruleId: string) =>
        audit.append("tool_call", { tool: name, tier, decision: "deny", ruleId, targets, argsSha256 });

      const outcome = allowPrompt
        ? await askForAuthorization(server, { tool: name, tier, uncovered: need.uncovered, noTarget: need.noTarget })
        : ({ kind: "unavailable", reason: "Prompting is turned off." } as const);

      if (outcome.kind === "granted") {
        try {
          const scopes = need.noTarget ? [outcome.scope as string] : targets;
          const grant = store.grant({
            declarant: actor,
            method: "elicitation",
            scopes,
            maxTier: tier,
            reference: outcome.reference,
            ttlMs: outcome.ttlMs,
            cwd,
          });
          audit.append("authorization_granted", {
            authorizationId: grant.id,
            method: grant.method,
            scopes: grant.scopes,
            maxTier: grant.maxTier,
            reference: grant.reference,
            expiresAt: grant.expiresAt,
          });
          observed.add(grant.id);
          checked = gate.check(gateInput);
        } catch (error) {
          denyAudit("R5-authorization-declined");
          return denied(`Denied by sprintailab policy R5-authorization-declined: ${error instanceof Error ? error.message : String(error)}`);
        }
      } else if (outcome.kind === "declined") {
        audit.append("authorization_declined", { tool: name, tier, targets, reason: outcome.reason });
        denyAudit("R5-authorization-declined");
        return denied(`Denied by sprintailab policy R5-authorization-declined: ${outcome.reason}`);
      } else {
        denyAudit("R3-authorization-required");
        const why = need.noTarget
          ? "No target is named in this call and no authorization is active. Name the target (a path, URL or device id) so the person can be asked to authorize it."
          : `Not authorized: ${targets.join(", ")}.`;
        const how = need.noTarget ? "" : ` A person can authorize it from a terminal: sprintailab authorize ${targets.map((t) => `--scope "${t}"`).join(" ")} --tier ${tier}${tier >= 2 ? " --reference <id>" : ""}. The agent cannot do this itself.`;
        return denied(`Denied by sprintailab policy R3-authorization-required: ${why}${how}`);
      }
    }

    if (checked.status !== "allow") {
      audit.append("tool_call", { tool: name, tier, decision: "deny", ruleId: "R3-authorization-required", argsSha256 });
      return denied("Denied by sprintailab policy R3-authorization-required: authorization could not be confirmed.");
    }

    observe(checked.authorizationIds);
    audit.append("tool_call", {
      tool: name,
      tier,
      decision: "allow",
      ruleId: decision.ruleId,
      targets: keys(checked.targets),
      authorizationIds: checked.authorizationIds,
      argsSha256,
    });

    const started = Date.now();
    try {
      const result = await upstream.callTool({ name, arguments: args });
      audit.append("tool_result", {
        tool: name,
        argsSha256,
        outcome: result.isError ? "tool_error" : "ok",
        evidenceId: evidenceIdOf(result) ?? null,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (error) {
      audit.append("tool_result", {
        tool: name,
        argsSha256,
        outcome: "proxy_error",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - started,
      });
      return denied(`Upstream REA call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return server;
}

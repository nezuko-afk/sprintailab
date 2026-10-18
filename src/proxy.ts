import type { CallToolResult, Client } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { canonicalize, sha256 } from "./canonical.js";
import type { AuditLog } from "./audit.js";
import type { Policy } from "./policy.js";

export interface ProxyDeps {
  /** Connected MCP client for the upstream REA process. */
  upstream: Client;
  policy: Policy;
  audit: AuditLog;
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

/**
 * Builds the MCP server the agent talks to. Only `tools/list` and `tools/call` are
 * proxied in this phase; REA prompts and resources are not forwarded.
 */
export function createProxyServer({ upstream, policy, audit, version = "0.1.0" }: ProxyDeps): Server {
  const server = new Server(
    { name: "sprintailab-governance-proxy", version },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler("tools/list", async () => {
    const all = await listAllUpstreamTools(upstream);
    const visible: Tool[] = [];
    let hiddenUnknown = 0;
    let hiddenAboveTier = 0;
    for (const tool of all) {
      const decision = policy.decide(tool.name);
      if (decision.allow) visible.push(tool);
      else if (decision.ruleId === "R1-unknown-tool") hiddenUnknown++;
      else hiddenAboveTier++;
    }
    audit.append("tool_list", {
      upstreamCount: all.length,
      listed: visible.length,
      hiddenUnknown,
      hiddenAboveTier,
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

    audit.append("tool_call", {
      tool: name,
      tier: decision.tier,
      decision: "allow",
      ruleId: decision.ruleId,
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

import type { Server } from "@modelcontextprotocol/server";
import { STATEMENT_V1 } from "./authorization.js";
import { targetKey, type Target } from "./targets.js";

const TIER_NAMES = ["read-only", "local analysis", "live system"] as const;
export const DURATIONS = { "1h": 3_600_000, "4h": 14_400_000, "8h": 28_800_000 } as const;
type Duration = keyof typeof DURATIONS;

export interface AskRequest {
  tool: string;
  tier: 0 | 1 | 2;
  uncovered: Target[];
  noTarget: boolean;
}

export type AskOutcome =
  | { kind: "granted"; reference: string | null; ttlMs: number; scope: string | null }
  | { kind: "declined"; reason: string }
  | { kind: "unavailable"; reason: string };

/** True when the connected client can show us a form to the person using it. */
export function clientCanElicit(server: Server): boolean {
  const e = server.getClientCapabilities()?.elicitation;
  if (!e) return false;
  return e.form !== undefined || Object.keys(e).length === 0;
}

/**
 * Asks the person (through the client's UI, not the agent) to declare authorization.
 * The agent never sees the answer form, so it cannot fill it in itself.
 */
export async function askForAuthorization(server: Server, req: AskRequest): Promise<AskOutcome> {
  if (!clientCanElicit(server)) return { kind: "unavailable", reason: "The client cannot show a prompt." };

  const needsReference = req.tier >= 2;
  const targetLines = req.noTarget ? "(no target named in this call)" : req.uncovered.map((t) => `  - ${targetKey(t)}`).join("\n");
  const message =
    `REA tool "${req.tool}" (tier ${req.tier}, ${TIER_NAMES[req.tier]}) needs your authorization for:\n${targetLines}\n\n` +
    `Only continue if: ${STATEMENT_V1}`;

  const properties: Record<string, unknown> = {
    confirm: { type: "boolean", title: "I confirm the statement above", default: false },
    reference: {
      type: "string",
      title: needsReference ? "Reference (required)" : "Reference (optional)",
      description: "Ticket, contract or written-permission id",
    },
    duration: { type: "string", title: "Valid for", enum: Object.keys(DURATIONS), default: "4h" },
  };
  const required = ["confirm"];
  if (needsReference) required.push("reference");
  if (req.noTarget) {
    properties.scope = {
      type: "string",
      title: "What are you authorized to analyze?",
      description: "A scope such as /path/to/project, https://app.example.com or adb:SERIAL",
    };
    required.push("scope");
  }

  let result;
  try {
    result = await server.elicitInput({
      mode: "form",
      message,
      requestedSchema: { type: "object", properties, required },
    } as Parameters<Server["elicitInput"]>[0]);
  } catch (error) {
    return { kind: "unavailable", reason: `Prompt failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (result.action !== "accept") return { kind: "declined", reason: `The person chose "${result.action}".` };
  const content = (result.content ?? {}) as Record<string, unknown>;
  if (content.confirm !== true) return { kind: "declined", reason: "The statement was not confirmed." };
  const reference = typeof content.reference === "string" && content.reference.trim() ? content.reference.trim() : null;
  if (needsReference && !reference) return { kind: "declined", reason: "A reference is required for tier 2." };
  const scope = typeof content.scope === "string" && content.scope.trim() ? content.scope.trim() : null;
  if (req.noTarget && !scope) return { kind: "declined", reason: "No scope was given." };
  const duration = (typeof content.duration === "string" && content.duration in DURATIONS ? content.duration : "4h") as Duration;
  return { kind: "granted", reference, ttlMs: DURATIONS[duration], scope };
}

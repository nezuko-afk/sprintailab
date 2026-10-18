#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { AuditLog } from "./audit.js";
import { AuthorizationStore } from "./authorization.js";
import { loadConfig } from "./config.js";
import { Gate } from "./gate.js";
import { loadTiers, Policy } from "./policy.js";
import { createProxyServer } from "./proxy.js";

// stdout carries the MCP protocol. Everything human-readable goes to stderr.
const log = (message: string) => process.stderr.write(`[sprintailab] ${message}\n`);

async function main(): Promise<void> {
  const tiersUrl = new URL("../policy/tool-tiers.json", import.meta.url);
  const tiers = loadTiers(tiersUrl);
  const config = loadConfig(process.env, tiers.generatedFrom.version);
  const policy = new Policy(tiers, { maxTier: config.maxTier });
  const store = new AuthorizationStore(config.authPath);
  const gate = new Gate(store);
  const audit = new AuditLog(config.auditPath, config.actor);

  const upstreamTransport = new StdioClientTransport({
    command: config.reaCommand,
    args: config.reaArgs,
    stderr: "inherit",
  });
  const upstream = new Client({ name: "sprintailab-proxy", version: "0.1.0" });
  try {
    await upstream.connect(upstreamTransport);
  } catch (error) {
    log(`Could not start REA with: ${[config.reaCommand, ...config.reaArgs].join(" ")}`);
    log("Check that this version exists, or set SPRINTAIL_REA_COMMAND and SPRINTAIL_REA_ARGS (see README).");
    throw error;
  }

  // The tiers file was generated for one specific REA version. Tools added or removed
  // in another version are handled safely (unknown tools are denied), but tell the operator.
  const reported = upstream.getServerVersion()?.version;
  const versionMismatch = reported !== undefined && reported !== tiers.generatedFrom.version;
  if (versionMismatch)
    log(`WARNING: REA reports ${reported} but tiers were generated for ${tiers.generatedFrom.version}. Regenerate tiers and review.`);

  audit.append("startup", {
    versionMismatch,
    maxTier: config.maxTier,
    authPath: config.authPath,
    elicitation: config.elicit,
    reaCommand: [config.reaCommand, ...config.reaArgs],
    tiersVersion: tiers.generatedFrom.version,
    tiersCommit: tiers.generatedFrom.commit,
    upstreamServer: upstream.getServerVersion() ?? null,
  });
  log(`REA connected. Tier limit ${config.maxTier}. Audit: ${config.auditPath}. Authorizations: ${config.authPath}`);

  const server = createProxyServer({ upstream, policy, gate, store, audit, actor: config.actor, elicit: config.elicit });
  await server.connect(new StdioServerTransport());

  const shutdown = async () => {
    audit.append("shutdown");
    await Promise.allSettled([server.close(), upstream.close()]);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});

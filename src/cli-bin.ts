#!/usr/bin/env node
import { userInfo } from "node:os";
import { createInterface } from "node:readline/promises";
import { runCli } from "./cli.js";

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

const code = await runCli(process.argv.slice(2), {
  out: (t) => console.log(t),
  err: (t) => console.error(t),
  ask: async (q) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(q);
    } finally {
      rl.close();
    }
  },
  interactive,
  cwd: process.cwd(),
  env: process.env,
  actor: process.env.SPRINTAIL_ACTOR ?? userInfo().username,
});
process.exit(code);

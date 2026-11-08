#!/usr/bin/env node
// An agent's command on the login PATH where the real one can't or mustn't run (README, The agents):
//
//   node stub.mjs <version> <record> <real or -> [args...]
//
// `--version` prints <version> alone. `app-server daemon ...` (Codex's own daemon commands) runs nothing: it appends its
// arguments to <record> as one JSON line and exits 0, so a test can read whether, when and how a restart ran. Anything
// else runs <real> with the same arguments when one is given, and otherwise exits 0 having done nothing.
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const [, , VERSION, RECORD, REAL, ...args] = process.argv;
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}
if (args[0] === 'app-server' && args[1] === 'daemon') {
  appendFileSync(RECORD, `${JSON.stringify({ args, at: Date.now(), ppid: process.ppid })}\n`);
  process.exit(0);
}
if (REAL && REAL !== '-') {
  const r = spawnSync(REAL, args, { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
process.exit(0);

#!/usr/bin/env node
// A stand-in for Claude Code, installed by the tests as `claude` on the test home's login PATH (helpers.ts). It is
// the boundary this suite doesn't own: the agent and its model. A start reads only two things of it: the version
// `--version` names (one the shipped facts list, so the hub starts it) and that it runs. So it:
//
// - answers `--version` (or `-v`) with __VERSION__, as Claude Code prints it;
// - otherwise writes its PID to __LOGDIR__/<pid> (so the tests can stop it by PID), then idles until SIGTERM or
//   SIGHUP, and ends by itself after 90 s. It writes no hook, no transcript and nothing of Claude Code's config:
//   whatever ~/.claude.json holds after a start, the hub wrote.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = '__VERSION__';
const LOGDIR = '__LOGDIR__';
const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write(`${VERSION} (Claude Code)\n`);
  process.exit(0);
}
mkdirSync(LOGDIR, { recursive: true });
writeFileSync(join(LOGDIR, String(process.pid)), `${JSON.stringify({ pid: process.pid, cwd: process.cwd(), argv })}\n`);
const end = () => process.exit(0);
process.on('SIGTERM', end);
process.on('SIGHUP', end);
setTimeout(end, 90_000);

#!/usr/bin/env node
// #3539's harness: what a place in the slow lane waits, read from one script under one order.
//
//   node docs/spikes/3539/harness.mjs --script <file> --order <today|person-first|hub> --out <file> [--plant <name>]
//
// Run from the repository root. <file> is a script: the scheduler's `Scenario` as JSON, each check's `run` replaced by
// `took_ms` (scripts.mjs makes this spike's; tests/acceptance/3539/README.md, "A script", is the format). It writes
// one JSON object to --out and exits 0:
//
//   { "script_sha256", "order", "places": [{ session, check, snapshot, queued_at, started_at, ended_at }],
//     "stops": [{ session, stop, snapshot, at, verdict_at }] }
//
// Times are ms on the script's virtual clock. A place is a session's slow check on one snapshot; `queued_at` is when
// it took its place, at its green stop's reply, and `started_at` its run's start, null when none started. A stop's
// `verdict_at` is when the last run its claim rests on ended, null when its claim still read pending at the end.
//
//   --order today         the gate package's `simulate` as main has it (package.mjs).
//   --order person-first  the same on a copy of the scheduler with person-first.patch applied in memory: places whose
//                         turn a person opened first, and then as today.
//   --order hub           the hub's own gate runner on the same script (hub.mjs): its queue and `pump`, on a host
//                         that follows core.ts and runs.ts. Each place also has `handed_at`, when the pump gave it to
//                         the host, and each stop `turn_end_returned_at`, when `turnEnded` returned.
//   --plant times-from-start  The planted twin (#3539 AC3): a slow check timed from its start, so it reads no wait.
//   --plant reports-a-gain    The planted twin (#3539 AC2): under person-first it takes the first session that stops
//                             for the person's, whoever opened its turns.
//
// Needs the two files the packages' sources read from a build, packages/evidence/dist/patterns.json and
// packages/record/dist/versions.json (README, How to run). It starts no process and writes nothing but --out.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kept, REPO } from './load.mjs';
import { ORDERS, PLANTS, runPackage } from './package.mjs';

const USAGE = 'Usage: node docs/spikes/3539/harness.mjs --script <file> --order <today|person-first|hub> --out <file> [--plant <times-from-start|reports-a-gain>]';
const fail = (message, code = 1) => { console.error(message); process.exit(code); };

const args = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = /^--(script|order|out|plant)$/.exec(process.argv[i])?.[1];
  if (!name || name in args || process.argv[i + 1] === undefined) fail(USAGE, 2);
  args[name] = process.argv[i + 1];
}
if (!args.script || !args.out || ![...ORDERS, 'hub'].includes(args.order)) fail(USAGE, 2);
if (args.plant !== undefined && (!PLANTS.includes(args.plant) || args.order === 'hub')) fail(USAGE, 2);

const built = ['packages/evidence/dist/patterns.json', 'packages/record/dist/versions.json'].filter((file) => !existsSync(join(REPO, file)));
if (built.length) fail(`BLOCKED: ${built.join(' and ')} ${built.length === 1 ? "isn't" : "aren't"} in this checkout: the packages' sources read them from a build. \`npm run build --workspaces\` makes them, and so do the two commands in docs/spikes/3539/README.md, How to run.`);

const bytes = readFileSync(args.script);
const script = JSON.parse(bytes.toString('utf8'));
const rows = args.order === 'hub' ? await (await import('./hub.mjs')).runHub(script) : await runPackage(script, args.order, args.plant);
writeFileSync(args.out, `${kept({ script_sha256: createHash('sha256').update(bytes).digest('hex'), order: args.order, ...rows })}\n`);

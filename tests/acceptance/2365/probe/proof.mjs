// The issue's Proof runs, printed as a table, for the merge base first and then the change (run it in each checkout,
// after npm run build --workspaces): the probe's three passes, one transcript archived at 80 MB and passed again at
// 90 MB and 100 MB, then a 540 MB transcript never archived; each pass in a process of its own (pass.mjs) with its
// time, its longest stretch with the 5 ms timer unserved, its peak resident memory and the evidence bytes it added.
// It judges nothing: the criteria are judged by the tests (README). Everything is under one temp folder, removed at
// the end.
//
//   node tests/acceptance/2365/probe/proof.mjs [--archive <module.js>]
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { append, write } from './fixture.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const extra = process.argv.includes('--archive') ? ['--archive', process.argv[process.argv.indexOf('--archive') + 1]] : [];
const MB = 1_000_000;
const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const dir = realpathSync(mkdtempSync('/tmp/dh2365-proof-'));
const at = (home, id) => join(home, '.claude', 'projects', '-tmp-dh2365-work-long-session', `${id}.jsonl`);
const pass = (home, now) => {
  const r = spawnSync(process.execPath, ['--expose-gc', join(here, 'pass.mjs'), home, 'pass', String(now), ...extra], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const line = r.stdout.trim().split('\n').reverse().find((l) => l.includes('"at":"result"'));
  if (!line) throw Error(`the pass didn't report: ${r.stderr}`);
  return JSON.parse(line);
};
const row = (what, r) => console.log([what, `${(r.ms / 1000).toFixed(2)} s`, `${r.maxGapMs.toFixed(0)} ms`, `${(r.peakRss / MB).toFixed(0)} MB (from ${(r.rssStart / MB).toFixed(0)} MB)`, `${(r.added / MB).toFixed(2)} MB`, r.error ?? 'ok'].join(' | '));
try {
  console.log('pass | time | longest unserved stretch | peak resident memory | evidence added | outcome');
  const a = join(dir, 'probe');
  const id = '2365a003-0000-4000-a000-000000000080';
  mkdirSync(join(a, '.claude', 'projects', '-tmp-dh2365-work-long-session'), { recursive: true });
  write(at(a, id), 80 * MB);
  row('80 MB, first copy', pass(a, T0));
  append(at(a, id), 10 * MB);
  row('90 MB', pass(a, T0 + 3_600_000));
  append(at(a, id), 10 * MB);
  row('100 MB', pass(a, T0 + 7_200_000));
  rmSync(a, { recursive: true, force: true });
  const b = join(dir, 'never');
  const big = '2365a004-0000-4000-a000-000000000540';
  mkdirSync(join(b, '.claude', 'projects', '-tmp-dh2365-work-long-session'), { recursive: true });
  write(at(b, big), 540 * MB);
  row('540 MB, never archived', pass(b, T0));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

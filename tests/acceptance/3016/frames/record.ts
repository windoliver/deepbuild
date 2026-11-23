// #3016 criterion 5's recorder: a vitest setup file that leaves the suite it runs beside unchanged and writes down every
// frame hash it draws. Each `spawnSync` the suite makes still runs as the suite asked; when a child's output holds
// `pixel_hash` values (a `deep-gpu run` reply, or any other binary's), they are appended, in the order the child gave
// them, to the JSON-lines file `ACCEPTANCE_3016_FRAMES` names, keyed by the test file, the test's full name and the
// child's place among that test's children. Nothing is written without that variable.
import cp from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { expect } from 'vitest';

const LOG = process.env['ACCEPTANCE_3016_FRAMES'];

/** Every `pixel_hash` string in `v`, depth first, in document order. */
function hashes(v: unknown, out: string[]): string[] {
  if (Array.isArray(v)) for (const x of v) hashes(x, out);
  else if (v !== null && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'pixel_hash' && typeof x === 'string') out.push(x);
      else hashes(x, out);
    }
  }
  return out;
}

if (LOG) {
  const real = cp.spawnSync;
  const children = new Map<string, number>();
  const wrapped = function (this: unknown, ...args: unknown[]) {
    const r = (real as (...a: unknown[]) => cp.SpawnSyncReturns<string | Buffer>).apply(cp, args);
    const stdout = typeof r?.stdout === 'string' ? r.stdout : Buffer.isBuffer(r?.stdout) ? r.stdout.toString('utf8') : '';
    if (!stdout.includes('pixel_hash')) return r;
    const state = expect.getState();
    const test = `${basename(state.testPath ?? '?')} > ${state.currentTestName ?? '?'}`;
    const n = children.get(test) ?? 0;
    children.set(test, n + 1);
    const found: string[] = [];
    for (const line of stdout.split('\n')) {
      if (!line.includes('pixel_hash')) continue;
      try { hashes(JSON.parse(line), found); } catch { /* a line that isn't JSON holds no reply */ }
    }
    const argv = Array.isArray(args[1]) ? (args[1] as unknown[]).map(String) : [];
    appendFileSync(LOG, `${JSON.stringify({ test, child: n, command: basename(String(args[0])), args: argv, hashes: found })}\n`);
    return r;
  };
  (cp as unknown as { spawnSync: unknown }).spawnSync = wrapped;
  syncBuiltinESMExports();
}

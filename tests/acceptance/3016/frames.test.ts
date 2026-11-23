// #3016.548510a3 (criterion 5): "On Metal, every frame of `tests/acceptance/465/`, `tests/acceptance/506/`,
// `tests/acceptance/462/` and `tests/acceptance/166/` hashes the same as on the merge base. …"
//
// Each of the four suites runs as its README runs it (`npx vitest run --root tests/acceptance/<n> --no-file-parallelism`),
// with frames/record.ts as a setup file beside it: the suite's own files, helpers and binaries, unchanged, while every
// `pixel_hash` a child process of the suite prints is written down in order, keyed by the test file, the test's full
// name and the child's place among that test's children. Every frame the merge base drew is in
// fixtures/base-frames/<n>.jsonl (frames/record-base.sh, on the merge base, on the machine fixtures/base-frames/
// machine.json names). Each frame must hash as it did there; a frame the base drew that this run didn't draw, or one this
// run drew that the base didn't, fails too, so a suite that stops early never passes. Whether the suites' own tests
// pass is theirs to say, not this test's. The hashes are the same machine's (Determinism::SameMachine), so on another
// model this is INCONCLUSIVE; off macOS, BLOCKED.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const AC5 = 'AC5 #3016.548510a3';
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const BASE = join(HERE, 'fixtures', 'base-frames');
const SUITES = ['465', '506', '462', '166'] as const;

interface Row { test: string; child: number; command: string; args: string[]; hashes: string[] }
// A suite's own planted programs (a child run with --planted) are left out: they are wrong programs, not the renderer,
// and one, 166's water_foam_keeps_state, draws other frames from run to run on the merge base itself (BASE-FAILURE.txt).
const read = (file: string): Row[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map((l) => JSON.parse(l) as Row) : []).filter((r) => !r.args.includes('--planted'));
const keyOf = (r: Row): string => `${r.test} #${r.child} (${r.command} ${r.args.join(' ')})`;

/** Each frame's hash by `<test> #<child> (<command>) frame <k>`. */
function frames(rows: Row[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const r of rows) r.hashes.forEach((h, k) => out.set(`${keyOf(r)} frame ${k}`, h));
  return out;
}

describe(`${AC5} every frame of the four suites hashes as on the merge base`, () => {
  for (const suite of SUITES) {
    it(`${AC5} tests/acceptance/${suite}/`, () => {
      if (process.platform !== 'darwin') throw Error(`${AC5}: BLOCKED: the frames are Metal's, and this isn't macOS`);
      const machine = JSON.parse(readFileSync(join(BASE, 'machine.json'), 'utf8')) as { model: string };
      const model = spawnSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).stdout.trim();
      if (model !== machine.model) throw Error(`${AC5}: INCONCLUSIVE: the merge base's frames were drawn on a ${machine.model}, this is a ${model}`);
      const base = frames(read(join(BASE, `${suite}.jsonl`)));
      expect(base.size, `the merge base's record of tests/acceptance/${suite}/ holds its frames`).toBeGreaterThan(0);
      const dir = mkdtempSync(join(tmpdir(), 'deep-3016-frames-'));
      try {
        const log = join(dir, `${suite}.jsonl`);
        const r = spawnSync('npx', ['vitest', 'run', '--root', `tests/acceptance/${suite}`, '--config', join(HERE, 'frames', 'record.config.ts'), '--no-file-parallelism'],
          { cwd: REPO, env: { ...process.env, ACCEPTANCE_3016_FRAMES: log }, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 4 * 3_600_000 });
        const now = frames(read(log));
        const failures: string[] = [];
        for (const [k, h] of base) {
          const got = now.get(k);
          if (got === undefined) failures.push(`${k}: drawn on the merge base, not in this run`);
          else if (got !== h) failures.push(`${k}: hashes ${got}, on the merge base ${h}`);
        }
        for (const k of now.keys()) if (!base.has(k)) failures.push(`${k}: drawn in this run, not on the merge base`);
        console.log(`${AC5}: tests/acceptance/${suite}/: ${now.size} frames against the merge base's ${base.size}; the suite's own vitest exited ${r.status}`);
        expect(failures, `${AC5}: tests/acceptance/${suite}/: ${failures.length} frames differ:\n  ${failures.slice(0, 40).join('\n  ')}`).toEqual([]);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 4 * 3_600_000);
  }
});

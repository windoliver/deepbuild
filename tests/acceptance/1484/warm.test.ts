// AC5 #1484.6f97433d: "Warm shaping stays within 5% of the merge base"
//
// Warm shaping is #856's: a label already shaped once, shaped again through the shaped-run cache, timed from outside the
// program as µs a glyph on a release build (README: Readings). Here the label is 300 glyphs at 20 u and weight 450, a
// size between the opsz ends and a weight with no static face, so its key carries coordinates once the change gives it
// them. Each side is `deep-text shape` built for release: the change (this checkout) and the merge base (`git merge-base
// HEAD origin/main`, its Rust sources taken with `git archive` into a temporary folder and built there; no other
// worktree is touched). A side's reading is the wall time of a process shaping the label 1 + 100,000 times less that of
// one shaping it once, over the 100,000 × 300 warm glyphs; every warm line must answer `shaped: []`, or it wasn't warm.
// One warm-up round, then five rounds, each taking both sides in turn, the order swapped each round. Judged by the
// design's rule on the five ratios change ÷ merge base against 1.05: PASS when all five are within, FAIL when all five
// are over by more than the margin (the larger of 5% and their spread), else INCONCLUSIVE; and a round whose one-minute
// load average, read at its start or end, is above the core count counts neither way, so the run is INCONCLUSIVE.
// The wrong program: #856's `deep-text shape --planted no_cache`, a shaper that shapes every line again, on the change's
// side; the same judge must FAIL it. At the base the change is the merge base, so the comparison is the base with
// itself.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { availableParallelism, loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AC, CARGO_ENV, REPO, arr, built, cargoBuild, inconclusive, num, obj, type JsonValue } from './helpers.ts';

const ID = AC[5];
/** Within 5% of the merge base: the change's reading at most 1.05 times the merge base's. */
const LIMIT = 1.05;
/** Warm lines a process: enough that their work (about a second) outweighs a process's start-up jitter. */
const WARM = 100_000;
const GLYPHS = 300;
/** What a Rust build of deep-text reads, taken from the merge base. */
const SOURCES = ['Cargo.toml', 'Cargo.lock', '.cargo', 'rust-toolchain.toml', 'crates', 'vendor', 'packages/contracts'];

// #856's texts: lowercase words and single spaces, one glyph a character in the body face.
const WORDS = ['amber', 'bright', 'cobalt', 'delta', 'ember', 'grove', 'harbor', 'juniper', 'kettle', 'lantern', 'meadow', 'north',
  'orchard', 'pebble', 'quartz', 'river', 'summit', 'timber', 'umber', 'velvet', 'willow', 'yonder', 'zephyr'];
function prose(length: number, stride: number, offset: number): string {
  let out = '';
  for (let i = 0; out.length < length; i++) out += (out ? ' ' : '') + WORDS[(i * stride + offset) % WORDS.length]!;
  out = out.slice(0, length);
  return out.endsWith(' ') ? `${out.slice(0, -1)}s` : out;
}
const LABEL = { text: prose(GLYPHS, 7, 0), font: 'body', size: 20, weight: 450 };

let dir = '';
let error = '';
let change = '';
let base = '';
let mergeBase = '';
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'deep-1484-warm-'));
  error = cargoBuild(REPO, 'deep-text', true);
  if (error) return;
  change = join(dir, 'deep-text-change');
  copyFileSync(built(REPO, 'deep-text', true), change);
  const mb = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  if (mb.status !== 0) { error = `BLOCKED: git merge-base HEAD origin/main: ${mb.stderr}`; return; }
  mergeBase = mb.stdout.trim();
  const src = join(dir, 'merge-base');
  mkdirSync(src);
  const tar = join(dir, 'merge-base.tar');
  const archived = spawnSync('git', ['archive', '--format=tar', '-o', tar, mergeBase, ...SOURCES], { cwd: REPO, encoding: 'utf8' });
  if (archived.status !== 0) { error = `BLOCKED: git archive ${mergeBase}: ${archived.stderr}`; return; }
  const unpacked = spawnSync('tar', ['-xf', tar, '-C', src], { encoding: 'utf8' });
  if (unpacked.status !== 0) { error = `BLOCKED: tar -xf: ${unpacked.stderr}`; return; }
  const env: NodeJS.ProcessEnv = { ...CARGO_ENV };
  delete env['CARGO_TARGET_DIR'];
  error = cargoBuild(src, 'deep-text', true, env);
  if (error) return;
  base = join(dir, 'deep-text-merge-base');
  copyFileSync(built(src, 'deep-text', true, env), base);
  rmSync(src, { recursive: true, force: true });
}, 7_200_000);
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

/** The wall ms of one `deep-text shape` process over `lines` copies of the label, its answers checked. */
function timed(bin: string, side: string, lines: number, planted?: string): number {
  const args = ['shape', ...(planted ? ['--planted', planted] : [])];
  const input = `${Array.from({ length: lines }, () => JSON.stringify(LABEL)).join('\n')}\n`;
  const began = performance.now();
  const r = spawnSync(bin, args, { cwd: REPO, input, encoding: 'utf8', maxBuffer: 1024 * 1024 * 1024, timeout: 900_000, killSignal: 'SIGKILL' });
  const ms = performance.now() - began;
  const what = `${side}: deep-text ${args.join(' ')} over ${lines} lines`;
  expect(r.error?.message ?? '', `${what} ran`).toBe('');
  expect(r.status, `${what} exits 0; stderr: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  const out = (r.stdout ?? '').split('\n').filter((l) => l !== '');
  expect(out.length, `${what}: one answer a line`).toBe(lines);
  const first = obj(JSON.parse(out[0]!) as JsonValue, `${what}: answer 1`);
  expect(first['ok'], `${what}: answer 1 is ok: ${out[0]!.slice(0, 300)}`).toBe(true);
  expect(num(first['glyphs'], `${what}: answer 1's glyphs`), `${what}: the label shapes to ${GLYPHS} glyphs`).toBe(GLYPHS);
  arr(first['shaped'], `${what}: answer 1's shaped`);
  // Every later answer is the first's, and unplanted, shapes nothing: the label was shaped already, so it's warm.
  const bad = out.slice(1).map((l, i) => ({ l, i: i + 2 })).filter(({ l }) => {
    const a = JSON.parse(l) as { ok?: unknown; glyphs?: unknown; shaped?: unknown };
    return a.ok !== true || a.glyphs !== GLYPHS || (!planted && !(Array.isArray(a.shaped) && a.shaped.length === 0));
  });
  expect(bad.slice(0, 3).map(({ l, i }) => `line ${i}: ${l.slice(0, 200)}`), `${what}: ${bad.length} later lines aren't ok with ${GLYPHS} glyphs${planted ? '' : ' and nothing shaped (not warm)'}`).toEqual([]);
  return ms;
}
/** One side's warm shaping, µs a glyph: 1 + 100,000 lines less 1 line, over the warm lines' glyphs. */
const warmUs = (bin: string, side: string, planted?: string): number => (Math.max(0, timed(bin, side, 1 + WARM, planted) - timed(bin, side, 1, planted)) * 1000) / (WARM * GLYPHS);

interface Verdict { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; shown: string }
/** One warm-up round and five, both sides in each, the order swapped each round; judged by the design's rule. */
function compare(planted?: string): Verdict {
  expect(error, 'the change\'s and the merge base\'s release deep-text build').toBe('');
  const sides = { change: (): number => warmUs(change, 'the change', planted), base: (): number => warmUs(base, `the merge base ${mergeBase.slice(0, 9)}`) };
  sides.change(); sides.base();
  const ratios: number[] = [];
  const readings: string[] = [];
  const loads: number[] = [];
  for (let k = 0; k < 5; k++) {
    loads.push(loadavg()[0]!);
    let c = 0; let b = 0;
    if (k % 2 === 0) { c = sides.change(); b = sides.base(); } else { b = sides.base(); c = sides.change(); }
    loads.push(loadavg()[0]!);
    ratios.push(c / b);
    readings.push(`${c.toFixed(4)} / ${b.toFixed(4)} µs a glyph = ${(c / b).toFixed(3)}`);
  }
  const cores = availableParallelism();
  const margin = Math.max(0.05, (Math.max(...ratios) - Math.min(...ratios)) / LIMIT);
  const shown = `warm shaping${planted ? ` planted ${planted}` : ''}, the change against the merge base ${mergeBase.slice(0, 9)}: ${readings.join('; ')} against ${LIMIT} (margin ${(margin * 100).toFixed(1)}%), loads ${loads.map((l) => l.toFixed(1)).join(', ')} on ${cores} cores`;
  console.log(`${ID} ${shown}`);
  if (loads.some((l) => !(l <= cores))) return { status: 'INCONCLUSIVE', shown: `a loaded run counts neither way (load ${Math.max(...loads).toFixed(1)} above the ${cores} cores): ${shown}` };
  if (ratios.some((r) => !(Number.isFinite(r) && r > 0))) return { status: 'INCONCLUSIVE', shown: `a side read 0 µs a glyph or less, its process start-up outweighing ${WARM} warm lines: ${shown}` };
  if (ratios.every((r) => r <= LIMIT)) return { status: 'PASS', shown };
  if (ratios.every((r) => r > LIMIT * (1 + margin))) return { status: 'FAIL', shown };
  return { status: 'INCONCLUSIVE', shown: `the five ratios are neither all within ${LIMIT} nor all over it by more than the margin: ${shown}` };
}

describe(`${ID} warm shaping stays within 5% of the merge base`, () => {
  it(`${ID} the 300-glyph label at 20 u and 450, shaped warm, takes at most 1.05 times the merge base's µs a glyph in five rounds out of five`, () => {
    const v = compare();
    if (v.status === 'FAIL') expect.fail(`FAIL ${v.shown}`);
    if (v.status === 'INCONCLUSIVE') inconclusive(v.shown);
  }, 3_600_000);

  it(`${ID} the planted shaper with no cache (deep-text shape --planted no_cache) on the change's side fails the same judge`, () => {
    const v = compare('no_cache');
    if (v.status === 'INCONCLUSIVE') inconclusive(v.shown);
    expect(v.status, `the timing check passes a shaper that shapes every line again: ${v.shown}`).toBe('FAIL');
  }, 3_600_000);
});

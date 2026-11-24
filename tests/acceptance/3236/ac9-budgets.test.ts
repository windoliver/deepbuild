// AC9 #3236.b81a558a: "Budgets, on the reference Mac in the local preflight, compared with the merge base: the value
// adds under 0.1 ms to a mark set's check at 100,000 rows, and a frame with no focus in the set costs nothing more. The
// 0.1 ms is a target, to be measured"
//
// First, with the file's build: the 100,000-row scatter (fixtures.ts `bigScatterDoc`) is presented and its node carries
// a value; without one there is nothing to time, and the test fails. Then the perf lane's judgeLimit
// (scripts/benchmark.mjs) says whether this machine can judge a budget now (a reference Mac on mains power, Low Power
// Mode off, thermal state nominal, the load under the core count); if not, the test is INCONCLUSIVE before anything is
// built in release, never a pass. If so: deep-show in release here, and at the merge base (`git merge-base HEAD
// origin/main`, its tree taken with `git archive` into target/acceptance-3236-base/, built there with its own target);
// one warm-up process each, then five rounds, each one process of each build presenting the scatter with
// `include: ["timing"]` (`timing.check_ms`, the check's own time) and evaluating one frame with no focus (`eval`'s
// `frame_ms`). The five differences, here less the merge base's (at least 0), are judged by judgeLimit against 0.1 ms
// for the check and against the same 0.1 ms floor for the frame ("costs nothing more"): FAIL fails, anything but PASS is
// INCONCLUSIVE with the readings printed. No timing or load reading passes anything else.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOC, SCATTER, bigScatterDoc } from './fixtures.ts';
import {
  AC, REPO, Script, TARGET, binOf, blocked, cargo, inconclusive, nodeOf, num, obj, prebuild, presented, runShow, scenario, seenOf, show, useTemp,
  type JsonObject,
} from './helpers.ts';

prebuild();
const temp = useTemp();
const D = DOC(9);
const LIMIT_MS = 0.1;
const RUNS = 5;
const AC9_TIMEOUT = 6 * 3_600_000;

interface Judge { status: string; reason?: string }
type Bench = { fingerprint: () => JsonObject; judgeLimit: (o: { limit: number; runs: number[]; fingerprint: JsonObject; loads: { start: number; end: number }[] }) => Judge };
const load = (): number => loadavg()[0]!;
/** git in the checkout, with no GIT_ setting from the environment. */
function git(args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', env, maxBuffer: 1024 * 1024 * 1024 }).trim();
}

/** One process of `bin`: the scatter presented with its check's timing, then one frame with no focus. */
function reading(bin: string, what: string): { check: number; frame: number } {
  const s = new Script();
  s.present(D, bigScatterDoc(D), true);
  const frame = s.eval(D, 0);
  const r = runShow(bin, scenario(temp(), [D], s.calls), what);
  presented(r[0]!, `${what}: the 100,000-row scatter`);
  return { check: num(obj(r[0]!['timing'], `${what}: timing`)['check_ms'], `${what}: timing.check_ms`), frame: num(r[frame]!['frame_ms'], `${what}: eval's frame_ms`) };
}

describe(`${AC[9]} the value's cost at check and a frame's cost, against the merge base`, () => {
  it(`${AC[9]} on the reference Mac, the value adds under ${LIMIT_MS} ms to the check at 100,000 rows, and a frame with no focus costs nothing more`, async () => {
    // The value exists at 100,000 rows: else there is nothing to time.
    const s = new Script();
    s.present(D, bigScatterDoc(D));
    const seen = s.see();
    const r = runShow(binOf(), scenario(temp(), [D], s.calls), 'AC9 the 100,000-row scatter');
    presented(r[0]!, 'the 100,000-row scatter');
    const node = nodeOf(seenOf(r[seen]!, 'see'), SCATTER);
    expect(typeof node?.['value'] === 'string' && node['value'].trim() !== '', `the 100,000-row set's node carries a value to time: ${show(node, 400)}`).toBe(true);

    // Whether this machine can judge a budget now: else INCONCLUSIVE before any release build.
    const bench = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
    const now = Array.from({ length: RUNS }, () => ({ start: load(), end: load() }));
    const here = bench.judgeLimit({ limit: LIMIT_MS, runs: Array.from({ length: RUNS }, () => 0), fingerprint: bench.fingerprint(), loads: now });
    if (here.status !== 'PASS') inconclusive(`this machine can't judge a budget now: ${String(here.reason)}`);

    // The two release builds.
    let base = '';
    try { base = git(['merge-base', 'HEAD', 'origin/main']); } catch (e) { blocked(`no merge base with origin/main: ${(e as Error).message.slice(0, 300)}`); }
    if (base === git(['rev-parse', 'HEAD'])) inconclusive(`HEAD is the merge base ${base}: no change to compare with it`);
    const err = cargo(['build', '--release', '--locked', '--bin', 'deep-show'], REPO);
    if (err) blocked(`deep-show doesn't build in release here: ${err}`);
    const head = join(TARGET, 'release', 'deep-show');
    const dir = join(TARGET, 'acceptance-3236-base', base.slice(0, 12));
    const src = join(dir, 'src');
    const atBase = join(dir, 'target', 'release', 'deep-show');
    if (!existsSync(atBase)) {
      rmSync(src, { recursive: true, force: true });
      mkdirSync(src, { recursive: true });
      const tar = spawnSync('git', ['-C', REPO, 'archive', '--format=tar', base], { maxBuffer: 4 * 1024 * 1024 * 1024, env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))) });
      if (tar.status !== 0) blocked(`git archive ${base} failed: ${String(tar.stderr).slice(-400)}`);
      const x = spawnSync('tar', ['-x', '-C', src], { input: tar.stdout, maxBuffer: 64 * 1024 * 1024 });
      if (x.status !== 0) blocked(`the merge base's tree didn't unpack: ${String(x.stderr).slice(-400)}`);
      const e = cargo(['build', '--release', '--locked', '--bin', 'deep-show', '--target-dir', join(dir, 'target')], src);
      if (e) blocked(`deep-show at the merge base ${base} doesn't build in release: ${e}`);
    }

    // One warm-up each, then five rounds of one process of each build.
    reading(head, 'warm-up here');
    reading(atBase, 'warm-up at the merge base');
    const checks: number[] = []; const frames: number[] = []; const loads: { start: number; end: number }[] = [];
    for (let k = 0; k < RUNS; k++) {
      const start = load();
      const h = reading(head, `round ${k + 1} here`);
      const b = reading(atBase, `round ${k + 1} at the merge base`);
      loads.push({ start, end: load() });
      checks.push(Math.max(0, h.check - b.check));
      frames.push(Math.max(0, h.frame - b.frame));
    }
    const machine = bench.fingerprint();
    const verdicts = [
      ['the check at 100,000 rows, here less the merge base', bench.judgeLimit({ limit: LIMIT_MS, runs: checks, fingerprint: machine, loads }), checks],
      ['a frame with no focus, here less the merge base', bench.judgeLimit({ limit: LIMIT_MS, runs: frames, fingerprint: machine, loads }), frames],
    ] as const;
    const open: string[] = [];
    for (const [what, v, runs] of verdicts) {
      const line = `${what}: ${runs.map((x) => x.toFixed(4)).join(', ')} ms against ${LIMIT_MS} ms on ${String(machine['model'])}: ${v.status}${v.reason ? ` (${v.reason})` : ''}`;
      console.log(`${AC[9]} ${line}`);
      expect(v.status, line).not.toBe('FAIL');
      if (v.status !== 'PASS') open.push(line);
    }
    if (open.length) inconclusive(open.join('; '));
  }, AC9_TIMEOUT);
});

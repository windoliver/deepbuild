// Criterion 8: budgets, on the reference Mac in the local preflight, compared with the merge base: the whole kit runs in
// under 60 s per backend and target on the reference Mac; a trial of one interface's corpus documents, parity fixtures
// and two 1,200-step tracks finishes in under 15 minutes in two replicas; and a build gains no work at run time.
// Off a reference Mac fit to judge, each test still runs its structural part, then skips as INCONCLUSIVE, never a pass.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  AC, B, TIMEOUT, bake, fastBallWorld, gate, judgeRuns, kitCall, kitReport, median, mergeBase, mergeBasePhysics, one,
  physicsBin, prebuild, prebuildShow, rollingBallWorld, scenario, settle, show, showBin, showRun, simBoard, str, trackCall,
  wasm32, type JsonObject,
} from './helpers.ts';

prebuild(['release']);
prebuildShow(['inUse', 'candidate']);
const KIT_LIMIT_S = 60;
const TRIAL_LIMIT_S = 15 * 60;

/** `f`'s wall time (s). */
function timed(f: () => unknown): number {
  const at = performance.now();
  f();
  return (performance.now() - at) / 1000;
}

describe(`${AC[8]} budgets on the reference Mac, compared with the merge base`, () => {
  test(`${AC[8]} the whole kit runs in under 60 s per backend and target (release macOS arm64, and wasm32)`, (ctx) => {
    const native = kitReport(one(kitCall(), { build: 'release' }), 'behavior_kit (release)');
    expect(native.results.length, 'the kit ran its fixtures').toBeGreaterThan(0);
    const web = kitReport(wasm32([kitCall()])[0]!, 'behavior_kit (wasm32)');
    expect(web.results.length, 'the kit ran its fixtures on wasm32').toBeGreaterThan(0);
    gate(ctx);
    const runs = (f: () => unknown): number[] => { f(); return Array.from({ length: 5 }, () => timed(f)); };
    settle(ctx, [
      judgeRuns('kit, rapier3d, aarch64-apple-darwin (s)', runs(() => one(kitCall(), { build: 'release' })), KIT_LIMIT_S),
      // The wasm32 leg's script checks its build first (cargo finds it fresh after the warm-up) and then runs the kit.
      judgeRuns('kit, rapier3d, wasm32-unknown-unknown (s)', runs(() => wasm32([kitCall()])), KIT_LIMIT_S),
    ]);
  }, TIMEOUT);

  test(`${AC[8]} a trial of test.sim@1's corpus documents, parity fixtures and two 1,200-step tracks finishes in under 15 minutes in two replicas`, (ctx) => {
    const evidence = mkdtempSync(join(tmpdir(), 'deep-191-trial-'));
    try {
      const corpus = join(evidence, 'corpus');
      const store = join(evidence, 'tracks');
      const doc = simBoard('Trial steady', 2.5);
      const setup: JsonObject[] = [
        { call: 'corpus_record', corpus, name: 'steady', document: doc, times: ['0s', '1s'] },
        { call: 'corpus_record', corpus, name: 'raised', document: simBoard('Trial raised', 9.75), times: ['0s', '1s'] },
        trackCall(store, doc, [[0, 1.25], [300, 4.5], [900, 0.5]]),
        trackCall(store, doc, [[0, 6], [600, 12.25]]),
      ];
      const { replies } = showRun(showBin('inUse'), scenario(evidence, setup));
      const tracks = replies.slice(2).map((r, i) => str(r['track'], `track_record ${i}: track (${show(r)})`));
      const trial: JsonObject = { call: 'trial', candidate: B, build: showBin('candidate'), corpus, store, tracks };
      const once = (): { reply: JsonObject; s: number } => {
        const { replies: [reply], ms } = showRun(showBin('inUse'), scenario(evidence, [trial]));
        return { reply: reply!, s: ms / 1000 };
      };
      const first = once();
      expect(first.reply['ok'], `the trial ran: ${show(first.reply)}`).toBe(true);
      expect(Array.isArray(first.reply['replicas']) ? first.reply['replicas'].length : 0, `the trial ran in two replicas: ${show(first.reply['replicas'])}`).toBe(2);
      gate(ctx);
      settle(ctx, [judgeRuns('trial, test.sim@1, two replicas (s)', Array.from({ length: 5 }, () => once().s), TRIAL_LIMIT_S)]);
    } finally {
      rmSync(evidence, { recursive: true, force: true });
    }
  }, TIMEOUT);

  test(`${AC[8]} a build gains no work at run time: bakes take no longer than the merge base's`, (ctx) => {
    // The build under test carries the kit; nothing of it runs when a world is baked.
    expect(kitReport(one(kitCall(), { build: 'release' }), 'behavior_kit (release)').results.length, 'this build carries the kit').toBeGreaterThan(0);
    gate(ctx);
    const dir = mkdtempSync(join(tmpdir(), 'deep-191-base-'));
    try {
      const base = join(dir, 'deep-physics-base');
      expect(mergeBasePhysics(mergeBase(), base), 'the merge base builds deep-physics (release)').toBe('');
      const calls = [bake(fastBallWorld(true), 600), bake(rollingBallWorld(), 600)];
      const here = physicsBin('release');
      const time = (bin: string): number => {
        const at = performance.now();
        const run = spawnSync(bin, [], { input: `${calls.map((c) => JSON.stringify(c)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
        expect(run.status, `${bin} bakes`).toBe(0);
        return (performance.now() - at) / 1000;
      };
      time(base); time(here);
      const baseRuns = Array.from({ length: 5 }, () => time(base));
      const hereRuns = Array.from({ length: 5 }, () => time(here));
      settle(ctx, [judgeRuns('two 600-step bakes here against the merge base\'s median + 5% (s)', hereRuns, median(baseRuns) * 1.05)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);
});

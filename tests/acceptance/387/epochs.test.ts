// #387.18d0b377: changes made while a session was hidden all apply when it shows again, and a session
// re-checked after a long run rebases its epochs without missing one (parity/kernel/epoch-rebase.scene).
// A long run is the scenario's `epoch_start` near the u32 wrap; "without missing one" is read on
// results: every visible frame equals the same frame evaluated clean in the same process, and every
// node is a u32-epoch session's (README: Readings). The wrong programs: a hidden session that drops what
// changed meanwhile, and epochs compared across the wrap without a rebase (a change after the wrap kept
// with a stale result). At the base there is no `eval` or `panel` call.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DOC, dropped, edit, evalCall, evaluated, fixture, obj, outcome, panelCall, run, sameNodes, scenario, show, useBuilds, useEvidence,
  type Build, type JsonObject, type JsonValue,
} from './helpers.ts';

const FULL: Build = { set: 'full' };
const builds = useBuilds([FULL]);
const evidence = useEvidence();

/** The fast-check seed of the generated runs, recorded so a failure replays. */
const SEED = 387_0002;

type SceneStep = { eval: string } | { edit: Record<string, JsonValue> } | { hide: true } | { show: true };

/** What each reply of a played scene must be. */
type Expect = { kind: 'shown'; visible: boolean } | { kind: 'frame'; t: string } | { kind: 'clean'; t: string } | { kind: 'hidden-frame' } | { kind: 'panel' };

/**
 * Plays a scene's steps on DOC.a: each visible frame is followed by the same frame evaluated clean;
 * while hidden, a frame is asked for after each change. With `requireRebase`, the session's epoch must
 * fall back once across the run (the scene starts eight below the wrap and makes more changes than that).
 */
function play(document: JsonObject, steps: readonly SceneStep[], epochStart: number, requireRebase: boolean): string[] {
  const calls: JsonObject[] = [];
  const expects: Expect[] = [];
  let current: JsonObject | null = null;
  let visible = true;
  const revise = (next: JsonObject): void => {
    calls.push(show(next, { removes: dropped(current, next) }));
    expects.push({ kind: 'shown', visible });
    current = next;
    if (!visible) { calls.push(evalCall(DOC.a, { t: '0s' })); expects.push({ kind: 'hidden-frame' }); }
  };
  revise(document);
  for (const step of steps) {
    if ('eval' in step) {
      if (!visible) { calls.push(evalCall(DOC.a, { t: step.eval })); expects.push({ kind: 'hidden-frame' }); continue; }
      calls.push(evalCall(DOC.a, { t: step.eval }), evalCall(DOC.a, { t: step.eval, clean: true }));
      expects.push({ kind: 'frame', t: step.eval }, { kind: 'clean', t: step.eval });
    } else if ('edit' in step) {
      revise(edit(current!, step.edit));
    } else if ('hide' in step) {
      calls.push(panelCall(DOC.a, false)); expects.push({ kind: 'panel' }); visible = false;
    } else {
      calls.push(panelCall(DOC.a, true)); expects.push({ kind: 'panel' }); visible = true;
    }
  }
  const replies = run(builds.bin(FULL), scenario(evidence(), calls, { epoch_start: epochStart }));
  const failures: string[] = [];
  const epochs: number[] = [];
  for (let i = 0; i < replies.length; i++) {
    const e = expects[i]!;
    const r = replies[i]!;
    if (e.kind === 'shown') {
      const want = e.visible ? 'presented' : 'not_presented';
      if (outcome(r) !== want) failures.push(`call ${i}: a revision while ${e.visible ? 'visible' : 'hidden'} is ${outcome(r)}, not ${want}: ${JSON.stringify(r).slice(0, 400)}`);
      if (!e.visible && r['reason'] !== 'hidden') failures.push(`call ${i}: a revision while hidden says ${JSON.stringify(r['reason'])}, not hidden`);
    } else if (e.kind === 'hidden-frame') {
      if (outcome(r) !== 'not_presented' || r['reason'] !== 'hidden') failures.push(`call ${i}: a hidden session was evaluated: ${JSON.stringify(r).slice(0, 400)}`);
    } else if (e.kind === 'frame') {
      const live = evaluated(r, `the frame at ${e.t} (call ${i})`);
      const clean = evaluated(replies[i + 1]!, `the clean frame at ${e.t} (call ${i + 1})`);
      epochs.push(live.epoch);
      failures.push(...sameNodes(clean, live, `the frame at ${e.t} against a clean evaluation`));
    } else if (e.kind === 'panel') {
      obj(r, `call ${i}: the panel's reply`);
    }
  }
  const fell = epochs.some((v, i) => i > 0 && v < epochs[i - 1]!);
  if (requireRebase && !fell) failures.push(`the session's epoch never fell back across the run from ${epochStart}: ${epochs.join(', ')}`);
  return failures;
}

describe('#387.18d0b377 changes made while a session was hidden all apply when it shows again, and a session re-checked after a long run rebases its epochs without missing one', () => {
  it('#387.18d0b377 parity/kernel/epoch-rebase.scene: hidden revisions aren\'t evaluated, every frame after the panel shows again equals a clean evaluation, and the epochs rebase across the u32 wrap without missing a change', () => {
    const scene = fixture('parity/kernel/epoch-rebase.scene');
    const steps = scene['steps'] as unknown as SceneStep[];
    expect(play(obj(scene['document'], 'the scene\'s document'), steps, Number(scene['epoch_start']), true)).toEqual([]);
  }, 600_000);

  it(`#387.18d0b377 generated runs of hides, shows, revisions and frames from an epoch start within 24 of the wrap never miss a change (fast-check seed ${SEED}, 30 runs)`, () => {
    const scene = fixture('parity/kernel/epoch-rebase.scene');
    const document = obj(scene['document'], 'the scene\'s document');
    const boxes = ['r1', 'r2', 'r3', 'r4'];
    const times = ['0s', '0.1s', '0.3s', '0.5s', '0.9s', '1.2s', '2s'];
    const step: fc.Arbitrary<SceneStep> = fc.oneof(
      fc.record({ item: fc.constantFrom(...boxes), index: fc.integer({ min: 0, max: 3 }), value: fc.integer({ min: 4, max: 90 }) })
        .map((e): SceneStep => ({ edit: { [`items/${e.item}/params/box/${e.index}`]: e.value } })),
      fc.constantFrom(...times).map((t): SceneStep => ({ eval: t })),
      fc.constant<SceneStep>({ hide: true }),
      fc.constant<SceneStep>({ show: true }),
    );
    const runs = fc.record({ start: fc.integer({ min: 2 ** 32 - 24, max: 2 ** 32 - 1 }), steps: fc.array(step, { minLength: 8, maxLength: 40 }) });
    fc.assert(fc.property(runs, (r) => {
      // Every run ends visible with two frames, so the last changes are evaluated.
      const steps: SceneStep[] = [{ eval: '0s' }, ...r.steps, { show: true }, ...times.map((t): SceneStep => ({ eval: t })), { edit: { 'items/r1/params/box/0': 33 } }, { eval: '2s' }];
      expect(play(document, steps, r.start, false)).toEqual([]);
    }), { seed: SEED, numRuns: 30, endOnFailure: true });
  }, 1_800_000);
});

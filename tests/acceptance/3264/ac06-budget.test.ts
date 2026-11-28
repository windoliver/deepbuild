import { describe, expect, it } from 'vitest';
import { runSeed } from '../556/helpers.ts';
import { AC, LIMIT, benchmark, entryCheck, inconclusive, load, lockPlay, playtestSpec, told, type Obj, type Result } from './helpers.ts';
import { addedMs, alwaysWrong } from './judges.ts';
import { AT, IDLE, KEY_BEFORE_DOOR, NEVER_NEGATIVE, PATH, RUNS, SEED, crawlerPlay } from './programs.ts';
import { recordedReplica, type SeriesOf } from './recorded.ts';

const STEPS = 14_400;
const LIMIT_MS = 100;
const READINGS = 5;
const EIGHT = {
  always: [
    NEVER_NEGATIVE,
    { name: 'hp_capped', when: 'hp <= 17' },
    { name: 'turns_are_moves', when: 'turn == accepted' },
    { name: 'none_refused', when: 'refused == 0' },
  ],
  order: [
    KEY_BEFORE_DOOR,
    { name: 'door_before_exit', first: 'door_open', then: 'won' },
    { name: 'move_before_key', first: 'turn >= 1', then: 'has_key' },
    { name: 'key_before_exit', first: 'has_key', then: 'won' },
  ],
};
const LAST_RUN = RUNS - 1;
const LAST_STEP = STEPS - 1;

const recordedValue = (path: string, k: number): number =>
  path === PATH.turn || path === PATH.accepted ? Math.min(k, AT.exit)
    : path === PATH.key ? Number(k >= AT.key && k < AT.door)
      : path === PATH.door ? Number(k >= AT.door)
        : path === PATH.hp ? (k >= AT.trap ? 2 : 7)
          : path === PATH.won ? Number(k >= AT.exit)
            : 0;

function recordings(): { kept: SeriesOf; lastStepBelow: SeriesOf } {
  const whole = new Map<string, unknown[]>();
  const kept: SeriesOf = (path, _seed, steps) => {
    const key = `${path} ${steps}`;
    if (!whole.has(key)) whole.set(key, Array.from({ length: steps }, (_, k) => [recordedValue(path, k)]));
    return whole.get(key)!;
  };
  const broken = new Map<number, unknown[]>();
  const lastStepBelow: SeriesOf = (path, seed, steps) => {
    if (path !== PATH.hp || seed !== runSeed(SEED, LAST_RUN) || steps !== STEPS) return kept(path, seed, steps);
    if (!broken.has(steps)) broken.set(steps, [...kept(path, seed, steps).slice(0, LAST_STEP), [-1]]);
    return broken.get(steps)!;
  };
  return { kept, lastStepBelow };
}

async function timed(run: () => Promise<Result>): Promise<{ ms: number; result: Result }> {
  const at = performance.now();
  const result = await run();
  return { ms: performance.now() - at, result };
}

describe(`AC6 ${AC[6]} eight rules over 20 runs of 14,400 steps add under 100 ms to the check`, () => {
  it(`AC6 ${AC[6]} eight rules are read at each of the 14,400 steps of 20 recorded runs, and on a reference Mac at rest add under 100 ms to the check in five readings`, async () => {
    const play = await lockPlay(crawlerPlay());
    const { kept, lastStepBelow } = recordings();
    const onKept = await entryCheck({ play: recordedReplica(kept) });
    const onBroken = await entryCheck({ play: recordedReplica(lastStepBelow) });
    const input = (rules: Obj): Obj => ({
      piece: 'recorded@1', play, bots: [IDLE], runs: RUNS, seed: SEED, span: { steps: STEPS }, goals: [{ name: 'out', when: 'won >= 1', each: true }], frames: { every: 0 }, ...rules,
    });
    const ruled = playtestSpec(input(EIGHT));
    const bare = playtestSpec(input({}));

    const failed = await onBroken(ruled);
    expect(failed.outcome, `a recording whose last run reads hp -1 at its last step alone fails under the eight rules: ${told(failed)}`).toBe('failed');
    expect(alwaysWrong(failed, NEVER_NEGATIVE.name, new Map([[`bot 0 run ${LAST_RUN}`, { step: LAST_STEP, values: { hp: -1 } }]])), `with playtest.always naming that run, step ${LAST_STEP} and hp -1: ${told(failed)}`).toEqual([]);
    const passed = await onKept(ruled);
    expect([passed.outcome, passed.testsRun, passed.failures], `the recording that keeps all eight passes over 20 runs: ${told(passed)}`).toEqual(['passed', RUNS, []]);

    const { fingerprint, judgeLimit } = await benchmark();
    const added: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let n = 0; n <= READINGS; n++) {
      const start = load();
      const without = await timed(() => onKept(bare));
      const withRules = await timed(() => onKept(ruled));
      expect([without.result.outcome, withRules.result.outcome], `reading ${n}: the check passes with and without the rules`).toEqual(['passed', 'passed']);
      if (n > 0) {
        added.push(addedMs(withRules.ms, without.ms));
        loads.push({ start, end: load() });
      }
    }
    const judged = judgeLimit({ limit: LIMIT_MS, runs: added, fingerprint: fingerprint(), loads });
    const reading = `eight rules over ${RUNS} runs of ${STEPS} steps add ${added.map((ms) => ms.toFixed(1)).join(', ')} ms to the check against ${LIMIT_MS} ms, at loads ${loads.map((l) => `${l.start.toFixed(1)} to ${l.end.toFixed(1)}`).join(', ')}: ${judged.status}${judged.reason ? ` (${judged.reason})` : ''}`;
    console.log(`${AC[6]} ${reading}`);
    expect(judged.status, reading).not.toBe('BLOCKED');
    expect(judged.status, reading).not.toBe('FAIL');
    if (judged.status !== 'PASS') inconclusive(reading);
  }, LIMIT);
});

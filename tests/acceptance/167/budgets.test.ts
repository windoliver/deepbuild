// AC7 #167.c3055836: "Budgets, on the reference Mac in the local preflight, compared with the merge base: ranking 200
// keys over 100 periods takes under 5 ms at check, mixing them under 0.05 ms per frame, and a race at rest draws
// nothing"
//
// 20,000 rows, seeded. `check` with `timing: true` answers `timing.rank_ms`, the standing transform's ranking alone, and
// `geometry` with `timing: true` answers `timing.mix_ms`, the mix alone for one frame (README: Budgets). The design's
// rule, as #397 AC1 and #380 hold it: a warm-up process, then five fresh release ones; PASS when all are within the
// limit, FAIL when all are over it by more than the margin, the larger of 5% and their spread, else INCONCLUSIVE. Off a
// reference Mac or under load the two timed tests skip as INCONCLUSIVE before the release build, which is slow, and
// never pass there. The merge base has no periods, so it has no reading to compare with: the limits are the absolute
// budget (README: Readings). "At rest" is the race held before its `at` starts to move: `idle` (#854) holds it on the
// real clock and counts frames drawn after the first. That one isn't timed, so it's judged wherever Metal runs.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, type TestContext } from 'vitest';
import {
  AC, LOOK, RACE_SCALES, TIMEOUT, document, environmentProblem, fl, i32Column, judge, lines, median, num, obj, p95, raceBars, ramp, releaseRender, seeded, useRender, type JsonObject, type JsonValue, type Period,
} from './helpers.ts';

const render = useRender();
const ID = AC[7];
const KEYS = 200;
const PERIODS = 100;
const FRAMES = 300;
const RUNS = 5;
const SPAN = 100;
const random = seeded(7);
const periods: Period[] = Array.from({ length: PERIODS }, (_, p) => [2000 + p, Object.fromEntries(Array.from({ length: KEYS }, (_, k) => [`k${k}`, Math.floor(random() * 50)]))]);

/** The race of 20,000 rows, `at` crossing all the periods over SPAN seconds, keyed by number to keep the line small. */
function bigRace(): JsonObject {
  const channels = { at: ramp('items/race/params/transforms/0/periods/at', 2000, 2000 + PERIODS - 1, SPAN) };
  const doc = document('budget-167', 'A race of 200 keys over 100 periods', [400, 280], SPAN, [...RACE_SCALES, raceBars(periods)], { channels });
  const params = obj(obj(obj(doc['items'], 'items')['race'], 'race')['params'], 'race params');
  params['columns'] = { ...obj(params['columns'], 'columns'), key: i32Column(periods.flatMap(() => Array.from({ length: KEYS }, (_, k) => k))) };
  return doc;
}

let release = '';
let dir = '';
function judged(ctx: TestContext): string {
  const problem = environmentProblem();
  if (problem) ctx.skip(`INCONCLUSIVE (not read): ${problem}`);
  if (!release) { dir = mkdtempSync(join(tmpdir(), 'deep-167-release-')); release = releaseRender(dir); }
  return release;
}
afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
const timing = (a: JsonValue, field: string, what: string): number => num(obj(obj(a, what)['timing'], `${what}: timing`)[field], `${what}: timing.${field}`);

describe(`${ID} the budgets of a race`, () => {
  it(`${ID} (rank) ranking 200 keys over 100 periods takes under 5 ms at check`, (ctx) => {
    const bin = judged(ctx);
    const doc = bigRace();
    const run = (): number => median(lines(bin, 'check', Array.from({ length: 5 }, () => ({ doc, look: LOOK, timing: true }))).map((a) => timing(a, 'rank_ms', 'check')));
    run();
    judge(ctx, 'rank_ms', Array.from({ length: RUNS }, run), 5);
  }, TIMEOUT);

  it(`${ID} (mix) mixing them takes under 0.05 ms per frame`, (ctx) => {
    const bin = judged(ctx);
    const doc = bigRace();
    const times = Array.from({ length: FRAMES }, (_, k) => fl(((k + 0.5) * SPAN) / FRAMES));
    const run = (): number => p95(lines(bin, 'geometry', times.map((t) => ({ doc, item: 'race', t, look: LOOK, timing: true }))).map((a) => timing(a, 'mix_ms', 'geometry')));
    run();
    judge(ctx, 'mix_ms', Array.from({ length: RUNS }, run), 0.05);
  }, TIMEOUT);

  it(`${ID} (rest) a race at rest draws nothing`, () => {
    // `at` holds its first key for the 2 s held on screen; its keys start at 30 s.
    const held = {
      target: 'items/race/params/transforms/0/periods/at', type: 'f32',
      keys: { k0: { t: '30s', value: 2000, interp: 'linear' }, k1: { t: '31s', value: 2001, interp: 'linear' } },
    };
    const doc = document('rest-167', 'A race at rest', [400, 280], 40, [...RACE_SCALES, raceBars(periods.slice(0, 2))], { channels: { at: held } });
    const answer = obj(lines(render(), 'idle', [{ doc, look: LOOK, view: { zoom: 1, theme: 'light' }, seconds: 2 }])[0], 'idle');
    if (answer['code'] === 'unsupported_platform') expect.fail('INCONCLUSIVE: idle answers unsupported_platform; this is not a pass');
    expect(answer['ok'], `idle holds the race: ${JSON.stringify(answer).slice(0, 800)}`).toBe(true);
    expect(answer['frames'], `no frame drawn while the race rests: ${JSON.stringify(answer['drawn']).slice(0, 400)}`).toBe(0);
  }, TIMEOUT);
});

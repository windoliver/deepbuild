// AC2 #555.2e7fd78d: "A planted twin whose published hero cell lags one step behind the hero sends the descender into
// walls and fails playtest.band, naming the descender, deep, its measured share and [0.9, 1]; a twin whose monsters
// never attack fails playtest.band on dead for the waiting policy with a share of 0; and a twin that moves the hero
// down a floor on its own every 500 steps fails playtest.expect, naming the waiting policy's first run and the step
// depth reached 3"
//
// One test a twin, each the playtest of criterion 1's input with the one bot the clause names (20 runs, its band or
// expectation as criterion 1 gives it), under the crawler's locked interface, on two debug replicas.
// - lag: the descender's runs, read from what the replicas played, reach depth 3 in a share under 0.9; the failure
//   `bot 0` starts playtest.band and names the descender, deep, that share (`share <s>`) and [0.9, 1].
// - nofight: no waiting run's hero dies; the failure `bot 0` starts playtest.band and names the policy, dead, `share 0`
//   and [1, 1].
// - sinker: the waiting policy's run 0 reaches depth 3 at the step its values show (step 1000); the failure
//   `bot 0 run 0` starts playtest.expect and names deep and that step.
// The wrong programs: the base (no bands, no expectations, no first-party bots), and a plug-in that reads a band or an
// expectation but never fails it, or names another share or step than the runs the replica played.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, failureOf, firstStep, lockPlay, macOnly, openHub, putPiece, runPlaytest, runsOf, shown, valuesOf, word, type Hub,
} from './helpers.ts';
import { DESCENDER_BAND, PATH, RUNS, SINK_EVERY, WAITING_BAND, crawlerInput, crawlerPiece, crawlerPlay, crawlerProgram, type Variant } from './programs.ts';

let opened: Promise<{ pool: Pool; hub: Hub }> | undefined;
const hubOnce = (): Promise<{ pool: Pool; hub: Hub }> => (opened ??= (async () => { const pool = await Pool.open(2); return { pool, hub: await openHub(pool) }; })());
async function twin(doc: string, v: Variant, bot: Record<string, unknown>) {
  macOnly();
  const play = await lockPlay(crawlerPlay());
  const piece = putPiece(doc, crawlerPiece(crawlerProgram(v), v));
  const input = crawlerInput(piece, play, [bot]);
  const { pool, hub } = await hubOnce();
  const result = await runPlaytest(hub, input);
  return { input, result, runs: runsOf(pool.log, input) };
}
/** The message after its code, so a word is read from what it names. */
const rest = (m: string, code: string): string => m.slice(code.length);

describe(`${AC[2]} each planted twin fails the band or expectation the criterion names`, () => {
  it(`${AC[2]} the twin whose hero cell lags a step fails playtest.band, naming the descender, deep, its share and [0.9, 1]`, async () => {
    const { result, runs } = await twin(DOC.lag, 'lag', DESCENDER_BAND);
    const deep = runs.filter((r) => firstStep(valuesOf(r.play.reply, PATH.depth), (v) => v >= 3) >= 0).length;
    const share = deep / RUNS;
    expect(share, `the lagging twin's descender reaches depth 3 in ${deep} of ${RUNS} runs, a share outside [0.9, 1]`).toBeLessThan(0.9);
    expect(result.outcome, `the lagging twin's playtest fails: ${shown(result)}`).toBe('failed');
    const f = failureOf(result, 'bot 0', 'playtest.band');
    expect(f, `a failure "bot 0" starting playtest.band (${shown(result)})`).toBeDefined();
    const said = rest(f!.message, 'playtest.band');
    for (const w of ['descender', 'deep', `share ${share}`]) expect(word(w).test(said), `it names ${w}: ${f!.message}`).toBe(true);
    expect(said.includes('[0.9, 1]'), `it names the band [0.9, 1]: ${f!.message}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[2]} the twin whose monsters never attack fails playtest.band on dead for the waiting policy with a share of 0`, async () => {
    const { result, runs } = await twin(DOC.nofight, 'nofight', WAITING_BAND);
    const died = runs.filter((r) => firstStep(valuesOf(r.play.reply, PATH.dead), (v) => v >= 1) >= 0).map((r) => `run ${r.i}`);
    expect(died, 'no waiting run\'s hero dies on the twin whose monsters never attack').toEqual([]);
    expect(result.outcome, `the twin's playtest fails: ${shown(result)}`).toBe('failed');
    const f = failureOf(result, 'bot 0', 'playtest.band');
    expect(f, `a failure "bot 0" starting playtest.band (${shown(result)})`).toBeDefined();
    const said = rest(f!.message, 'playtest.band');
    for (const w of ['policy', 'dead', 'share 0']) expect(word(w).test(said), `it names ${w}: ${f!.message}`).toBe(true);
    expect(said.includes('[1, 1]'), `it names the band [1, 1]: ${f!.message}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[2]} the twin that moves the hero down every ${SINK_EVERY} steps fails playtest.expect, naming the waiting policy's first run and the step depth reached 3`, async () => {
    const { result, runs } = await twin(DOC.sinker, 'sinker', WAITING_BAND);
    const first = runs.find((r) => r.i === 0)!;
    const step = firstStep(valuesOf(first.play.reply, PATH.depth), (v) => v >= 3);
    expect(step, `the waiting policy's run 0 reaches depth 3 on the twin, at step ${2 * SINK_EVERY}`).toBe(2 * SINK_EVERY);
    expect(result.outcome, `the twin's playtest fails: ${shown(result)}`).toBe('failed');
    const f = failureOf(result, 'bot 0 run 0', 'playtest.expect');
    expect(f, `a failure "bot 0 run 0" starting playtest.expect (${shown(result)})`).toBeDefined();
    const said = rest(f!.message, 'playtest.expect');
    expect(word('deep').test(said), `it names deep: ${f!.message}`).toBe(true);
    expect(word(`step ${step}`).test(said), `it names step ${step}: ${f!.message}`).toBe(true);
  }, TIMEOUT);
});

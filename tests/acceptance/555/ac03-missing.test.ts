// AC3 #555.4e926f67: "A twin that publishes no turn array fails the playtest with play.missing, naming turn, before any
// run; rules.legal (#1048) and grid.reach (#556) fail the same way, each proven in its own issue; and a policy or bot
// that names an action the interface doesn't declare is refused before any run, naming the action"
//
// The middle clause is proven in #1048 and #556 and isn't tested here. Under the crawler's locked interface, on two
// debug replicas:
// - The noturn twin (it declares and writes no turn array) under criterion 1's playtest: the check doesn't pass, a
//   failure starts play.missing and names turn, it counts no run, and every replica call it made ran no step (an
//   error, or a play of no step: the owner's ruling on #184's "before any run").
// - On the clean crawler, a policy that names the action pray on wait_key, and a descender whose action is dive, each
//   in a playtest of its own: neither passes, a failure names the action, no run is counted and no call ran a step.
//   Then the waiting policy and the descender as criterion 1 names them, one run each, are both played and counted,
//   so a refusal of every policy or bot that names an action fails here too.
// The wrong programs: the base (no play interface), a plug-in that plays the twin and fails its runs instead, and one
// that plays an action the interface doesn't declare.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, Pool, TIMEOUT, kindOf, lockPlay, macOnly, openHub, putPiece, ranNoStep, runPlaytest, runSeed, shown, word, type CheckResult, type Hub, type Played,
} from './helpers.ts';
import {
  DESCENDER, DESCENDER_BAND, EXPLORER, LEGAL, SEED, WAITING, WAITING_BAND, crawlerInput, crawlerPiece, crawlerPlay, crawlerProgram,
} from './programs.ts';

let opened: Promise<{ pool: Pool; hub: Hub }> | undefined;
const hubOnce = (): Promise<{ pool: Pool; hub: Hub }> => (opened ??= (async () => { const pool = await Pool.open(2); return { pool, hub: await openHub(pool) }; })());

/** Runs `input` and returns its result with the replica calls it made. */
async function refusedRun(input: Record<string, unknown>): Promise<{ result: CheckResult; calls: Played[] }> {
  const { pool, hub } = await hubOnce();
  const before = pool.log.length;
  const result = await runPlaytest(hub, input);
  return { result, calls: pool.log.slice(before) };
}
function refusedBeforeAnyRun(what: string, name: string, result: CheckResult, calls: Played[]): void {
  expect(result.outcome, `${what} doesn't pass: ${shown(result)}`).not.toBe('passed');
  expect(result.failures.some((f) => word(name).test(`${f.test} ${f.message}`)), `a failure names ${name}: ${shown(result)}`).toBe(true);
  expect(result.testsRun, `${what} counts no run: ${shown(result)}`).toBe(0);
  const ran = calls.filter((c) => !ranNoStep(c)).map((c) => `a play of ${String(c.reply['steps'])} steps`);
  expect(ran, `${what}: every replica call it made ran no step`).toEqual([]);
}

describe(`${AC[3]} a missing name fails play.missing before any run; an undeclared action is refused before any run`, () => {
  it(`${AC[3]} the twin that publishes no turn array fails play.missing, naming turn, before any run`, async () => {
    macOnly();
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.noturn, crawlerPiece(crawlerProgram('noturn'), 'noturn'));
    const { result, calls } = await refusedRun(crawlerInput(piece, play, [DESCENDER_BAND, EXPLORER, LEGAL, WAITING_BAND]));
    refusedBeforeAnyRun('the noturn twin\'s playtest', 'turn', result, calls);
    const f = result.failures.find((x) => x.message.startsWith('play.missing'));
    expect(f, `a failure starts play.missing: ${shown(result)}`).toBeDefined();
    expect(word('turn').test(f!.message.slice('play.missing'.length)), `it names turn: ${f!.message}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[3]} a policy or a bot that names an action the interface doesn't declare is refused before any run, naming the action`, async () => {
    macOnly();
    const play = await lockPlay(crawlerPlay());
    const piece = putPiece(DOC.crawler, crawlerPiece(crawlerProgram('clean'), 'clean'));
    const pray = { policy: { pick: { wait_key: { from: ['pray'], every: 0.25 } } } };
    const dive = { descender: { action: 'dive', every: 1 } };
    for (const [name, bot] of [['pray', pray], ['dive', dive]] as const) {
      const { result, calls } = await refusedRun(crawlerInput(piece, play, [bot]));
      refusedBeforeAnyRun(`a playtest whose ${Object.keys(bot)[0]} names ${name}`, name, result, calls);
    }
    // The same bots naming the interface's own actions are played and counted.
    const { pool, hub } = await hubOnce();
    const before = pool.log.length;
    const contrast = await runPlaytest(hub, crawlerInput(piece, play, [DESCENDER, WAITING], { runs: 1 }));
    expect(contrast.testsRun, `the descender and the waiting policy naming descend and wait are played and counted: ${shown(contrast)}`).toBe(2);
    const runs = pool.log.slice(before).filter((p) => p.call['bot'] && p.call['seed'] === runSeed(SEED, 0) && !ranNoStep(p)).map((p) => kindOf(p.call['bot']));
    expect(runs.sort(), 'the descender\'s and the waiting policy\'s run 0 each played steps in a replica').toEqual(['descender', 'policy']);
  }, TIMEOUT);
});

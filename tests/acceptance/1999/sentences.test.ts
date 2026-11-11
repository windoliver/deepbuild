// AC1 on the shipped hub: one world (README, The world), read as the change's page reads it, `changes.read`, once the
// session stopped and again after the hub restarted on the same record. One test per kind the criterion names (a
// change, a verdict, an open item), each judged by helpers.ts, and one for "with no model call".
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AC1, buildWorld, changeFailures, cleanup, MIN, missingSentences, modelCalls, openItemFailures, verdictFailures, type World } from './helpers.ts';

let world: World | undefined;
let failure: unknown;
const got = (): World => { if (failure) throw failure; return world!; };

beforeAll(async () => {
  try { world = await buildWorld({ restart: true }); } catch (error) { failure = error; }
}, 15 * MIN);
afterAll(cleanup, MIN);

describe(`${AC1} Every change, verdict and open item shows its one plain sentence, from the template, with no model call`, () => {
  it(`${AC1} a change shows one plain sentence that names the file it wrote, holds none of the agent's words, and reads the same after the hub restarts`, () => {
    expect(changeFailures(got())).toEqual([]);
  });

  it(`${AC1} each verdict shows one plain sentence with its state's word (sent back, then PASS), none of the agent's words, the same after the hub restarts`, () => {
    expect(verdictFailures(got())).toEqual([]);
  });

  it(`${AC1} an open item shows one plain sentence saying what is open in the item's words, none of the agent's last words, the same after the hub restarts`, () => {
    expect(openItemFailures(got())).toEqual([]);
  });

  it(`${AC1} the sentences were made, and the agents' CLIs on PATH saw no headless model call from the hub's start to the last read`, () => {
    const w = got();
    expect(missingSentences(w), 'every kind shows a sentence, so "no model call" is said of sentences that were made').toEqual([]);
    expect(modelCalls(w)).toEqual([]);
  });
});

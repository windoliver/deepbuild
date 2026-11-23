// #2695.f70c83fe: "With the proofs' file missing or unreadable, every guard still holds: the hook matches as before, and
// `deep doctor` shows one item naming the file. A planted hook that turns its guards off when that file is missing
// fails, naming the call"
//
// A home after `deep setup`, its hub then stopped by PID, and the proofs' file removed ("missing") or made mode 000
// ("unreadable"). "As before" is how the merge base's deep-hook, which never reads that file, matches every planted
// call and twin on the same home. The hook tests pass on the merge base; their planted hook is
// twins/guards-off-without-proofs. The doctor tests fail on the merge base, whose doctor names no such file.
import { chmodSync, existsSync, rmSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AC5, PROOFS, buildBase, buildHook, cleanup, differences, doctorItems, makeHome, matchAll, proofsPath, provedCalls, setup, stopHub, type Home, type Matched } from './helpers.ts';

const T = 1_800_000;
beforeAll(() => buildHook(), 1_900_000);
afterAll(cleanup);

type State = 'missing' | 'unreadable';
const homes = new Map<State, Promise<{ h: Home; want: Map<string, Matched> }>>();
/** One home per state, shared by its hook test and its doctor test: set up, hub stopped, the merge base's matching read, then spoiled. */
function spoiled(state: State) {
  let made = homes.get(state);
  if (!made) {
    made = (async () => {
      const base = await buildBase();
      const h = makeHome();
      await stopHub(await setup(h));
      const want = await matchAll(base, h, provedCalls());
      if (state === 'missing') rmSync(proofsPath(h), { force: true });
      else if (existsSync(proofsPath(h))) chmodSync(proofsPath(h), 0o000);
      return { h, want };
    })();
    homes.set(state, made);
  }
  return made;
}

for (const state of ['missing', 'unreadable'] as const) {
  test(`${AC5} with ${PROOFS} ${state}, deep-hook matches every planted call and twin as before`, async () => {
    const binary = await buildHook();
    const { h, want } = await spoiled(state);
    const got = await matchAll(binary, h, provedCalls());
    expect(differences(want, got), `with ~/.deepbuild/${PROOFS} ${state} and no hub answering, every guard must still hold: deep-hook must decide and match each planted call and twin as the merge base's deep-hook does on this home (the calls that differ)`).toEqual([]);
  }, T);

  test(`${AC5} with ${PROOFS} ${state}, deep doctor shows one item naming it`, async () => {
    const { h } = await spoiled(state);
    const { items } = await doctorItems(h);
    const naming = items.filter((i) => JSON.stringify(i).includes(PROOFS));
    expect(naming.map((i) => `${String(i.item)}: ${String(i.level)}`), `with ~/.deepbuild/${PROOFS} ${state}, deep doctor --json must show one item naming ${PROOFS}; its items: ${items.map((i) => `${String(i.item)} (${String(i.level)})`).join(', ')}`).toHaveLength(1);
    expect(String(naming[0]!.level), `the item naming ${PROOFS} must say it needs you (warn or fail): ${JSON.stringify(naming[0])}`).toMatch(/^(?:warn|fail)$/);
  }, T);
}

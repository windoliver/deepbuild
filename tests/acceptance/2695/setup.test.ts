// #2695.5cc60b5e: "After `deep setup` with the shipped entries, `rules.json` holds no proof and the proofs' file holds
// all 31, each equal to what the merge base wrote. On the merge base `rules.json` holds them, and the test fails,
// naming the key"
//
// The real `deep setup` in a temp HOME (README: The surface). "What the merge base wrote" is the merge base's
// default-rules.json proofs, which its setup writes into rules.json verbatim (setup.ts installRules at BASE).
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AC1, PROOFS, baseProofs, buildHook, canonical, cleanup, makeHome, proofKeys, proofsHeld, proofsPath, readJson, rulesPath, setup, sleep } from './helpers.ts';

const T = 1_200_000;
beforeAll(() => buildHook(), 1_900_000);
afterAll(cleanup);

test(`${AC1} after deep setup, rules.json holds no proof and ${PROOFS} holds all 31, each equal to the merge base's`, async () => {
  const want = baseProofs();
  if (Object.keys(want).length !== 31) throw Error(`BLOCKED: the merge base's default-rules.json holds ${Object.keys(want).length} proofs, not the issue's 31`);
  const h = makeHome();
  await setup(h);
  // Setup has returned and its hub answers; the hub's own first writes get 15 s to land.
  const settled = () => {
    const rules = readJson(rulesPath(h));
    const file = readJson(proofsPath(h));
    return rules !== undefined && proofKeys(rules).length === 0 && file !== undefined && Object.keys(want).every((n) => canonical(proofsHeld(file)[n]) === canonical(want[n]));
  };
  for (const deadline = Date.now() + 15_000; !settled() && Date.now() < deadline;) await sleep(250);

  const rules = readJson(rulesPath(h));
  expect(rules, 'after deep setup, ~/.deepbuild/rules.json must be JSON').toBeDefined();
  expect(proofKeys(rules), 'after deep setup, rules.json must hold no proof: no `proofs` key and no planted call or twin (the keys holding one)').toEqual([]);
  const file = readJson(proofsPath(h));
  expect(file, `after deep setup, ~/.deepbuild/${PROOFS} must be JSON holding the proofs`).toBeDefined();
  const held = proofsHeld(file!);
  expect(Object.keys(held).sort(), `${PROOFS} must hold the proof of each of the merge base's 31 entries, and no other`).toEqual(Object.keys(want).sort());
  expect(Object.keys(want).filter((n) => canonical(held[n]) !== canonical(want[n])), `each proof in ${PROOFS} must equal the merge base's (the entries whose proof differs)`).toEqual([]);
}, T);

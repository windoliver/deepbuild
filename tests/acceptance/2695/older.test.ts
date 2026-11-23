// #2695.af072e8f: "A home whose `rules.json` still holds proofs, as an older hub wrote it, matches every call as the
// merge base does, and after the next install the proofs are in their own file and none is lost"
//
// The home holds the merge base's default-rules.json verbatim as rules.json (helpers.ts, olderHome). Matching passes on
// the merge base ("as the merge base does"); its wrong program is twins/old-rules-refused. The install fails on the
// merge base, which keeps the proofs in rules.json.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AC4, PROOFS, bash, baseProofs, baseRules, buildBase, buildHook, canonical, cleanup, differences, guardAdd, guardFile, matchAll, olderHome, proofKeys, proofsHeld, proofsPath, provedCalls, readJson, rulesPath, shown, startHub, testEntry } from './helpers.ts';

const T = 1_800_000;
beforeAll(() => buildHook(), 1_900_000);
afterAll(cleanup);

test(`${AC4} a home whose rules.json still holds the proofs matches every planted call and twin as the merge base's deep-hook does`, async () => {
  const binary = await buildHook();
  const base = await buildBase();
  const h = olderHome();
  const calls = provedCalls();
  const want = await matchAll(base, h, calls);
  const got = await matchAll(binary, h, calls);
  expect(differences(want, got), `with rules.json as the merge base wrote it (proofs in it) and no hub answering, deep-hook must decide and match each of the ${calls.length} planted calls and twins as the merge base's deep-hook does (the calls that differ)`).toEqual([]);
}, T);

test(`${AC4} after the next install, the proofs are in ${PROOFS}, none lost, and rules.json holds none`, async () => {
  const h = olderHome();
  await startHub(h);
  const name = 'frob-2695-next';
  const proof = { planted: bash('frob2695c --all'), twin: bash('echo frob2695c') };
  const r = await guardAdd(h, guardFile({ [name]: testEntry(name, 'run:frob2695c') }, { [name]: proof }));
  expect(r.code, `the next install (deep guard add of ${name}, a whole entry) must install it: ${shown(r)}`).toBe(0);
  const rules = readJson(rulesPath(h));
  expect(rules, 'after the install, rules.json must be JSON').toBeDefined();
  expect(proofKeys(rules), 'after the next install, rules.json must hold no proof: no `proofs` key and no planted call or twin (the keys holding one)').toEqual([]);
  expect([...Object.keys(baseRules().entries), name].filter((n) => !(n in (rules!.entries ?? {}))), 'after the install, rules.json must still hold every entry (the entries missing)').toEqual([]);
  const file = readJson(proofsPath(h));
  expect(file, `after the next install, ~/.deepbuild/${PROOFS} must be JSON holding the proofs`).toBeDefined();
  const held = proofsHeld(file!);
  const want: Record<string, unknown> = { ...baseProofs(), [name]: proof };
  expect(Object.keys(want).filter((n) => canonical(held[n]) !== canonical(want[n])), `${PROOFS} must hold every proof rules.json held and the new entry's, each as it was (the proofs lost or changed)`).toEqual([]);
}, T);

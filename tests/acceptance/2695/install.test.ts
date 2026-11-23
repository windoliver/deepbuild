// #2695.d791b61b: "Installing an entry with no planted call, and one whose twin it denies, are each refused as today,
// naming the entry. A planted install that checks no proof once they have moved fails, naming the entry"
//
// `deep guard add` against the hub `deep setup` started, in a temp HOME. Both refusals pass on the merge base ("as
// today"); the planted install is twins/installs-without-proofs (twins/README.md), on which each test fails at its
// first assertion, naming the entry.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AC3, bash, buildHook, cleanup, guardAdd, guardFile, makeHome, readJson, rulesPath, setup, shown, testEntry, type Hub } from './helpers.ts';

const T = 1_200_000;
beforeAll(() => buildHook(), 1_900_000);
afterAll(cleanup);

let ready: Promise<Hub> | undefined;
/**
 * One home after `deep setup`, shared by both tests (a refusal changes nothing). The control: an entry with a planted
 * call its match denies and a twin it allows installs, so `deep guard add` works here and a refusal is the entry's.
 */
const home = () => (ready ??= (async () => {
  const hub = await setup(makeHome());
  const name = 'frob-2695-control';
  const r = await guardAdd(hub.home, guardFile({ [name]: testEntry(name, 'run:frob2695ok') }, { [name]: { planted: bash('frob2695ok --all'), twin: bash('echo frob2695ok') } }));
  if (r.code !== 0) throw Error(`BLOCKED: control: deep guard add of a whole entry must install it: ${shown(r)}`);
  return hub;
})());

const installed = (hub: Hub) => Object.keys(readJson(rulesPath(hub.home))?.entries ?? {});

test(`${AC3} installing an entry with no planted call is refused, naming the entry`, async () => {
  const hub = await home();
  const name = 'frob-2695-no-planted';
  const r = await guardAdd(hub.home, guardFile({ [name]: testEntry(name, 'run:frob2695a') }, { [name]: { twin: bash('echo frob2695a') } }));
  expect(r.code, `deep guard add of ${name}, which ships a twin and no planted call, must be refused (exit 1): ${shown(r)}`).toBe(1);
  expect(`${r.stdout}\n${r.stderr}`, `the refusal must name the entry ${name}`).toContain(name);
  expect(installed(hub), `the refused entry ${name} must not be in rules.json`).not.toContain(name);
}, T);

test(`${AC3} installing an entry whose twin it denies is refused, naming the entry`, async () => {
  const hub = await home();
  const name = 'frob-2695-twin-denied';
  const r = await guardAdd(hub.home, guardFile({ [name]: testEntry(name, 'run:frob2695b') }, { [name]: { planted: bash('frob2695b --all'), twin: bash('frob2695b --dry-run') } }));
  expect(r.code, `deep guard add of ${name}, whose twin \`frob2695b --dry-run\` its match run:frob2695b denies, must be refused (exit 1): ${shown(r)}`).toBe(1);
  expect(`${r.stdout}\n${r.stderr}`, `the refusal must name the entry ${name}`).toContain(name);
  expect(installed(hub), `the refused entry ${name} must not be in rules.json`).not.toContain(name);
}, T);

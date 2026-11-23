// AC7 #280.9c96115f: deep_kinds lists net.feel's fields and defaults in a build with the net module and marks it
// unavailable with module_missing in one without; deep_run runs it on the eight-seat fixture; and net.rollback with
// players 8 passes on that fixture with messages held back up to the window
//
// deep_kinds is #412's `deep_kinds` call of `deep-show run` (`op: "list"`, `registry: "kind@1"`, paged), in the `full`
// build, which holds the net module, and the `core` build, which holds neither logic nor net. net@1's entry lists its
// check kinds as `check_kinds` (#550's suite); net.feel is listed there as `{kind: "net.feel", fields}` (README:
// deep_kinds), each field `{name, default?}`: `players`, `steps` (default 3,600), `profile`, `seed`, `items` and
// `bounds`. In `core`, net.feel is listed, unavailable with module_missing. deep_run's check kind is a claim's verdict
// (`{call: "verdict", claim}`, as #550's and #1939's suites read deep_run's checks): the agent's claim on the eight-seat
// fixture, its one requirement net.feel `{steps: 600, profile, seed, items, bounds}`, whose row reads PASS with
// net.feel's readings for the eight copies in its `results`. net.rollback is `match`'s check on the eight-seat fixture,
// eight copies, with no schedule given, so it plays its own: 8 seeded ones that hold each message back by up to the
// window of 8, and one that holds every message exactly 8 steps (#551's `schedules`). Wrong programs it fails: the merge
// base (net.feel isn't listed or run); a listing without net.feel's fields or defaults, or one that lists it available
// without the net module; a net.feel deep_run can't reach; a rollback that parts from the on-time run with eight copies.
import { describe, expect, it } from 'vitest';
import { QUIET, SEATS, WINDOW, eightDoc, feel, seededMoves, type JsonObject, type JsonValue } from './fixtures.ts';
import {
  AC, CORE, FULL, Script, TIMEOUT, isObject, kindsEntries, none, putProgram, runShow, scenario, show, useBuilds, useChildren, useTemp, verdictRow,
} from './helpers.ts';
import { checkOf, copiesOf } from '../551/helpers.ts';

const builds = useBuilds({ show: [FULL, CORE] });
useChildren();
const temp = useTemp();

/** net.feel's fields (the Fields line), and the default the design gives `steps`. */
const FIELDS = ['players', 'steps', 'profile', 'seed', 'items', 'bounds'];
const STEPS_DEFAULT = 3600;
const kindName = (k: JsonValue): string => (isObject(k) ? String(k['kind'] ?? k['name'] ?? '') : String(k));
/** net@1's entry and its net.feel listing, in one build's kind@1 entries. */
function listed(entries: JsonObject[]): { net: JsonObject | undefined; feel: JsonValue | undefined } {
  const net = entries.find((e) => e['name'] === 'net@1');
  const kinds = net && Array.isArray(net['check_kinds']) ? net['check_kinds'] : [];
  return { net, feel: kinds.find((k) => kindName(k) === 'net.feel') };
}
/** A listing's fields by name: `fields: [{name, …}]` or `fields: {name → {…}}`. */
function fieldsOf(feelEntry: JsonObject): Map<string, JsonObject> {
  const f = feelEntry['fields'];
  if (Array.isArray(f)) return new Map(f.filter(isObject).map((x) => [String(x['name']), x]));
  if (isObject(f)) return new Map(Object.entries(f).map(([k, v]) => [k, isObject(v) ? v : {}]));
  return new Map();
}

describe(`${AC[7]} net.feel in the tools, and net.rollback with eight players`, () => {
  it(`${AC[7]} deep_kinds lists net.feel's fields and defaults in a build with the net module and marks it unavailable with module_missing in one without`, async () => {
    const f: string[] = [];
    const full = listed(await kindsEntries(builds.show(FULL), temp(), 'kind@1', 'AC7 the full build'));
    if (!full.net) f.push('AC7: the full build\'s deep_kinds lists no net@1');
    else if (!isObject(full.feel)) f.push(`AC7: net@1's check_kinds in the full build list no net.feel with its fields: ${show(full.net['check_kinds'] ?? null, 800)}`);
    else {
      const fields = fieldsOf(full.feel);
      for (const name of FIELDS) if (!fields.has(name)) f.push(`AC7: net.feel lists no field ${name}; its fields are ${[...fields.keys()].join(', ')}`);
      if (fields.get('steps')?.['default'] !== STEPS_DEFAULT) f.push(`AC7: net.feel's steps defaults to ${show(fields.get('steps')?.['default'] ?? null)}, not 3,600`);
      if (full.feel['available'] === false) f.push('AC7: the full build lists net.feel as unavailable');
    }
    const core = listed(await kindsEntries(builds.show(CORE), temp(), 'kind@1', 'AC7 the core build'));
    if (core.feel === undefined) f.push(`AC7: the core build, which holds no net module, doesn't list net.feel: ${show(core.net ?? null, 800)}`);
    else {
      const own = isObject(core.feel) && ('available' in core.feel || 'code' in core.feel) ? core.feel : core.net!;
      if (own['available'] !== false || own['code'] !== 'module_missing') f.push(`AC7: the core build lists net.feel as available ${String(own['available'])} with code ${String(own['code'])}, not unavailable with module_missing`);
    }
    none(f, 'deep_kinds lists net.feel\'s fields and defaults where the net module is, and marks it missing where it isn\'t');
  }, TIMEOUT);

  it(`${AC[7]} net.rollback with players 8 passes on the eight-seat fixture with messages held back up to the window, and deep_run runs net.feel on it`, async () => {
    const f: string[] = [];
    // net.rollback, `match`'s check, eight copies, its own schedules.
    const evidence = temp();
    putProgram(evidence);
    const document = eightDoc();
    const doc = String(document['id']);
    const s = new Script();
    s.present(doc, document);
    const m = s.add({ call: 'match', doc, steps: 600, plays: seededMoves(600) as unknown as JsonObject, relay: { seed: 280 }, check: 'net.rollback' });
    const r = await runShow(builds.show(FULL), scenario(evidence, [doc], s.calls), 'AC7 net.rollback with players 8');
    expect(copiesOf(r[m], SEATS, 'AC7 net.rollback').length, 'eight copies').toBe(SEATS);
    const rollback = checkOf(r[m], 'AC7 net.rollback');
    if (rollback.verdict !== 'PASS') f.push(`AC7: net.rollback with players 8 reads ${rollback.verdict}, not PASS: ${show(rollback.failures, 1200)}`);
    const schedules = Array.isArray(rollback.raw['schedules']) ? rollback.raw['schedules'].filter(isObject) : [];
    const upTo = schedules.filter((x) => x['up_to'] === WINDOW);
    if (upTo.length < 8 || !schedules.some((x) => x['exactly'] === WINDOW)) f.push(`AC7: net.rollback's schedules aren't 8 that hold messages back by up to the window of ${WINDOW} and one exactly ${WINDOW}: ${show(schedules, 900)}`);
    if (!schedules.some((x) => Array.isArray(x['rollbacks']) && x['rollbacks'].some((n) => typeof n === 'number' && n > 0))) f.push(`AC7: no held-back run rolled any copy back: ${show(schedules, 900)}`);
    // deep_run: net.feel as a claim's requirement on the eight-seat fixture.
    const check = { kind: 'net.feel', steps: 600, ...feel(QUIET, { bounds: { stall: 1000 } }) } as unknown as JsonObject;
    const row = await verdictRow(builds.show(FULL), temp(), document, check, 'AC7 deep_run net.feel');
    if (row['result'] !== 'PASS') f.push(`AC7: deep_run's net.feel on the eight-seat fixture reads ${String(row['result'])}, not PASS: ${show(row, 1500)}`);
    const results = (Array.isArray(row['results']) ? row['results'] : []).filter(isObject);
    const readings = results.map((x) => x['readings']).find((x) => Array.isArray(x));
    if (!Array.isArray(readings) || readings.length !== SEATS) f.push(`AC7: deep_run's net.feel row returns no readings for the eight copies (results: [{readings}]): ${show(row, 1500)}`);
    none(f, 'net.rollback passes with eight players, and deep_run runs net.feel on the eight-seat fixture');
  }, TIMEOUT);
});

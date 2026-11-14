// AC4 #213.f2c2a3f9: "A pack that declares a service is refused, naming the registry's fill, and so is a plug-in that
// tries to register one; and physics.cast@1's conformance fixture fails a planted implementation that sorts hits by ID
// before distance, naming the request"
//
// Through `deep-show run` (#200's and #412's surfaces): a pack folder whose pack.json declares a logic.service@1 entry,
// installed through the scenario's `packs`, read through `packs`; a plug-in's entry through the scenario's
// `plugin_entries`, read through #412's `deep_kinds` list, which keeps listing every plug-in entry (#412 AC8) and lists
// this one unavailable with this suite's `refused` naming the registry's fill (README); physics.cast@1 in the full
// set's listing with its kit result, and the build `test-cast-sorts-by-id`, whose physics module's service sorts each
// request's hits by ID before distance, refused at the seal by the entry's conformance fixture: #200's refusal line,
// its `rules` naming the fixture's rule and this suite's `request` the request whose hits came back out of order.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CRITERIA, DOC, TIMEOUT, arr, binOf, isObject, mentions, none, obj, runShow, scenario, show, startShow, useBuilds, useTemp,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = CRITERIA[4];
useBuilds(['show', 'show-sorts-by-id']);
const temp = useTemp();

const REGISTRY = 'logic.service@1';
/** A service entry as a canvas module would fill it, with the fields the registry's entry schema has had (README). */
const service = (name: string): JsonObject => ({
  name, request: { fields: [{ name: 'at', type: 'vec3' }] }, result: { fields: [{ name: 'distance', type: 'f64' }] },
  max_per_step: 8, fuel_per_request: 100, answers_from: 'step', fixture: [{ ask: 'nearest', at: 3 }],
});
const PACK = { id: 'test/castpack', version: '1.0.0' };
const PLUGIN_ENTRY = 'test.caster.peek@1';

function registryRow(reply: JsonObject | undefined, what: string): JsonObject {
  const list = arr(reply?.['registries'], `${what}: registries`).filter(isObject);
  const row = list.find((r) => r['kind'] === 'registry' && r['name'] === REGISTRY);
  expect(row, `${what} lists ${REGISTRY}; it lists ${list.map((r) => String(r['name'])).join(', ')}`).toBeDefined();
  return row!;
}
const entriesOf = (row: JsonObject, what: string): JsonObject[] => arr(row['entries'], `${what}: ${REGISTRY}.entries`).filter(isObject);

describe(`${ID} only first-party canvas modules fill logic.service@1, and physics.cast@1's fixture catches a wrong sort`, () => {
  it(`${ID} a pack that declares a logic.service@1 entry is refused at its pack check naming the registry and its fill (module), and a plug-in's entry is listed unavailable with a refusal naming the same`, () => {
    const evidence = temp();
    const dir = join(temp(), 'castpack-1.0.0');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pack.json'), `${JSON.stringify({
      name: 'castpack', version: PACK.version, license: 'MIT',
      description: 'A test pack of the #213 acceptance suite that declares a logic.service@1 entry, which only canvas modules fill.',
      requires: { core: '>=0.0.0', modules: {} }, entries: { [REGISTRY]: [service('castpack.peek@1')] },
    }, null, 2)}\n`);
    const plugin: JsonObject = { plugin: 'test.caster', registry: REGISTRY, entry: service(PLUGIN_ENTRY), kit: { verdict: 'PASS', rules: [] } };
    const [packs, kinds] = runShow(binOf('show'), scenario(evidence, [DOC(41)], [{ call: 'packs' }, { call: 'deep_kinds', op: 'list', registry: REGISTRY }], { packs: [{ id: PACK.id, dir }], plugin_entries: [plugin] }), 'the pack and the plug-in');

    const rows = arr(packs!['packs'], 'packs: packs').filter(isObject).filter((r) => r['pack'] === PACK.id && r['version'] === PACK.version);
    expect(rows.length, `the packs reply has one row for ${PACK.id}@${PACK.version}: ${show(packs)}`).toBe(1);
    const row = rows[0]!;
    const fails: string[] = [];
    if ((row['state'] ?? row['outcome']) !== 'refused') fails.push(`${PACK.id} was ${String(row['state'] ?? row['outcome'])} at its pack check, not refused`);
    const errors = arr(row['issues'] ?? [], 'the pack row\'s issues').filter((i) => isObject(i) && (i['severity'] === 'error' || i['severity'] === undefined));
    for (const name of [REGISTRY, 'module']) if (!errors.some((i) => mentions(i, name))) fails.push(`the pack's refusal names no ${name}: ${show(row['issues'])}`);

    expect(kinds?.['error'], `deep_kinds lists ${REGISTRY}: ${show(kinds)}`).toBeUndefined();
    const listed = entriesOf(registryRow(kinds, 'deep_kinds list'), 'deep_kinds list');
    const plug = listed.find((e) => e['name'] === PLUGIN_ENTRY);
    if (!plug) fails.push(`${REGISTRY} doesn't list the plug-in's entry ${PLUGIN_ENTRY}, as #412 lists every plug-in entry: ${show(listed as JsonValue)}`);
    else {
      if (plug['origin'] !== 'plugin' || plug['available'] !== false) fails.push(`${PLUGIN_ENTRY} is listed ${show(plug['origin'])}, available ${show(plug['available'])}, not a plug-in's entry listed unavailable`);
      const refused = plug['refused'];
      if (!isObject(refused) || !mentions(refused, REGISTRY) || !mentions(refused, 'module')) fails.push(`${PLUGIN_ENTRY}'s refusal (README: refused) names no ${REGISTRY} and its fill, module: ${show(refused)}`);
    }
    none(fails, 'a service from a pack or a plug-in');
  }, TIMEOUT);

  it(`${ID} physics.cast@1 is the physics module's first-party entry and passes its kit; the build whose service sorts hits by ID before distance is refused at the seal by its conformance fixture, naming the request`, () => {
    const regs = runShow(binOf('show'), scenario(temp(), [DOC(42)], [{ call: 'registries' }]), 'the full set')[0];
    const cast = entriesOf(registryRow(regs, 'the full set'), 'the full set').find((e) => e['name'] === 'physics.cast@1');
    expect(cast, `the full set's ${REGISTRY} holds physics.cast@1`).toBeDefined();
    const value = obj(cast!['value'], 'physics.cast@1.value');
    expect({ module: cast!['module'], origin: cast!['origin'], kit: obj(cast!['kit'], 'physics.cast@1.kit')['verdict'], max_per_step: value['max_per_step'], fuel_per_request: value['fuel_per_request'] },
      `physics.cast@1 is the physics module's, passes its kit, at most 256 a step for 4,000 fuel each: ${show(cast)}`)
      .toEqual({ module: 'physics', origin: 'first_party', kit: 'PASS', max_per_step: 256, fuel_per_request: 4000 });

    const s = startShow(binOf('show-sorts-by-id'), scenario(temp(), [DOC(43)], [{ call: 'registry' }]));
    expect(s.status, `the build with the planted sort is refused at its seal (exit 2); stdout: ${s.stdout.slice(0, 800)}; stderr: ${s.stderr.slice(-800)}`).toBe(2);
    expect(s.lines.length, `the refusal is one line: ${s.stdout.slice(0, 800)}`).toBe(1);
    const r = obj(s.lines[0], 'the seal\'s refusal');
    expect({ ok: r['ok'], code: r['code'], reason: r['reason'], registry: r['registry'] }, `the seal refuses the entry in ${REGISTRY}: ${show(r)}`)
      .toEqual({ ok: false, code: 'seal_refused', reason: 'entry_refused', registry: REGISTRY });
    expect(mentions(r['entries'], 'physics.cast@1'), `the refusal names physics.cast@1: ${show(r)}`).toBe(true);
    expect(Array.isArray(r['rules']) && r['rules'].length > 0, `the refusal names the kit rule the fixture holds it to: ${show(r)}`).toBe(true);
    expect(Number.isSafeInteger(r['request']) && (r['request'] as number) >= 0, `the refusal names the fixture's request whose hits come back out of order (its index, README): ${show(r)}`).toBe(true);
  }, TIMEOUT);
});

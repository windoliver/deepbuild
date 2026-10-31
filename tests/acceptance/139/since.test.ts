// AC5 and AC6 (#139): `since` on every entry of the published contract, `replaced_by` on every replaced one, and a
// contract step that covers hub slots and canvas registries as well as the six kinds of entry the design lists first.
// A history annotation on a schema is `x-since`, `x-deprecated_since`, `x-replaced_by`, `x-stability`, `x-tracking`;
// on an API method, a hub-slot row, a canvas registry or a JSON-RPC method it is the field of that name (README).
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addSchema, at, check, edit, expectFailNaming, expectPass, fork, readJson, record, REGISTRIES_FILE, REPO, scratch, shown, SLOTS_FILE, schemaFile, writeJson, type StepPlant, type Tree,
} from './helpers.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

describe('#139.075d6d53 every entry in the published schemas has since, and every replaced entry names what replaced it; a missing field fails the contract test', () => {
  it('AC5 every published schema in packages/contracts/schemas carries x-since, and each one with x-deprecated_since names x-replaced_by', () => {
    const dir = join(REPO, 'packages/contracts/schemas');
    const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    const missing = files.filter((f) => typeof readJson(join(dir, f))['x-since'] !== 'string');
    expect(missing, `${missing.length} of ${files.length} published schemas have no x-since (first: ${missing.slice(0, 5).join(', ')})`).toEqual([]);
    const unreplaced = files.filter((f) => { const s = readJson(join(dir, f)); return 'x-deprecated_since' in s && typeof s['x-replaced_by'] !== 'string'; });
    expect(unreplaced, 'a deprecated schema names x-replaced_by').toEqual([]);
  });

  it('AC5 the contract step passes the repo\'s own contracts', () => {
    expectPass(check({ root: REPO } as Tree, 'R1'), 'the repo\'s published contracts');
  }, 300_000);

  it('AC5 a schema with no x-since fails the contract test, naming the schema and since; an API method with no since does too', () => {
    const t = scratch();
    record(t, 'R1');
    const a = fork(t);
    edit(a, schemaFile('check@1'), (s) => { delete s['x-since']; });
    expectFailNaming(check(a, 'R2'), 'a schema with no since', 'check@1', 'since');
    const b = fork(t);
    edit(b, 'packages/contracts/extension-api.json', (api) => { delete api.find((e: { method: string }) => e.method === 'deep.on').since; });
    expectFailNaming(check(b, 'R2'), 'an API method with no since', 'deep.on', 'since');
  }, 180_000);

  it('AC5 a replaced entry that names nothing as its replacement fails, naming the entry and replaced_by; naming an entry that exists passes', () => {
    const t = scratch();
    addSchema(t, 'sparkle@1');
    record(t, 'R1');
    const bare = fork(t);
    edit(bare, schemaFile('sparkle@1'), (s) => { s['x-deprecated_since'] = 'R2'; });
    expectFailNaming(check(bare, 'R2'), 'a replaced schema with no replaced_by', 'sparkle@1', 'replaced_by');
    const named = fork(t);
    addSchema(named, 'sparkle@2', undefined, { since: 'R2' });
    edit(named, schemaFile('sparkle@1'), (s) => { s['x-deprecated_since'] = 'R2'; s['x-replaced_by'] = 'sparkle@2'; });
    expectPass(check(named, 'R2'), 'a replaced schema that names its replacement');
    const api = fork(t);
    edit(api, 'packages/contracts/extension-api.json', (e) => { e.find((x: { method: string }) => x.method === 'deep.on').deprecated_since = 'R2'; });
    expectFailNaming(check(api, 'R2'), 'a replaced API method with no replaced_by', 'deep.on', 'replaced_by');
  }, 180_000);
});

// ---- AC6: a hub slot and a canvas registry, each published without since.
/** The tree's canvas registries file: the repo's, or two rows of this suite's own when the repo publishes none. */
function withRegistries(t: Tree): void {
  if (!existsSync(at(t, REGISTRIES_FILE))) writeJson(at(t, REGISTRIES_FILE), [{ registry: 'kinds', since: 'R1', stability: 'stable' }, { registry: 'columns', since: 'R1', stability: 'stable' }]);
}
/** Publishes one slot (or registry) without since and runs the step: throws what the criterion names when the step passes it. */
function withoutSince(what: 'slot' | 'registry', plant?: StepPlant): void {
  const t = scratch();
  withRegistries(t);
  record(t, 'R1');
  let name = '';
  if (what === 'slot') edit(t, SLOTS_FILE, (rows) => { name = rows[0].method; delete rows[0].since; });
  else edit(t, REGISTRIES_FILE, (rows) => { name = rows[0].registry; delete rows[0].since; });
  const r = check(t, 'R2', { plant });
  if (r.code === 0) throw Error(`a contract step that covers only API methods, JSON-RPC methods, MCP tools, event kinds, document kinds and sidecar formats passed the hub ${what} ${name} published without since: ${shown(r)}`);
  expectFailNaming(r, `a ${what} published without since`, name, 'since');
}

describe('#139.3d203a4b a hub slot and a canvas registry each published without since fail the contract test, naming them', () => {
  it('AC6 a hub-slot row with no since fails, naming the slot', () => {
    withoutSince('slot');
  }, 180_000);

  it('AC6 a canvas registry with no since fails, naming the registry', () => {
    withoutSince('registry');
  }, 180_000);

  it('AC6 (wrong program) a step that covers only the six kinds passes the hub slot, and this test fails it', () => {
    expect(() => withoutSince('slot', 'six-kinds-only')).toThrow(/a contract step that covers only API methods, JSON-RPC methods, MCP tools, event kinds, document kinds and sidecar formats passed the hub slot/);
  }, 180_000);

  it('AC6 (wrong program) the same step passes the canvas registry, and this test fails it', () => {
    expect(() => withoutSince('registry', 'six-kinds-only')).toThrow(/passed the hub registry/);
  }, 180_000);
});

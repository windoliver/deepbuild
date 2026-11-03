// AC16: "Two dumps of one digest are byte-identical; between fixture digests A and B, where B's ring@2 renames thick
// to stroke_width, retires dash and changes segments' default from 32 to 64, the diff lists exactly those 3 changes
// and nothing else; a planted dump that writes fields as an object keyed by name fails the schema, naming the path;
// and a planted diff that infers renames by spelling reports thick removed and stroke_width added, and fails, naming
// thick"
//
// asserts: `deep-show kinds --dump <dir>` (what `deep kinds --dump` runs) writes <dir>/<module-set hex>.json; two
// dumps of `core,test-ring-a` in two processes are byte-identical, canonical JSON (RFC 8785, as
// @deepbuild/contracts writes it), valid against packages/contracts/canvas-schemas/kinds.dump@1.json, and hold
// ring@1 with its fields as an ordered array (thick, dash, segments with default 32), each with its type, unit,
// range and list; `core,test-ring-b`'s dump holds ring@2 with stroke_width and segments at default 64 and neither
// thick nor dash. `deep-show kinds --diff <A> <B>` lists exactly 3 changes: thick renamed to stroke_width, dash
// retired, segments' default 32 → 64. `--planted dump_fields_by_name` writes fields as an object keyed by name, and
// the schema fails it at a path ending in /fields; `--planted diff_by_spelling` reports thick removed and
// stroke_width added, and the diff check fails, naming thick.

import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { canonicalize, registry as schemaRegistry, type Schema } from '@deepbuild/contracts';
import { describe, expect, it } from 'vitest';
import {
  DIGEST, DUMP_SCHEMA, arr, diffFailures, failsNaming, isObject, kindsCommand, none, objectsNamed, readJson, show, str, tempDir, useBuilds, useTempDirs,
  type Build, type JsonObject, type JsonValue,
} from './helpers.ts';

useTempDirs();
const RING_A: Build = { set: 'core', with: ['test-ring-a'] };
const RING_B: Build = { set: 'core', with: ['test-ring-b'] };
const builds = useBuilds([RING_A, RING_B]);

interface Dump { path: string; module_set: string; bytes: Buffer; value: JsonValue }
function dump(build: Build, planted?: string): Dump {
  const dir = tempDir('dump');
  const out = kindsCommand(builds.bin(build), ['--dump', dir], planted);
  const path = str(out['path'], 'the dump\'s path');
  const moduleSet = str(out['module_set'], 'the dump\'s module-set digest');
  expect(moduleSet, 'a d1 digest').toMatch(DIGEST);
  expect(basename(path), 'the dump is named by its module-set digest').toBe(`${moduleSet.replace(/^d1:/, '')}.json`);
  expect(existsSync(path), `the dump is written at ${path}`).toBe(true);
  const bytes = readFileSync(path);
  return { path, module_set: moduleSet, bytes, value: JSON.parse(bytes.toString('utf8')) as JsonValue };
}
/** The dump held to its published JSON Schema; each failure names the path. */
function schemaFailures(value: JsonValue): string[] {
  expect(existsSync(DUMP_SCHEMA), `the dump's JSON Schema is published at ${DUMP_SCHEMA}`).toBe(true);
  const checked = schemaRegistry([{ name: 'kinds.dump@1', schema: readJson(DUMP_SCHEMA) as Schema }]).validate('kinds.dump@1', value);
  return checked.ok ? [] : checked.issues.map((i) => `${i.path}: ${i.code}`);
}
/** The one entry `name` in a dump, with its fields by name in order. */
function dumped(value: JsonValue, name: string): { fields: JsonObject[]; names: string[] } {
  const found = objectsNamed(value, name).filter((o) => 'fields' in o);
  expect(found.length, `the dump holds one entry ${name} with its fields`).toBe(1);
  const fields = arr(found[0]!['fields'], `${name}.fields (an ordered array)`).filter(isObject);
  return { fields, names: fields.map((f) => String(f['name'])) };
}

describe('AC16 a canonical dump named by its digest, and a diff that reads renames and retirements only from their records', () => {
  it('AC16 two dumps of one digest are byte-identical, canonical, valid against their schema, and hold each field as an ordered array element with its type, unit, range and list', () => {
    const a1 = dump(RING_A);
    const a2 = dump(RING_A);
    expect(a2.module_set, 'one digest').toBe(a1.module_set);
    expect(a1.bytes.equals(a2.bytes), 'two dumps of one digest are byte-identical').toBe(true);
    expect(Buffer.from(canonicalize(a1.value as Parameters<typeof canonicalize>[0])).equals(a1.bytes), 'the dump is canonical JSON').toBe(true);
    none(schemaFailures(a1.value), 'A\'s dump against its schema');
    const ring1 = dumped(a1.value, 'ring@1');
    expect(ring1.names, 'ring@1\'s fields in A').toEqual(expect.arrayContaining(['thick', 'dash', 'segments']));
    for (const f of ring1.fields) for (const k of ['type', 'unit', 'range', 'list']) expect(k in f, `ring@1/${String(f['name'])} lists its ${k}: ${show(f)}`).toBe(true);
    expect(ring1.fields.find((f) => f['name'] === 'segments')?.['default'], 'segments defaults to 32 in A').toBe(32);
    const b = dump(RING_B);
    expect(b.module_set, 'B is another digest').not.toBe(a1.module_set);
    none(schemaFailures(b.value), 'B\'s dump against its schema');
    const ring2 = dumped(b.value, 'ring@2');
    expect(ring2.names, 'ring@2 has stroke_width and segments').toEqual(expect.arrayContaining(['stroke_width', 'segments']));
    expect(ring2.names.filter((n) => n === 'thick' || n === 'dash'), 'ring@2 has neither thick nor dash').toEqual([]);
    expect(ring2.fields.find((f) => f['name'] === 'segments')?.['default'], 'segments defaults to 64 in B').toBe(64);
  }, 1_800_000);

  it('AC16 the diff between A and B lists exactly thick renamed to stroke_width, dash retired and segments\' default 32 → 64', () => {
    const a = dump(RING_A);
    const b = dump(RING_B);
    const out = kindsCommand(builds.bin(RING_B), ['--diff', a.path, b.path]);
    none(diffFailures(arr(out['changes'], 'the diff\'s changes')), 'the diff from A to B');
  }, 1_800_000);

  it('AC16 a planted dump that writes fields as an object keyed by name fails the schema, naming the path', () => {
    const planted = dump(RING_A, 'dump_fields_by_name');
    const ring1 = objectsNamed(planted.value, 'ring@1').find((o) => 'fields' in o);
    expect(isObject(ring1?.['fields']), `the planted dump keys ring@1's fields by name: ${show(ring1 ?? null)}`).toBe(true);
    const failures = schemaFailures(planted.value);
    failsNaming(failures, ['/fields'], 'the dump keyed by name');
    expect(failures.some((f) => /\/fields:/.test(f)), `a failure's path ends at fields: ${failures.join('; ').slice(0, 1500)}`).toBe(true);
  }, 1_800_000);

  it('AC16 a planted diff that infers renames by spelling reports thick removed and stroke_width added, and fails, naming thick', () => {
    const a = dump(RING_A);
    const b = dump(RING_B);
    const out = kindsCommand(builds.bin(RING_B), ['--diff', a.path, b.path], 'diff_by_spelling');
    const changes = arr(out['changes'], 'the planted diff\'s changes');
    const by = (field: string): string[] => changes.filter(isObject).filter((c) => c['field'] === field).map((c) => String(c['change']));
    expect([['removed'], ['retired']], `the planted diff reports thick removed: ${show(changes)}`).toContainEqual(by('thick'));
    expect(by('stroke_width'), `the planted diff reports stroke_width added: ${show(changes)}`).toEqual(['added']);
    failsNaming(diffFailures(changes), ['thick'], 'the diff by spelling');
  }, 1_800_000);
});

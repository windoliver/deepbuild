// AC4 #200.be794a42: "The closure lint: a test schema enum test_mode: a | b with no closure fails the local
// preflight, naming test_mode; with closed {reason: determinism, reopens_if: a third mode} it passes; an enum that
// names the registry test.mark@1 passes only while that registry is declared; and a planted row in the reference's
// table that calls the budget class a registry fails the drift test, naming the list and both closures"
//
// AC15 #200.81fef80c: "A closed canvas list marked extensible takes a new value in a minor, which a reader at the
// earlier minor maps to the list's `unknown`, and one marked exhaustive refuses a new value without a new major,
// naming the list; a closure without the mark fails the preflight, naming the list"
//
// asserts: `node scripts/canvas-closures.mjs closures --root <tree>` on a scratch tree whose only canvas schema is
// test.lists@1 FAILs naming test_mode when its enum has no x-closure, PASSes with {closed: determinism, reopens_if:
// "a third mode", mark: exhaustive}, and with {registry: test.mark@1} PASSes only while canvas-registries.json
// declares test.mark@1 (FAIL naming it otherwise); `canvas-closures.mjs drift --root <tree>` PASSes on a copy of
// the checkout's canvas reference and closure data and FAILs on the same copy with the Budget class row's closure
// cell planted as a registry, naming "Budget class", the table's closure and the data's; the lint lane of
// scripts/lanes.mjs runs both, and both pass on the checkout. AC15: the contract step (#139) covers canvas schemas:
// a member added in R3 to test_tone, closed and marked extensible with unknown, passes `contract-diff.mjs check`
// against R2, and a reader at R2 (the conformance package's `serveAt`, the one reader the design gives for an
// earlier minor) maps it to unknown; a member added to test_dir, marked exhaustive, fails the check naming test_dir;
// a closed closure with no mark fails the closure lint naming the list.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MARK, failLines, script, scratchTree, shown, useTempDirs, writeJson, type JsonObject, type JsonValue,
} from './helpers.ts';

useTempDirs();

const SCHEMA = 'packages/contracts/canvas-schemas/test.lists@1.json';
const REGISTRIES_FILE = 'packages/contracts/canvas-registries.json';
/** A canvas schema test.lists@1 holding the given list fields, published since R2 as stable. */
const lists = (props: Record<string, JsonObject>): JsonObject => ({
  type: 'object', properties: props, required: [], additionalProperties: false, 'x-since': 'R2', 'x-stability': 'stable',
});
const MODE_VALUES = ['a', 'b'];
const closedMode: JsonObject = { closed: 'determinism', reopens_if: 'a third mode', mark: 'exhaustive' };
/** test.mark@1 as canvas-registries.json declares it (the registry's contract row). */
const MARK_ROW: JsonObject = {
  registry: MARK, owner: 'test.mark', fill: ['module', 'pack'], resolve: 'seal', since: 'R2', stability: 'stable',
  entry: { type: 'object', properties: { name: { type: 'string' }, size: { type: 'integer', minimum: 0, maximum: 4294967295 } }, required: ['name', 'size'], additionalProperties: false },
};

/** A tree holding only test.lists@1 and, with `declared`, test.mark@1 among the declared registries. */
function lintTree(tag: string, mode: JsonObject, declared: boolean): string {
  const root = scratchTree(tag, { empty: true });
  writeJson(join(root, SCHEMA), lists({ test_mode: mode }));
  writeJson(join(root, REGISTRIES_FILE), declared ? [MARK_ROW] : []);
  return root;
}
const closures = (root: string) => script('canvas-closures.mjs', ['closures', '--root', root]);
const passes = (r: ReturnType<typeof script>, prefix: string, what: string): void => {
  expect(failLines(r, prefix), `${what}: no FAIL ${prefix} line\n${shown(r)}`).toEqual([]);
  expect(r.code, `${what}: exit 0\n${shown(r)}`).toBe(0);
  expect(new RegExp(`^PASS ${prefix}`, 'm').test(r.out), `${what}: a PASS ${prefix} line\n${shown(r)}`).toBe(true);
};
const failsNaming = (r: ReturnType<typeof script>, prefix: string, names: (string | RegExp)[], what: string): void => {
  expect(r.code, `${what}: exit 1\n${shown(r)}`).toBe(1);
  const lines = failLines(r, prefix);
  expect(lines.some((l) => names.every((n) => (typeof n === 'string' ? l.includes(n) : n.test(l)))), `${what}: one FAIL ${prefix} line names ${names.join(', ')}\n${shown(r)}`).toBe(true);
};

describe('AC4 #200.be794a42 the closure lint and the reference table\'s drift test', () => {
  it('AC4 a test schema enum test_mode: a | b with no closure fails the closure lint, naming test_mode', () => {
    failsNaming(closures(lintTree('noclosure', { type: 'string', enum: MODE_VALUES }, false)), 'closures', ['test_mode'], 'test_mode with no closure');
  });

  it('AC4 the same enum closed {reason: determinism, reopens_if: a third mode} passes', () => {
    passes(closures(lintTree('closed', { type: 'string', enum: MODE_VALUES, 'x-closure': closedMode }, false)), 'closures', 'test_mode closed by determinism');
  });

  it('AC4 an enum that names the registry test.mark@1 passes only while that registry is declared', () => {
    const named: JsonObject = { type: 'string', enum: MODE_VALUES, 'x-closure': { registry: MARK } };
    passes(closures(lintTree('declared', named, true)), 'closures', 'test_mode closed by test.mark@1, declared');
    failsNaming(closures(lintTree('undeclared', named, false)), 'closures', [MARK], 'test_mode closed by test.mark@1, which no registry row declares');
  });

  it('AC4 the local preflight\'s lint lane runs the closure lint and the drift test, and both pass on the checkout', async () => {
    const lanes = ((await import(new URL('../../../scripts/lanes.mjs', import.meta.url).href)) as { checks: { name: string; commands: string[][] }[] }).checks;
    const lint = lanes.find((l) => l.name === 'lint');
    expect(lint, 'scripts/lanes.mjs has the lint lane').toBeDefined();
    const runs = (sub: string) => lint!.commands.some((c) => c.some((a) => a.endsWith('scripts/canvas-closures.mjs')) && c.includes(sub));
    expect([runs('closures'), runs('drift')], 'the lint lane runs canvas-closures.mjs closures and drift').toEqual([true, true]);
    passes(script('canvas-closures.mjs', ['closures']), 'closures', 'the closure lint on the checkout\'s canvas schemas');
    passes(script('canvas-closures.mjs', ['drift']), 'drift', 'the drift test on the checkout');
  });
});

// ---- AC15: a closed list's mark, through the contract step (#139) and the closure lint.

const tone = (values: string[], mark?: 'extensible' | 'exhaustive'): JsonObject =>
  ({ type: 'string', enum: values, 'x-closure': { closed: 'determinism', reopens_if: 'a tone between low and high', ...(mark ? { mark } : {}) } });
const dir = (values: string[]): JsonObject =>
  ({ type: 'string', enum: values, 'x-closure': { closed: 'determinism', reopens_if: 'a third direction', mark: 'exhaustive' } });
const R2_LISTS = lists({ test_tone: tone(['low', 'high', 'unknown'], 'extensible'), test_dir: dir(['in', 'out']) });
const contracts = (root: string, ...args: string[]) => script('contract-diff.mjs', [...args, '--root', root]);
/** A tree holding only test.lists@1 as R2 published it, with R2 recorded. */
function recordedR2(tag: string): string {
  const root = scratchTree(tag, { empty: true });
  writeJson(join(root, SCHEMA), R2_LISTS);
  const r = contracts(root, 'record', '--release', 'R2');
  expect(r.code, `contract-diff record --release R2\n${shown(r)}`).toBe(0);
  return root;
}

describe('AC15 #200.81fef80c a closed canvas list says whether it is extensible or exhaustive', () => {
  it('AC15 a list marked extensible takes a new value in a minor, and a reader at the earlier minor maps it to the list\'s unknown', async () => {
    const root = recordedR2('extensible');
    const dump = JSON.parse(contracts(root, 'dump').out) as { entries: Record<string, JsonValue> };
    expect(Object.keys(dump.entries).filter((k) => k.includes('test.lists@1')), 'the contract history covers the canvas schema test.lists@1').toHaveLength(1);
    writeJson(join(root, SCHEMA), lists({ test_tone: tone(['low', 'high', 'mid', 'unknown'], 'extensible'), test_dir: dir(['in', 'out']) }));
    const r = contracts(root, 'check', '--release', 'R3');
    expect(failLines(r, 'contracts'), `mid added to test_tone, extensible, in R3 is no break\n${shown(r)}`).toEqual([]);
    expect(r.code, `contract-diff check --release R3\n${shown(r)}`).toBe(0);
    const { serveAt } = (await import(new URL('../../../packages/conformance/dist/index.js', import.meta.url).href)) as { serveAt: (schema: JsonValue, value: JsonValue) => JsonValue };
    expect(serveAt(R2_LISTS, { test_tone: 'mid', test_dir: 'in' }), 'a reader at R2 maps mid to unknown and keeps what it knows').toEqual({ test_tone: 'unknown', test_dir: 'in' });
  });

  it('AC15 a list marked exhaustive refuses a new value without a new major, naming the list', () => {
    const root = recordedR2('exhaustive');
    writeJson(join(root, SCHEMA), lists({ test_tone: tone(['low', 'high', 'unknown'], 'extensible'), test_dir: dir(['in', 'out', 'up']) }));
    const r = contracts(root, 'check', '--release', 'R3');
    expect(r.code, `up added to the exhaustive test_dir under test.lists@1 fails the contract step\n${shown(r)}`).toBe(1);
    expect(failLines(r, 'contracts').some((l) => l.includes('test_dir')), `a FAIL contracts line names the list test_dir\n${shown(r)}`).toBe(true);
  });

  it('AC15 a closed closure without the mark fails the closure lint, naming the list', () => {
    const root = scratchTree('nomark', { empty: true });
    writeJson(join(root, SCHEMA), lists({ test_tone: tone(['low', 'high', 'unknown']) }));
    writeJson(join(root, REGISTRIES_FILE), []);
    failsNaming(closures(root), 'closures', ['test_tone'], 'test_tone closed with no mark');
    // The same list with its mark passes, so the failure is the mark's.
    writeJson(join(root, SCHEMA), lists({ test_tone: tone(['low', 'high', 'unknown'], 'extensible') }));
    passes(closures(root), 'closures', 'test_tone closed and marked extensible');
  });
});

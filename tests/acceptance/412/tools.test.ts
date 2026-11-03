// AC2: "Every new tool's description says what its result does not prove, every error matches the shared error
// shape, and the published schemas pass the strict validators of the model APIs agents use"
//
// AC3: "No tool runs an agent's code outside the sandbox (`sandbox@1`), drives a live editor or your app, or can
// answer, decide or overrule, checked against the tool list"
//
// AC6: "The generated skill states the canvas working order and names deep_open_item for a missing kind or field, and
// a test fails when the skill names a tool parameter or a kind deep_kinds doesn't list"
//
// asserts: the tool list is `deep mcp`'s tools/list (#26), read with no hub. AC2: deep_kinds is listed; every tool the
// merge base's packages/hub/tools.json doesn't describe is new, and each new tool's description says what its result
// does not prove; every tool's input schema is in the strict subset (#26's check, which refuses each planted pattern
// and takes a clean schema); deep_kinds' refusals in `core` (an unknown op, an unlisted field, a missing word, an
// example hash nothing holds) are each `{"error": error@2}`, validated by @deepbuild/contracts, at the path of the
// refused value. AC3: deep_kinds is listed, and the list holds none of deep_validate, deep_cost, deep_render,
// deep_bake, no second search tool, no tool named for running code, driving a live editor or the app, or answering,
// deciding or overruling, and no input field that would carry code or an answer; the same check fails a list with
// deep_render added, with deep_kinds taking `code`, with a deep_unreal_editor and with a deep_answer, naming each.
// AC6: skills/deepbuild/SKILL.md is what scripts/skill.mjs generates; it states the working order (a piece recipe
// or a kind deep_kinds lists, a check before any render, a small render and its issues, fixes by patch, a full
// render last) and names deep_open_item for a missing kind or field; it names no tool parameter and no name@major
// the `full` build's deep_kinds doesn't list. The check fails the skill with a deep_kinds parameter named in a code
// span, naming the parameter, and with `circel@1` added, naming circel@1.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validate } from '@deepbuild/contracts';
import { describe, expect, it } from 'vitest';
import {
  CORE, FULL, REPO, SAYS_NOT_PROVEN, SKILL, allEntries, baseToolNames, errorOf, failsNaming, kinds, listAll, none, propertyNames, run, scenario, show,
  skillFailures, strictProblems, toolList, toolListFailures, useBuilds, useEvidence, useTempDirs, type JsonObject, type Tool,
} from './helpers.ts';

useTempDirs();
const builds = useBuilds([CORE, FULL]);
const evidence = useEvidence();

let tools: Tool[] | undefined;
const listed = (): Tool[] => (tools ??= toolList());
function withKinds(): Tool[] {
  const t = listed();
  expect(t.map((x) => x.name), 'deep mcp lists deep_kinds').toContain('deep_kinds');
  return t;
}

describe('AC2 every new tool says what its result does not prove, its errors share one shape, and its schemas pass the strict validators', () => {
  it('AC2 every tool the merge base didn\'t list, deep_kinds among them, says what its result does not prove', () => {
    const t = withKinds();
    const base = baseToolNames();
    const fresh = t.filter((x) => !base.includes(x.name));
    expect(fresh.map((x) => x.name), 'deep_kinds is a new tool').toContain('deep_kinds');
    for (const x of fresh) expect(x.description, `${x.name}'s description says what its result does not prove`).toMatch(SAYS_NOT_PROVEN);
  }, 1_800_000);

  it('AC2 every published input schema is in the strict subset, and the check refuses each pattern a strict validator refuses', () => {
    const planted: [string, JsonObject][] = [
      ['anyOf', { type: 'object', properties: { a: { anyOf: [{ type: 'string' }, { type: 'integer' }] } }, required: ['a'], additionalProperties: false }],
      ['an open object', { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }],
      ['an optional field', { type: 'object', properties: { a: { type: 'string' } }, required: [], additionalProperties: false }],
      ['a map', { type: 'object', properties: {}, required: [], additionalProperties: { type: 'string' } }],
      ['a length', { type: 'object', properties: { a: { type: 'string', maxLength: 10 } }, required: ['a'], additionalProperties: false }],
      ['a range', { type: 'object', properties: { a: { type: 'integer', minimum: 0 } }, required: ['a'], additionalProperties: false }],
    ];
    for (const [what, schema] of planted) expect(strictProblems(what, schema).length, `the strict check refuses ${what}`).toBeGreaterThan(0);
    expect(strictProblems('clean', { type: 'object', properties: { a: { type: ['string', 'null'] } }, required: ['a'], additionalProperties: false }), 'the strict check takes a clean schema').toEqual([]);
    const t = withKinds();
    expect(t.flatMap((x) => strictProblems(x.name, x.inputSchema)), 'every tool\'s input schema is in the strict subset').toEqual([]);
  }, 1_800_000);

  it('AC2 every deep_kinds refusal is error@2, at the path of the value it refused', () => {
    const missing = '0'.repeat(64);
    const calls = [kinds('frobnicate'), kinds('list', { bogus: 1 }), kinds('word', {}), kinds('read', { example: missing })];
    const replies = run(builds.bin(CORE), scenario(evidence(), calls));
    const errors = replies.map((r, i) => {
      const e = errorOf(r);
      expect(e, `call ${show(calls[i]!)} is refused with {"error": error@2}: ${show(r)}`).toBeDefined();
      const checked = validate('error@2', e);
      expect(checked.ok ? [] : checked.issues.map((x) => `${x.path}: ${x.code}`), `the refusal of ${show(calls[i]!)} matches error@2: ${show(e)}`).toEqual([]);
      return e!;
    });
    expect(String(errors[0]!['path']), 'an unknown op is refused at op').toMatch(/op$/);
    expect(String(errors[1]!['path']), 'an unlisted field is refused at its path').toMatch(/bogus$/);
    expect(String(errors[2]!['path']), 'a missing word is refused at word').toMatch(/word$/);
    expect(String(errors[3]!['actual']), 'an example nothing holds is refused naming its hash').toContain(missing);
  }, 1_800_000);
});

describe('AC3 no tool runs an agent\'s code outside the sandbox, drives a live editor or your app, or can answer, decide or overrule', () => {
  it('AC3 checked against the tool list: deep_kinds beside the others, and none of them runs code, drives a live editor or app, answers, decides or overrules', () => {
    const t = withKinds();
    none(toolListFailures(t), 'the tool list');
  }, 1_800_000);

  it('AC3 the same check fails a tool list that adds deep_render, a deep_kinds that takes code, a live editor driver or an answering tool, naming each', () => {
    const t = withKinds();
    const object = (properties: JsonObject): JsonObject => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
    const stub = (name: string, properties: JsonObject = {}): Tool => ({ name, description: 'A planted tool.', inputSchema: object(properties) });
    failsNaming(toolListFailures([...t, stub('deep_render')]), ['deep_render'], 'a list with deep_render');
    const kindsWithCode = t.map((x) => (x.name === 'deep_kinds' ? { ...x, inputSchema: object({ ...((x.inputSchema['properties'] ?? {}) as JsonObject), code: { type: 'string' } }) } : x));
    failsNaming(toolListFailures(kindsWithCode), ['deep_kinds'], 'deep_kinds taking code');
    failsNaming(toolListFailures([...t, stub('deep_unreal_editor')]), ['deep_unreal_editor'], 'a live editor driver');
    failsNaming(toolListFailures([...t, stub('deep_answer', { ask: { type: 'string' }, option: { type: 'string' } })]), ['deep_answer'], 'an answering tool');
  }, 1_800_000);
});

/** What scripts/skill.mjs generates now, read without writing anything. */
function generated(): { skill: string; descriptions: Record<string, string> } {
  const script = join(REPO, 'scripts/skill.mjs');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { generate } from ${JSON.stringify(script)}; process.stdout.write(JSON.stringify(generate()));`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  expect(r.status, `scripts/skill.mjs generates: ${(r.stderr ?? '').slice(-1500)}`).toBe(0);
  return JSON.parse(r.stdout) as { skill: string; descriptions: Record<string, string> };
}
/** Every name@major deep_kinds lists in the `full` build: entries, registries, slots and interfaces. */
function listedNames(): Set<string> {
  const l = listAll(builds.bin(FULL), evidence());
  return new Set([...allEntries(l).map((e) => e.name), ...l.listed.map((x) => x.name), ...l.interfaces.map((i) => String(i['name']))]);
}

describe('AC6 the generated skill states the canvas working order and names deep_open_item for a missing kind or field', () => {
  it('AC6 the skill is the one scripts/skill.mjs generates, states the working order, names deep_open_item for a missing kind or field, and names no tool parameter or unlisted kind', () => {
    const skill = readFileSync(SKILL, 'utf8');
    const made = generated();
    expect(skill, 'skills/deepbuild/SKILL.md is what scripts/skill.mjs generates').toBe(made.skill);
    const t = withKinds();
    expect(made.descriptions['deep_kinds'], 'scripts/skill.mjs generates deep_kinds\' description').toBe(t.find((x) => x.name === 'deep_kinds')!.description);
    none(skillFailures(skill, t, listedNames()), 'the generated skill');
  }, 1_800_000);

  it('AC6 the check fails a skill that names a deep_kinds parameter or a kind deep_kinds doesn\'t list, naming each', () => {
    const skill = readFileSync(SKILL, 'utf8');
    const t = withKinds();
    const names = listedNames();
    const param = [...propertyNames(t.find((x) => x.name === 'deep_kinds')!.inputSchema)][0];
    expect(param, 'deep_kinds takes a parameter').toBeDefined();
    failsNaming(skillFailures(`${skill}\nPass \`${param}\` to deep_kinds.\n`, t, names), [param!], 'a skill naming a deep_kinds parameter');
    failsNaming(skillFailures(`${skill}\nStart from circel@1 for a ring.\n`, t, names), ['circel@1'], 'a skill naming a kind deep_kinds doesn\'t list');
  }, 1_800_000);
});

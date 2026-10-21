import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { apply, batch, useBinary, check, clone, fixture, genId, GENERATORS, GRAMMARS, inGrammar, mutate, one, REFUSAL_CODES, Rng, SEEDS } from './helpers.ts';
import type { Case, Grammar, JsonObject, JsonValue } from './helpers.ts';

const N = 10_000;
const FIVE = fixture<JsonObject>('doc-five.json');
const CANON = fixture<{ bytes: string; sha256: string }>('doc-five.canonical.json');

useBinary();

function validCases(grammar: Grammar): Case[] {
  const rng = new Rng(SEEDS[grammar]);
  const cases: Case[] = [];
  for (let i = 0; i < N; i++) cases.push(GENERATORS[grammar](rng));
  return cases;
}

function asObject(value: JsonValue | undefined): JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {};
}

describe('AC8 10,000 seeded valid inputs per grammar parse, print back and resolve to the rational reference', () => {
  it.each(GRAMMARS)('AC8 %s: every valid input parses, prints back to the same text and gives the reference value', (grammar) => {
    const cases = validCases(grammar);
    const outs = batch(['parse', grammar], cases.map((c) => c.input));
    const failures: string[] = [];
    cases.forEach((c, i) => {
      const out = asObject(outs[i]);
      // A planted parser that refuses every input passes AC4 and fails here, with the grammar's name first.
      if (out['ok'] !== true) { failures.push(`${grammar}: refused the valid input ${JSON.stringify(c.input)}: ${JSON.stringify(out)}`); return; }
      if (out['printed'] !== c.printed) { failures.push(`${grammar}: ${JSON.stringify(c.input['text'])} printed back as ${JSON.stringify(out['printed'])}`); return; }
      if (JSON.stringify(out['value']) !== JSON.stringify(c.value)) failures.push(`${grammar}: ${JSON.stringify(c.input)} resolved to ${JSON.stringify(out['value'])}, the reference gives ${JSON.stringify(c.value)}`);
    });
    expect(failures.slice(0, 5), `${grammar}: ${failures.length} of ${N} valid inputs failed`).toEqual([]);
  }, 120_000);

  it('AC8 "195f" at 30 fps is 4,586,400,000 flicks and "1.25s" is 882,000,000', () => {
    const [a, b] = batch(['parse', 'time'], [{ text: '195f', fps: [30, 1] }, { text: '1.25s', fps: [60, 1] }]);
    expect(asObject(a)['value'], 'time: 195f at 30 fps').toEqual({ flicks: '4586400000' });
    expect(asObject(b)['value'], 'time: 1.25s').toEqual({ flicks: '882000000' });
  });
});

describe('AC4 10,000 seeded mutations per grammar are refused with a code, without a panic, and change nothing', () => {
  it.each(GRAMMARS)('AC4 %s: every mutation outside the grammar is refused with its code', (grammar) => {
    const rng = new Rng(SEEDS[grammar]);
    const mutRng = new Rng(SEEDS.mutate ^ SEEDS[grammar]);
    const sentinel = GENERATORS[grammar](new Rng(SEEDS[grammar] + 1));
    const inputs: JsonObject[] = [];
    const isSentinel: boolean[] = [];
    for (let i = 0; i < N; i++) {
      const valid = GENERATORS[grammar](rng);
      let mutated = mutate(grammar, valid, mutRng);
      for (let tries = 0; inGrammar(grammar, mutated) && tries < 50; tries++) mutated = mutate(grammar, valid, mutRng);
      expect(inGrammar(grammar, mutated), `${grammar}: the mutation ${JSON.stringify(mutated['text'])} stayed inside the grammar`).toBe(false);
      inputs.push(mutated); isSentinel.push(false);
      if (i % 100 === 99) { inputs.push(sentinel.input); isSentinel.push(true); }
    }
    // One process over every line: a panic on any line ends the run without an output line per input.
    const outs = batch(['parse', grammar], inputs);
    const failures: string[] = [];
    let sentinelOut: string | undefined;
    outs.forEach((raw, i) => {
      const out = asObject(raw);
      if (isSentinel[i]) {
        // A refused input changes nothing: the same valid input gives the same answer after every refusal.
        const text = JSON.stringify(out);
        sentinelOut ??= text;
        if (text !== sentinelOut) failures.push(`${grammar}: the sentinel's answer changed after a refusal: ${text}`);
        return;
      }
      if (out['ok'] !== false) { failures.push(`${grammar}: accepted ${JSON.stringify(inputs[i])}: ${JSON.stringify(out)}`); return; }
      if (!REFUSAL_CODES[grammar].includes(String(out['code']))) failures.push(`${grammar}: refusal of ${JSON.stringify(inputs[i]?.['text'])} carries code ${JSON.stringify(out['code'])}, not one of ${REFUSAL_CODES[grammar].join(', ')}`);
      if ('value' in out || 'printed' in out) failures.push(`${grammar}: a refusal of ${JSON.stringify(inputs[i]?.['text'])} carries a value`);
    });
    expect(failures.slice(0, 5), `${grammar}: ${failures.length} of ${N} mutations failed`).toEqual([]);
  }, 120_000);

  it('AC4 a patch whose path is refused leaves the document and its revision hash unchanged', () => {
    const rng = new Rng(SEEDS.path);
    const mutRng = new Rng(SEEDS.mutate);
    const inputs: JsonObject[] = [];
    const paths: string[] = [];
    for (let i = 0; i < 100; i++) {
      const valid = GENERATORS.path(rng);
      let mutated = mutate('path', valid, mutRng);
      for (let tries = 0; inGrammar('path', mutated) && tries < 50; tries++) mutated = mutate('path', valid, mutRng);
      const path = String(mutated['text']);
      paths.push(path);
      inputs.push({ doc: FIVE, writer: 'agent-a', patches: [{ patch: '01J9Z00000000000000000AC04', doc: 'doc-389', base: 0, reason: 'fuzz', ops: [{ op: 'set', id: 'sign', path, value: 1 }] }] });
    }
    const outs = batch(['apply'], inputs);
    outs.forEach((raw, i) => {
      const out = asObject(raw);
      expect(out['outcome'], `path: a set at ${JSON.stringify(paths[i])} was not refused`).toBe('refused');
      expect(out['hash'], 'path: a refused patch changed the revision hash').toBe(CANON.sha256);
      const codes = (out['issues'] as JsonObject[]).map((issue) => issue['code']);
      expect(codes.some((c) => REFUSAL_CODES.path.includes(String(c))), `path: a refused patch carries no grammar code: ${JSON.stringify(codes)}`).toBe(true);
    });
  }, 120_000);
});

describe('AC7 patches, channels and bound values address a field only through the one path grammar', () => {
  const patch = (ops: JsonValue[]): JsonObject => ({ patch: '01J9Z00000000000000000AC07', doc: 'doc-389', base: 0, reason: 'AC7', ops });

  it('AC7 items/<id>/params/<name>, items/<id>/at/rot/1 and controls/<id>/value parse to their sections, IDs and fields', () => {
    const outs = batch(['parse', 'path'], [{ text: 'items/sign/params/width' }, { text: 'items/sign/at/rot/1' }, { text: 'controls/dial/value' }, { text: 'items/trees#42/visible' }]);
    expect(asObject(outs[0])['value']).toEqual({ section: 'items', id: 'sign', sub: null, fields: ['params', 'width'] });
    expect(asObject(outs[1])['value']).toEqual({ section: 'items', id: 'sign', sub: null, fields: ['at', 'rot', '1'] });
    expect(asObject(outs[2])['value']).toEqual({ section: 'controls', id: 'dial', sub: null, fields: ['value'] });
    expect(asObject(outs[3])['value']).toEqual({ section: 'items', id: 'trees', sub: '42', fields: ['visible'] });
  });

  it('AC7 a set through items/<id>/at/rot/1 and items/<id>/params/<name> reaches those fields', () => {
    const out = apply(FIVE, 'agent-a', [patch([
      { op: 'set', id: 'sign', path: 'items/sign/at/rot/1', value: 90 },
      { op: 'set', id: 'post', path: 'items/post/params/width', value: 9.5 },
    ])]);
    expect(out.outcome, `path: ${JSON.stringify(out.issues)}`).toBe('applied');
    const items = out.doc['items'] as Record<string, JsonObject>;
    expect((items['sign']!['at'] as JsonObject)['rot']).toEqual([0, 90, 45]);
    expect((items['post']!['params'] as JsonObject)['width']).toBe(9.5);
  });

  it('AC7 a set whose path is not in the grammar is refused with bad_path, naming the path', () => {
    for (const path of ['items/sign.params.width', 'items.sign.params.width', '/items/sign/params/width', 'sign/params/width', 'items/sign']) {
      const out = apply(FIVE, 'agent-a', [patch([{ op: 'set', id: 'sign', path, value: 1 }])]);
      expect(out.outcome, `path: ${path} was applied`).toBe('refused');
      const issue = out.issues.find((i) => i.code === 'bad_path');
      expect(issue, `path: no bad_path issue for ${path}: ${JSON.stringify(out.issues)}`).toBeDefined();
      expect(issue!.actual, `path: the issue's actual for ${path}`).toBe(path);
    }
  });

  it('AC7 a channel or bound value whose target is not a path is refused at its own path', () => {
    const doc = clone(FIVE);
    (doc['channels'] as JsonObject)['bad'] = { target: 'items/sign.params.width' };
    doc['bound_values'] = { shown: { target: 'items/post/params/label', source: 'task:01J9Z0000000000000000000AB' }, odd: { target: 'items/post/params', source: 'bogus:1' } };
    const out = check(doc);
    expect(out.ok, 'path: a channel with a non-path target passed').toBe(false);
    const channel = out.issues.find((i) => i.code === 'bad_path' && i.path === 'channels/bad/target');
    expect(channel, `path: no bad_path at channels/bad/target: ${JSON.stringify(out.issues)}`).toBeDefined();
    expect(channel!.actual).toBe('items/sign.params.width');
    const handle = out.issues.find((i) => i.code === 'bad_handle' && i.path === 'bound_values/odd/source');
    expect(handle, `handle: no bad_handle at bound_values/odd/source: ${JSON.stringify(out.issues)}`).toBeDefined();
  });

  it('AC7 an ID containing / is refused wherever it appears', () => {
    const idOut = one(['parse', 'id'], { text: 'sign/post' });
    expect(idOut['ok'], 'id: sign/post was accepted').toBe(false);
    expect(idOut['code']).toBe('bad_id');
    const created = apply(FIVE, 'agent-a', [patch([{ op: 'create', item: { id: 'a/b', kind: 'test.slab@3', name: 'Slash', order: 'a5', params: {} } }])]);
    expect(created.outcome, 'id: a create with a/b was applied').toBe('refused');
    expect(created.issues.some((i) => i.code === 'bad_id'), `id: no bad_id issue: ${JSON.stringify(created.issues)}`).toBe(true);
    // Any valid ID with a slash spliced in anywhere is refused with bad_id (a seeded 200-case property).
    fc.assert(fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), fc.nat(), (seed, at) => {
      const id = genId(new Rng(seed));
      const text = `${id.slice(0, at % (id.length + 1))}/${id.slice(at % (id.length + 1))}`;
      const out = one(['parse', 'id'], { text });
      return out['ok'] === false && out['code'] === 'bad_id';
    }), { seed: SEEDS.id, numRuns: 200 });
  }, 120_000);
});

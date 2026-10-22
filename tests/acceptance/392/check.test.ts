import { describe, expect, it } from 'vitest';
import { arr, batch, clone, fixture, isObject, obj, useRenderBinary, type JsonObject, type JsonValue } from './helpers.ts';

useRenderBinary();

/** A core view with one writer layer and the items given. */
function doc(items: JsonObject, extra: JsonObject = {}): JsonObject {
  return {
    format: 1, id: 'honest-392', profile: 'board', title: 'Honest', description: 'A core view the honest-numbers and status-color rules read.',
    size: [320, 120], budget: { class: 'core view' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items, ...extra,
  };
}

const text = (id: string, value: string, bound = false): JsonObject => ({
  id, kind: 'text@1', layer: 'main', name: 'Tally', order: 'a0',
  params: { text: value, font: 'body', size: 13, box: { w: 240, h: 20 }, ...(bound ? { numerals: 'tabular', widest: '999,999' } : {}) }, at: { pos: [16, 16, 0] },
});

const gate = (paint?: JsonObject): JsonObject => ({
  id: 'gate', kind: 'rect@1', layer: 'main', name: 'Gate', order: 'a1', params: { box: [16, 48, 96, 24], ...(paint ? { paint } : {}) },
});

/** Little-endian f64 column data, as #391's mark sets read it. */
const f64 = (values: number[]): string => Buffer.from(new Float64Array(values).buffer).toString('base64');

/** A point set whose rows take their role from a column through scale `band`, whose range is `range`. */
function scaled(range: string[]): JsonObject {
  return doc({
    band: { id: 'band', kind: 'scale@1', layer: 'main', name: 'Band', order: 'a0', params: { type: 'linear', domain: [0, 1], range, nice: false } },
    scores: {
      id: 'scores', kind: 'marks@1', layer: 'main', name: 'Scores', order: 'a1',
      params: {
        mark: 'point', n: 2,
        columns: { x: { dtype: 'f64', len: 2, data: f64([40, 80]) }, y: { dtype: 'f64', len: 2, data: f64([60, 60]) }, score: { dtype: 'f64', len: 2, data: f64([0.2, 0.9]) } },
        encode: { x: { column: 'x' }, y: { column: 'y' }, role: { column: 'score', scale: 'band' } },
      },
    },
  });
}

const VERDICT = 'verdict:01JB3000000000000000000002';
const READING = 'reading:01JB3000000000000000000003';

interface Issue { code: string; severity: string; ids: string[]; path: string }

/** Every document through one `check` run, against the shipped clean look. */
function check(docs: JsonObject[]): { ok: boolean; issues: Issue[]; raw: JsonObject }[] {
  return batch('check', docs.map((d) => ({ doc: d, look: 'clean' }))).map((out, k) => {
    const o = obj(out, `check[${k}]`);
    expect(typeof o['ok'], `check[${k}].ok is a boolean: ${JSON.stringify(o).slice(0, 1000)}`).toBe('boolean');
    const issues = arr(o['issues'], `check[${k}].issues`).map((v, i): Issue => {
      const issue = obj(v, `check[${k}].issues[${i}]`);
      return {
        code: String(issue['code']), severity: String(issue['severity']), path: String(issue['path']),
        ids: Array.isArray(issue['ids']) ? issue['ids'].map(String) : [],
      };
    });
    return { ok: o['ok'] === true, issues, raw: o };
  });
}

/** The error issues with `code` that name `item`, or a message saying what the check returned instead. */
function named(result: { ok: boolean; issues: Issue[]; raw: JsonObject }, code: string, items: string[]): string | null {
  if (result.ok) return `the check passed it: ${JSON.stringify(result.raw).slice(0, 1000)}`;
  const hit = result.issues.some((i) => i.code === code && i.severity === 'error' && items.some((id) => i.ids.includes(id)));
  return hit ? null : `no error ${code} naming ${items.join(' or ')}; issues: ${JSON.stringify(result.issues)}`;
}

describe('AC1 a document that shows a number without its source and as-of time, or takes a status color from a threshold, a scale or a literal, is refused naming the item', () => {
  it('AC1 a number typed into a text, with no source or as-of time, is refused as number_unsourced naming the item; the same number as a bound value passes', () => {
    const [digits, decimal, sourced, words] = check([
      doc({ tally: text('tally', '12 checks passed') }),
      doc({ tally: text('tally', 'Took 3.5 s') }),
      doc({ tally: text('tally', '', true) }, { bound_values: { 'tally-value': { target: 'items/tally/params/text', source: READING } } }),
      doc({ tally: text('tally', 'All checks passed') }),
    ]);
    // A check that never reads the text for numbers passes the first two and fails here.
    expect(named(digits!, 'number_unsourced', ['tally']), 'a whole number in a text').toBeNull();
    expect(named(decimal!, 'number_unsourced', ['tally']), 'a decimal number with a unit in a text').toBeNull();
    const path = digits!.issues.find((i) => i.code === 'number_unsourced')?.path;
    expect(path, 'the issue points at the text that shows the number').toBe('items/tally/params/text');
    // Its clean twins: the number bound to a reading (with its source, and its as-of time from the
    // reading), and a text with no number. A check that refuses every text fails here.
    expect(sourced!.ok, `a bound value with its source passes: ${JSON.stringify(sourced!.raw).slice(0, 1000)}`).toBe(true);
    expect(words!.ok, `a text with no number passes: ${JSON.stringify(words!.raw).slice(0, 1000)}`).toBe(true);
  }, 900_000);

  it('AC1 a status color from a literal, from a threshold on a reading or from a scale is refused as status_color_unbound naming the item; from a verdict it passes', () => {
    const [literal, threshold, scale, verdict, dataScale] = check([
      // A literal: the paint names a status role itself.
      doc({ gate: gate({ fill: { role: 'status.fail' } }) }),
      // A threshold: a reading's number would have to be cut into states to give a status.
      doc({ gate: gate() }, { status_bindings: { 'gate-status': { target: 'items/gate/params/paint/fill', source: READING } } }),
      // A scale: a column mapped through a scale whose range is status roles.
      scaled(['status.fail', 'status.pass']),
      // The clean twin: the same mark, its fill bound to a verdict.
      doc({ gate: gate() }, { status_bindings: { 'gate-status': { target: 'items/gate/params/paint/fill', source: VERDICT } } }),
      // The scale's twin: the same mapping onto data roles.
      scaled(['ink', 'muted']),
    ]);
    expect(named(literal!, 'status_color_unbound', ['gate']), 'a literal status role in a paint').toBeNull();
    expect(named(threshold!, 'status_color_unbound', ['gate']), 'a status binding whose source is a reading').toBeNull();
    // The item that takes the color is the mark set; the scale that maps onto status roles may be named with it.
    expect(named(scale!, 'status_color_unbound', ['scores', 'band']), 'a scale whose range is status roles').toBeNull();
    // A check that refuses every status binding, or every paint, fails here.
    expect(verdict!.ok, `a status binding whose source is a verdict passes: ${JSON.stringify(verdict!.raw).slice(0, 1000)}`).toBe(true);
    // A check that refuses every scale mapping onto roles fails here.
    expect(dataScale!.issues.filter((i) => i.code === 'status_color_unbound'), 'a scale onto data roles takes no status color').toEqual([]);
  }, 900_000);

  it('AC1 the fixtures this suite draws pass the check: the ask line, whose status marks are all bound, and the stale value, whose number is bound', () => {
    const [line, stale] = check([fixture('ask-line.json'), fixture('stale-value.json')]);
    expect(line!.ok, `the ask line passes: ${JSON.stringify(line!.raw).slice(0, 2000)}`).toBe(true);
    expect(stale!.ok, `the stale value passes: ${JSON.stringify(stale!.raw).slice(0, 2000)}`).toBe(true);
    // And the ask line refused once one of its marks takes its color from a literal instead.
    const literal = clone(fixture('ask-line.json'));
    const items = obj(literal['items'], 'items');
    obj(obj(items['badge-fail'], 'badge-fail')['params'], 'badge-fail.params')['paint'] = { fill: { role: 'status.fail' } };
    delete obj(literal['status_bindings'], 'status_bindings')['s-fail'];
    const [refused] = check([literal]);
    expect(named(refused!, 'status_color_unbound', ['badge-fail']), 'the ask line with one literal status color').toBeNull();
  }, 900_000);

  it('a check line that is not JSON, or has no doc, is bad_input with no panic', () => {
    const out: JsonValue[] = batch('check', ['not json', { look: 'clean' }]);
    for (const o of out) expect(isObject(o) ? [o['ok'], o['code']] : o, 'bad_input').toEqual([false, 'bad_input']);
  }, 900_000);
});

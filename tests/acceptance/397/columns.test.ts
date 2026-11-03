// AC6: A test canvas module fills column.source@1 with a source whose i32 column holds 70,000 at row 3 and 5
// elsewhere; a mark set reading it as u16 hides row 3 and raises column.out_of_range naming the set, the column,
// row 3 and 70,000, while every other row draws; the registry's kit fails a planted source that keeps the previous
// frame's rows after a seek, naming the frame, and one that reports no changed ranges while values change, which
// fails clean-rebuild equality; and a mark set that names a source no module in the build fills is refused with
// module_missing.
// fixtures/column-source.json names the test module (`test.columns`, behind deep-show's cargo feature
// `test-column-source`), its entry, its source `test.column.big` (rows 0…5: 5, 5, 5, 70000, 5, 5; row 3 is index
// 3) and the planted sources with the kit rule each breaks. Everything is `deep-show run`: `deep_show` with
// `include: ["issues", "pixels"]` (#393's, the snapshot a render-back PNG in the evidence store) and `registries`
// (#200's deep://registries listing, with each planted entry's kit result).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DOC, SESSION, TIMEOUT, arr, decodePng, evidenceFile, f32Column, fixtureJson, issuesOf, lines, num, obj, pixel, replies, same, scenario, shownIssues, str,
  u32Column, useBuilds, useTemp, type JsonObject,
} from './helpers.ts';

const SPEC = fixtureJson('column-source.json');
const FEATURE = str(SPEC['feature'], 'feature');
const SOURCE = obj(SPEC['source'], 'source');
const FORM = str(SOURCE['form'], 'source.form');
const ROWS = arr(SOURCE['rows'], 'source.rows').map((v) => num(v, 'row'));
const ENTRY = obj(SPEC['entry'], 'entry');
const RULES = obj(SPEC['rules'], 'rules');
const OUT = ROWS.findIndex((v) => v > 65_535);

const builds = useBuilds([{ bin: 'deep-show', features: [FEATURE] }, { bin: 'deep-show' }]);
const withModule = (): string => builds.path({ bin: 'deep-show', features: [FEATURE] });
const without = (): string => builds.path({ bin: 'deep-show' });
const temp = useTemp('columns');

const X = ROWS.map((_, i) => 40 + i * 100);
/** Six cells, each from y 300 up to the source's value through a scale (5 reaches y 200); the value read as u16. */
const cells: JsonObject = {
  format: 1, profile: 'chart', title: 'Cells from a test source', description: 'Six cells whose heights a test canvas module\'s column gives, read as u16.',
  size: [640, 360],
  items: {
    vs: { id: 'vs', kind: 'scale@1', name: 'Value scale', order: 'a0', params: { type: 'linear', domain: [0, 10], range: [300, 100], nice: false } },
    cells: {
      id: 'cells', kind: 'marks@1', name: 'Cells', order: 'a1',
      params: {
        mark: 'rect', n: ROWS.length, key: 'key',
        columns: {
          key: u32Column(ROWS.map((_, i) => i)), x: f32Column(X), x2: f32Column(X.map((x) => x + 80)), y: { const: 300 },
          v: { source: FORM, as: 'u16' },
        },
        encode: { x: { column: 'x' }, x2: { column: 'x2' }, y: { column: 'y' }, y2: { column: 'v', scale: 'vs' } },
        paint: { fill: { role: 'accent' } },
      },
    },
  },
};

function shown(bin: string, evidence: string): JsonObject {
  const [out] = lines(bin, ['run'], [scenario(evidence, [{ call: 'deep_show', session: SESSION, doc: DOC, document: cells, include: ['issues', 'pixels'], size: [640, 360] }])]);
  return replies(out, 1)[0]!;
}

function registry(): JsonObject {
  const [out] = lines(withModule(), ['run'], [{ evidence: temp(), calls: [{ call: 'registries' }] }]);
  const list = arr(replies(out, 1)[0]!['registries'], 'registries').map((r) => obj(r, 'registry row'));
  const row = list.find((r) => r['name'] === 'column.source@1');
  expect(row, `deep://registries lists column.source@1: ${JSON.stringify(list.map((r) => r['name']))}`).toBeDefined();
  return row!;
}

interface RuleResult { rule: string; verdict: string; raw: JsonObject }
function planted(row: JsonObject, name: string): { verdict: string; failing: RuleResult[]; raw: JsonObject } {
  const entry = arr(row['planted'], 'column.source@1 planted').map((p) => obj(p, 'planted entry')).find((p) => p['name'] === name);
  expect(entry, `column.source@1's kit has the planted source ${name}: ${JSON.stringify(row['planted']).slice(0, 1500)}`).toBeDefined();
  const result = obj(entry!['result'], `${name}: result`);
  const rules = arr(result['rules'], `${name}: result.rules`).map((r) => obj(r, 'rule result')).map((r) => ({ rule: String(r['rule']), verdict: String(r['verdict']), raw: r }));
  return { verdict: String(result['verdict']), failing: rules.filter((r) => r.verdict === 'FAIL'), raw: result };
}

describe('AC6 the column view: column.source@1, one narrowing rule, its kit and module_missing', () => {
  it('AC6 (narrowing) a mark set reading the i32 column as u16 hides row 3 and raises column.out_of_range naming the set, the column, row 3 and 70,000, while every other row draws', () => {
    expect([OUT, ROWS[OUT], ROWS.filter((v) => v === 5).length], 'the fixture: 70,000 at row 3, 5 in the other five rows').toEqual([3, 70_000, 5]);
    const evidence = temp();
    const reply = shown(withModule(), evidence);
    expect(reply['outcome'], `the document is presented: ${JSON.stringify(reply).slice(0, 2000)}`).toBe('presented');
    const issues = issuesOf(reply['issues'], 'deep_show: issues');
    const out = issues.filter((i) => i.code === 'column.out_of_range');
    expect(out.length, `one column.out_of_range issue: ${shownIssues({ issues })}`).toBe(1);
    const raw = out[0]!.raw;
    expect([raw['reader'], raw['column'], raw['row'], raw['value']], 'it names the set, the column, row 3 and 70,000').toEqual(['cells', 'v', 3, 70_000]);
    expect(raw['step'] !== undefined && raw['step'] !== null, 'and the step it was first seen at').toBe(true);
    const snaps = arr(reply['snapshots'], 'deep_show: snapshots').map((s) => obj(s, 'snapshot'));
    expect(snaps.length, 'the frame is drawn').toBe(1);
    const image = decodePng(readFileSync(evidenceFile(evidence, str(snaps[0]!['sha256'], 'snapshot sha256'))));
    expect([image.width, image.height], 'the snapshot is the document\'s size').toEqual([640, 360]);
    const ground = pixel(image, 10, 10);
    for (const [i, x] of X.entries()) {
      const inside = pixel(image, x + 40, 250);
      const above = pixel(image, x + 40, 150);
      expect(same(above, ground), `row ${i}: nothing above the value 5 (y 200)`).toBe(true);
      if (i === OUT) expect(same(inside, ground), `row 3 is hidden: ${JSON.stringify(inside)}`).toBe(true);
      else expect(!same(inside, ground) && same(inside, pixel(image, X[0]! + 40, 250)), `row ${i} draws, as every in-range row does: ${JSON.stringify(inside)}`).toBe(true);
    }
  }, TIMEOUT);

  it('AC6 (seek) the core declares column.source@1, the test module fills it, and its kit fails a planted source that keeps the previous frame\'s rows after a seek, naming the frame', () => {
    const row = registry();
    expect([row['owner'], row['fill'], row['resolve']], 'the core declares it; only canvas modules fill it; it resolves at check').toEqual(['core', ['module'], 'check']);
    const entry = arr(row['entries'], 'column.source@1 entries').map((e) => obj(e, 'entry')).find((e) => e['name'] === ENTRY['name']);
    expect(entry, `the test module's entry ${String(ENTRY['name'])} is listed`).toBeDefined();
    expect(obj(entry!['value'], 'entry value')['form'], 'with its form').toBe(ENTRY['form']);
    expect(obj(entry!['kit'], 'entry kit')['verdict'], 'and it passes the kit').toBe('PASS');
    const seek = planted(row, 'keeps_previous_rows');
    expect(seek.verdict, 'the kit fails the source that keeps the previous frame\'s rows').toBe('FAIL');
    expect(seek.failing.map((r) => r.rule), 'on the seek rule alone').toEqual([String(RULES['keeps_previous_rows'])]);
    expect(Number.isInteger(seek.failing[0]!.raw['frame']), `naming the frame: ${JSON.stringify(seek.raw).slice(0, 800)}`).toBe(true);
  }, TIMEOUT);

  it('AC6 (changed ranges) the kit fails a planted source that reports no changed ranges while values change, on clean-rebuild equality', () => {
    const row = registry();
    const none = planted(row, 'reports_no_changes');
    expect(none.verdict, 'the kit fails the source that reports no changed ranges').toBe('FAIL');
    expect(none.failing.map((r) => r.rule), `on clean-rebuild equality alone: ${JSON.stringify(none.raw).slice(0, 800)}`).toEqual([String(RULES['reports_no_changes'])]);
  }, TIMEOUT);

  it('AC6 (module_missing) the same mark set in a build no module of which fills its source is refused with module_missing', () => {
    const reply = shown(without(), temp());
    expect(reply['outcome'], `the document is refused: ${JSON.stringify(reply).slice(0, 2000)}`).toBe('refused');
    const issues = issuesOf(reply['issues'], 'deep_show: issues');
    expect(issues.some((i) => i.code === 'module_missing' && i.severity === 'error'), `with module_missing: ${shownIssues({ issues })}`).toBe(true);
  }, TIMEOUT);
});

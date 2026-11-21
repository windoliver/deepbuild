// #3014 AC2: what #2363 left holds. Every fixture the `fixtures` call lists opens in a reader's fresh store, one no
// run listed fixtures in (the issue's second scope line), and the canvas kit's fixtures part passes the record and
// sheet modules' fixtures. The wrong programs are the twins never-writes, a fix that over-corrects, and
// record-sheet-regressed (README: The wrong programs).
import { describe, expect, it } from 'vitest';
import {
  ALPHA, DOCS, arr, doc, hashesNamed, isObject, listed, nameOf, obj, run, show, str, useShowBinary, useStores, world,
  type JsonObject, type Listed,
} from './helpers.ts';

const AC2 = '#3014.2d0d5e25';

useShowBinary();
const store = useStores();

/** Listed fixtures in groups that share a record (a scenario carries one), at most DOCS a group. */
function groups(fixtures: Listed[]): Listed[][] {
  const byRecord = new Map<string, Listed[]>();
  for (const f of fixtures) {
    const key = JSON.stringify(f.record ?? null);
    byRecord.set(key, [...(byRecord.get(key) ?? []), f]);
  }
  return [...byRecord.values()].flatMap((list) => Array.from({ length: Math.ceil(list.length / DOCS) }, (_, i) => list.slice(i * DOCS, (i + 1) * DOCS)));
}

const codes = (reply: JsonObject): string[] =>
  (Array.isArray(reply['issues']) ? reply['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error').map((i) => `${String(i['code'])} at ${String(i['path'] ?? '')}`);

describe(`${AC2} the canvas kit's record and sheet fixtures still pass as #2363 left them`, () => {
  it(`${AC2} AC2 every fixture the fixtures call lists opens in a reader's fresh store, one no run listed fixtures in, among them one that names an asset by its hash`, () => {
    const fixtures = listed(store());
    expect(fixtures.length, 'the fixtures call lists fixtures').toBeGreaterThan(0);
    const naming = fixtures.filter((f) => hashesNamed(f.document).length > 0).map(nameOf);
    expect(naming, 'some listed fixture names an asset by its SHA-256, which no fresh store holds').not.toEqual([]);
    const refused: string[] = [];
    for (const group of groups(fixtures)) {
      const evidence = store();
      const replies = run(world(evidence, group.map((f, i) => show(ALPHA.id, doc(i + 1), f.document)), { record: group[0]!.record }));
      group.forEach((f, i) => {
        const reply = replies[i]!;
        if (reply['outcome'] !== 'presented') refused.push(`${nameOf(f)}: ${String(reply['outcome'])}${reply['code'] ? ` (${String(reply['code'])})` : ''} ${JSON.stringify(codes(reply).slice(0, 4))}`);
      });
    }
    expect(refused, 'each listed fixture, shown in a fresh store with no fixtures call, is presented').toEqual([]);
  }, 1_200_000);

  it(`${AC2} AC2 the canvas kit's fixtures part, run over the record and sheet modules in a fresh store, passes each module and every case of their fixtures`, () => {
    const [kit] = run({ evidence: store(), calls: [{ call: 'kit', modules: ['record', 'sheet'], parts: ['fixtures'] }] });
    const modules = arr(kit!['modules'], 'the kit: modules').map((v, i) => obj(v, `the kit: modules[${i}]`));
    expect(modules.map((m) => str(m['module'], 'module')).sort(), 'the kit ran the record and sheet modules').toEqual(['record', 'sheet']);
    const failures: string[] = [];
    for (const m of modules) {
      const name = String(m['module']);
      const parts = arr(m['parts'], `${name}: parts`).map((v, i) => obj(v, `${name}: parts[${i}]`));
      const fixturesPart = parts.filter((p) => p['part'] === 'fixtures');
      if (fixturesPart.length !== 1) failures.push(`${name}: the kit ran no fixtures part (parts ${JSON.stringify(parts.map((p) => p['part']))})`);
      for (const p of fixturesPart) {
        for (const c of arr(p['cases'] ?? [], `${name}: fixtures cases`).map((v, i) => obj(v, `${name}: fixtures cases[${i}]`))) {
          if (c['verdict'] !== 'PASS') failures.push(`${name}: fixtures case ${String(c['case'])} is ${String(c['verdict'])}: ${JSON.stringify(c).slice(0, 600)}`);
        }
        if (p['verdict'] !== 'PASS') failures.push(`${name}: the fixtures part is ${String(p['verdict'])}: ${JSON.stringify(p['failures'] ?? []).slice(0, 600)}`);
      }
      if (m['verdict'] !== 'PASS') failures.push(`${name}: the kit's verdict is ${String(m['verdict'])}: ${JSON.stringify([...arr(m['failures'] ?? [], 'failures'), ...parts.flatMap((p) => arr(p['failures'] ?? [], 'failures'))].slice(0, 3))}`);
    }
    expect(failures, 'the kit passes the record and sheet modules and every case of their fixtures').toEqual([]);
    expect(kit!['verdict'], 'the kit\'s verdict over the two modules').toBe('PASS');
  }, 1_200_000);
});

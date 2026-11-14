// #1417.e58ee238: "The fixture `layered` board passes, with its layout unchanged byte for byte".
//
// The graph module's own `layered` fixture, as the shipped `full` build of `deep-show` registers it (`fixtures`): the
// kit's run of the graph module passes, every case on that fixture with it, and the board passes the check through
// `deep_show`; and its graph@1 item's layout, from `deep-graph layout` on the item's own params, is the base's memory
// byte for byte (fixtures/layered-layout.json, recorded at the base: README).
import { describe, expect, it } from 'vitest';
import {
  arr, checked, issuesOf, kitCall, kitFailures, kitModule, obj, readJson, show, showRun, spawn, str, useEvidence, useGraph, useShowBuilds,
  type JsonObject, type JsonValue,
} from './helpers.ts';

const ID = '#1417.e58ee238';
const build = useShowBuilds([['full']]);
const graph = useGraph('debug');
const evidence = useEvidence();
const FIXTURE = /(^|\/)graph\/layered\.board$/;

function layeredBoard(bin: string): JsonObject {
  const [reply] = showRun(bin, { evidence: evidence(), calls: [{ call: 'fixtures' }] });
  const list = arr(reply!['fixtures'], 'fixtures').map((f, i) => obj(f, `fixtures[${i}]`));
  const f = list.find((x) => x['module'] === 'graph' && x['name'] === 'layered');
  expect(f, `the graph module registers the fixture layered: ${show(list.map((x) => `${String(x['module'])}/${String(x['name'])}`), 800)}`).toBeDefined();
  return obj(f!['document'], 'layered: document');
}

describe(`${ID} the layered fixture board`, () => {
  it(`${ID} passes: the graph module's kit passes, every case on layered with it, and the board passes the check`, () => {
    const bin = build(['full']);
    const [kit] = showRun(bin, { evidence: evidence(), calls: [kitCall(['graph'])] });
    const m = kitModule(kit!, 'graph');
    const cases = m.parts.flatMap((p) => p.cases.filter((c) => typeof c['fixture'] === 'string' && FIXTURE.test(c['fixture'])).map((c) => ({ part: p.part, c })));
    expect(cases.length, 'the kit ran cases on the layered fixture').toBeGreaterThan(0);
    for (const { part, c } of cases) expect(c['verdict'], `${part} ${String(c['case'])} passes: ${show(c, 600)}`).toBe('PASS');
    expect(m.verdict, `the graph module passes its kit: ${show(kitFailures(m).slice(0, 5), 1500)}`).toBe('PASS');

    const reply = checked(bin, evidence(), '01JB1417000000000000000002', layeredBoard(bin));
    expect(issuesOf(reply, 'layered').filter((i) => i['severity'] === 'error'), 'the board raises no error at check').toEqual([]);
    expect(reply['outcome'], `the layered board passes the check: ${show(reply, 1500)}`).toBe('presented');
  }, 7_200_000);

  it(`${ID} its layout is the base's, byte for byte`, () => {
    const golden = readJson('fixtures/layered-layout.json');
    const doc = layeredBoard(build(['full']));
    const items = obj(doc['items'], 'layered: items');
    const item = obj(items[str(golden['item'], 'golden: item')], `layered: items.${String(golden['item'])}`);
    expect(item['kind'], 'the item is a graph').toBe('graph@1');
    const params = obj(item['params'], 'the graph item: params');
    // One line to the crate's own layout; the memory compared exactly as the answer line spells it, not as parsed numbers.
    const r = spawn(graph(), ['layout'], `${JSON.stringify({ graph: params['graph']!, layout: params['layout']! })}\n`);
    expect(r.status, `deep-graph layout exits 0: ${r.stderr.slice(0, 1000)}`).toBe(0);
    const answer = obj(JSON.parse(r.stdout) as JsonValue, 'the layout answer');
    expect(answer['ok'], `the layout of the layered board is accepted: ${show(answer)}`).toBe(true);
    const raw = /"memory":(\{[^}]*\})/.exec(r.stdout);
    expect(raw, `the answer line carries a memory object: ${r.stdout.slice(0, 600)}`).not.toBeNull();
    console.log(`${ID}: the layered board's layout memory: ${raw![1]}`);
    expect(raw![1], 'the layered board\'s layout memory, byte for byte the base\'s').toBe(str(golden['memory'], 'golden: memory'));
  }, 3_600_000);
});


// Criterion 2: "Opening the eases as ease@1 leaves every content key, golden and corpus snapshot of the shipped
// fixtures byte for byte the same, and deep://registries lists ease@1 with since, digest, fill, each entry's origin
// and its kit result; a planted opening that renumbers the entries changes the key of a channel keyed with
// in_out_cubic and fails, naming the ease and the item"
//
// Through `deep-show run` in the `full` build, the planted `full,test-ease-renumbered` build (README: Test features)
// and the merge base's `full` build (exported by `git archive` and built apart, as #200's suite does). The listing
// is read first, so a build without ease@1 never reaches the merge base's build. "Shipped fixtures" are every fixture
// the merge base's `fixtures` call lists, plus this suite's board whose items are keyed with in_out_cubic, out_back,
// sigmoid(6) and smoothstep. For each, at 0, 0.5 and 1 s: every `eval` node's content key and the bytes it wrote
// ("golden", as #200 reads it), and `corpus_record`'s values and snapshots ("corpus snapshot"), byte for byte. A
// failure on a node names the item and the eases its channels' keys use. No upstream test (oracle page).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DIGEST, DOC, EASES, FIXTURES, TIMEOUT, arr, baseShow, failsNaming, isObject, none, obj, present, runShow, scenario, show, str, theRegistry,
  useEvidence, useShow, type JsonObject, type PackFixture,
} from './helpers.ts';

const FULL = 'full';
const RENUMBERED = 'full,test-ease-renumbered';
const shows = useShow([FULL, RENUMBERED]);
const evidence = useEvidence();
const EPACK: PackFixture = { id: 'test/epack', version: '1.0.0', dir: join(FIXTURES, 'packs', 'epack-1.0.0') };

const easeKey = (name: string, params?: number): JsonObject => ({ t: '0s', value: 16, interp: { ease: params === undefined ? { name } : { name, params } } });
/** This suite's board: four boxes, each slid by a channel whose first key names one closed ease. */
const EASE_BOARD: JsonObject = {
  format: 1, profile: 'board', title: 'Eased boxes', description: 'Four boxes slid by channels keyed with closed eases, for the #490 suite.', size: [320, 200],
  transport: { span: '1s' },
  items: Object.fromEntries(['knob', 'lean', 'soft', 'step'].map((id, i) => [id, { id, kind: 'rect@1', name: `Box ${id}`, order: `a${i}`, params: { box: [0, 0, 20, 20], paint: { fill: { role: 'ink' } } }, at: { pos: [16, 20 + 40 * i, 0] } }])),
  channels: {
    knob_x: { target: 'items/knob/at/pos/0', type: 'f32', keys: { k0: easeKey('in_out_cubic'), k1: { t: '1s', value: 260, interp: 'linear' } } },
    lean_x: { target: 'items/lean/at/pos/0', type: 'f32', keys: { k0: easeKey('out_back'), k1: { t: '1s', value: 260, interp: 'linear' } } },
    soft_x: { target: 'items/soft/at/pos/0', type: 'f32', keys: { k0: easeKey('sigmoid', 6), k1: { t: '1s', value: 260, interp: 'linear' } } },
    step_x: { target: 'items/step/at/pos/0', type: 'f32', keys: { k0: easeKey('smoothstep'), k1: { t: '1s', value: 260, interp: 'linear' } } },
  },
};
const TIMES = ['0s', '0.5s', '1s'];

interface Captured { name: string; document: JsonObject; nodes: Map<string, { key: string; result: string }>; corpus: string }
/** The base's shipped fixtures and this suite's board, each presented, evaluated at TIMES and corpus-recorded, in one build. */
function capture(bin: string, docs: { name: string; document: JsonObject }[]): Captured[] {
  return docs.map((d, n) => {
    const corpusDir = join(evidence(), `corpus-${n}`);
    const replies = runShow(bin, scenario(evidence(), [
      present(DOC.a, d.document),
      ...TIMES.map((t) => ({ call: 'eval', doc: DOC.a, t })),
      { call: 'corpus_record', corpus: corpusDir, name: `doc${n}`, document: d.document, times: TIMES },
    ]));
    expect(replies[0]!['outcome'], `${d.name} is presented: ${show(replies[0])}`).toBe('presented');
    const nodes = new Map<string, { key: string; result: string }>();
    TIMES.forEach((t, k) => {
      for (const [i, v] of arr(replies[1 + k]!['nodes'], `${d.name} at ${t}: nodes`).entries()) {
        const o = obj(v, `${d.name} at ${t}: nodes[${i}]`);
        nodes.set(`${t}|${str(o['operator'], 'operator')}|${o['item'] === null ? '-' : String(o['item'])}`, { key: str(o['key'], 'key'), result: str(o['result'], 'result') });
      }
    });
    const file = str(replies[1 + TIMES.length]!['file'], `${d.name}: corpus_record's file`);
    const written = obj(JSON.parse(readFileSync(file, 'utf8')) as JsonObject, `${d.name}: the corpus file`);
    return { name: d.name, document: d.document, nodes, corpus: JSON.stringify({ values: written['values'], snapshots: written['snapshots'] }) };
  });
}
/** The eases an item's channels name in their keys, by item ID. */
function easesOf(doc: JsonObject): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const channels = isObject(doc['channels']) ? doc['channels'] : {};
  for (const c of Object.values(channels)) {
    if (!isObject(c) || typeof c['target'] !== 'string' || !isObject(c['keys'])) continue;
    const item = /^items\/([^/]+)\//.exec(c['target'])?.[1];
    if (!item) continue;
    for (const k of Object.values(c['keys'])) {
      const e = isObject(k) && isObject(k['interp']) ? k['interp']['ease'] : undefined;
      const name = isObject(e) && typeof e['name'] === 'string' ? e['name'] : undefined;
      if (name) out.set(item, [...(out.get(item) ?? []), name]);
    }
  }
  return out;
}
/** Every node, written byte and corpus value of `before` is the same in `after`; a node's failure names its item and that item's eases. */
function openingFailures(before: Captured[], after: Captured[]): string[] {
  const failures: string[] = [];
  for (const b of before) {
    const a = after.find((x) => x.name === b.name);
    if (!a) { failures.push(`${b.name} is missing`); continue; }
    if (b.nodes.size === 0) failures.push(`${b.name}: the earlier build evaluated no nodes`);
    const eases = easesOf(b.document);
    for (const [node, was] of b.nodes) {
      const now = a.nodes.get(node);
      const item = node.split('|')[2]!;
      const named = `${(eases.get(item) ?? []).map((e) => `ease ${e}: `).join('')}item ${item}`;
      if (!now) failures.push(`${b.name}: ${named}: node ${node} is gone`);
      else if (now.key !== was.key) failures.push(`${b.name}: ${named}: node ${node}'s content key changed from ${was.key} to ${now.key}`);
      else if (now.result !== was.result) failures.push(`${b.name}: ${named}: node ${node} wrote other bytes (${was.result} → ${now.result})`);
    }
    if (a.corpus !== b.corpus) failures.push(`${b.name}: its corpus values or snapshots changed`);
  }
  return failures;
}
/** The shipped fixtures, as the merge base's build lists them, and this suite's board. */
function shipped(baseBin: string): { name: string; document: JsonObject }[] {
  const [f] = runShow(baseBin, scenario(evidence(), [{ call: 'fixtures' }]));
  const fixtures = arr(f!['fixtures'], 'the merge base\'s fixtures').map((x, i) => obj(x, `fixtures[${i}]`));
  expect(fixtures.length, 'the merge base ships fixtures').toBeGreaterThan(0);
  return [...fixtures.map((x) => ({ name: `${String(x['module'])}/${String(x['name'])}`, document: obj(x['document'], 'fixture document') })), { name: 'the eased board', document: EASE_BOARD }];
}

describe('criterion 2: opening the eases as ease@1 changes no content key, golden or corpus snapshot, and deep://registries lists it', () => {
  it('criterion 2: deep://registries lists ease@1 with since, digest and fill, each closed ease the core\'s first-party entry with its kit result, and a pack\'s ease table with origin pack', () => {
    const bin = shows.bin(FULL);
    const r = theRegistry(runShow(bin, scenario(evidence(), [{ call: 'registries' }], [EPACK]))[0]!, 'ease@1');
    expect(r.owner, 'ease@1 is declared by the core').toBe('core');
    expect(r.since, `ease@1 has its since: ${show(r.raw)}`).toMatch(/^R\d+$/);
    expect(r.digest, 'ease@1 has its digest').toMatch(DIGEST);
    expect(r.fill, 'the core fills it and packs fill it').toContain('pack');
    const failures: string[] = [];
    for (const name of EASES) {
      const e = r.entries.find((x) => x.name === name);
      if (!e) { failures.push(`ease@1 holds no entry ${name}`); continue; }
      if (e.origin !== 'first_party') failures.push(`${name}'s origin is ${e.origin}, not first_party`);
      if (e.module !== 'core') failures.push(`${name} is filled by ${e.module ?? 'nothing'}, not the core`);
      if (!/^R\d+$/.test(e.since)) failures.push(`${name} has no since: ${show(e.raw)}`);
      if (!DIGEST.test(e.digest)) failures.push(`${name} has no digest: ${show(e.raw)}`);
      if (e.kit.verdict !== 'PASS') failures.push(`${name} fails ease@1's kit: ${show(e.kit.raw)}`);
      for (const rule of r.kit) if (!e.kit.rules.some((x) => x.rule === rule.rule && x.verdict === 'PASS')) failures.push(`${name}'s kit result has no PASS for the rule ${rule.rule}`);
    }
    const dip = r.entries.find((x) => x.name === 'epack.dip');
    if (!dip) failures.push('ease@1 lists no entry epack.dip from the installed pack test/epack');
    else {
      if (dip.origin !== 'pack') failures.push(`epack.dip's origin is ${dip.origin}, not pack`);
      if (dip.kit.verdict !== 'PASS') failures.push(`epack.dip fails ease@1's kit: ${show(dip.kit.raw)}`);
    }
    if (r.planted.length === 0) failures.push('ease@1 declares no planted wrong entry');
    for (const p of r.planted) if (p.result.verdict !== 'FAIL') failures.push(`ease@1's kit admits its planted entry ${p.name}`);
    none(failures, 'the listing of ease@1');
  }, TIMEOUT);

  it('criterion 2: every content key, written byte and corpus value and snapshot of the shipped fixtures and the eased board equals the merge base\'s', () => {
    const bin = shows.bin(FULL);
    theRegistry(runShow(bin, scenario(evidence(), [{ call: 'registries' }]))[0]!, 'ease@1');
    const base = baseShow(FULL);
    const docs = shipped(base.bin);
    none(openingFailures(capture(base.bin, docs), capture(bin, docs)), `the opening against the merge base ${base.sha.slice(0, 12)}`);
  }, TIMEOUT);

  it('criterion 2: a planted opening that renumbers the entries changes the key of the channel keyed with in_out_cubic and fails, naming the ease and the item', () => {
    const bin = shows.bin(RENUMBERED);
    const base = baseShow(FULL);
    const docs = shipped(base.bin);
    failsNaming(openingFailures(capture(base.bin, docs), capture(bin, docs)), ['ease in_out_cubic', 'item knob'], 'the renumbering opening');
  }, TIMEOUT);
});

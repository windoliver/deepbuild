// The issue's proof: two scripted agents co-authoring one document, with the history shown.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, ASALPHA, BRAVO, CLI_BRAVO, DOC, P, W, WRITER, arr, arrow, create, expectValidPatched, isObject, item, node, num, obj, outcome, patch,
  patchedData, read, record, send, set, show, shown, sorted, str, strs, useBinaries, useFolders, world, writerOf, type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence, state } = useFolders();

const COST = ['cpu_ms', 'gpu_ms', 'vertices', 'lights', 'gpu_mb'];
const history = (id: string): JsonObject => ({ call: 'history', doc: DOC.board, item: id });

describe('Proof: two scripted agents co-authoring one document, with the history shown', () => {
  it('alpha (MCP) draws two nodes, bravo (`deep show` in its tree) links them, each edits its own; the history and the by-writer lens show who made what, the record holds one doc.patched per change, and both layers are on screen', () => {
    const script: JsonObject[] = [
      send(ASALPHA, patch(P(1), 0, [create(node('alpha.api', 'API', [260, 40])), create(node('alpha.db', 'Database', [260, 200]))], DOC.board, 'draw the two services')),
      send(CLI_BRAVO, patch(P(2), 1, [create(arrow('~1', 'API link', 'alpha.api')), create(arrow('bravo.link', 'Database link', 'alpha.db'))], DOC.board, 'link them')),
      send(ASALPHA, patch(P(3), 2, [set('alpha.db', 'items/alpha.db/at/pos', [260, 240, 0])], DOC.board, 'make room for the label')),
      send(CLI_BRAVO, patch(P(4), 3, [set('bravo.link', 'items/bravo.link/params/d', 'M120 24 L200 64')], DOC.board, 'follow the database')),
      read(),
      { call: 'by_writer', doc: DOC.board },
      history('alpha.db'),
      history('bravo.link'),
      { call: 'screen' },
    ];
    const r = show(world(evidence(), script, { state: state() })).replies;
    expect(r.slice(0, 4).map(outcome), 'all four patches apply').toEqual(['applied', 'applied', 'applied', 'applied']);

    // Patch results: what they achieved, the temporary ID's real ID, the cost change and the undo.
    const ach = obj(r[0]!['achieved'], 'alpha\'s first result: achieved');
    expect(ach, 'alpha\'s first patch created two rects').toEqual({ created: { 'rect@1': 2 }, updated: 0, deleted: {}, unchanged: false });
    expect(r[3]!['achieved'], 'bravo\'s edit updated one item').toEqual({ created: {}, updated: 1, deleted: {}, unchanged: false });
    const tempId = str(obj(r[1]!['ids'], 'bravo\'s result: ids')['~1'], 'the real ID of bravo\'s ~1');
    expect(tempId, 'a real ID, not the temporary one').not.toBe('~1');
    for (const [i, reply] of r.slice(0, 4).entries()) {
      const cost = obj(reply['cost_delta'], `result ${i + 1}: cost_delta`);
      for (const k of COST) num(cost[k], `result ${i + 1}: cost_delta.${k}`);
      expect(arr(reply['undo'], `result ${i + 1}: undo`).length, `result ${i + 1} carries its inverse ops`).toBeGreaterThan(0);
    }

    const doc = shown(r[4]!).document;
    for (const id of ['alpha.api', 'alpha.db']) expect(writerOf(doc, id), `${id} is alpha's`).toBe(W.alpha);
    for (const id of [tempId, 'bravo.link']) expect(writerOf(doc, id), `${id} is bravo's`).toBe(W.bravo);
    expect(item(doc, tempId)?.['parent'], 'the temporary-ID arrow is parented to alpha\'s API node').toBe('alpha.api');

    // The by-writer lens.
    const lens = arr(r[5]!['writers'], 'by_writer: writers').map((w, i) => obj(w, `writers[${i}]`));
    const of = (w: { kind: string; id: string }): JsonObject | undefined => lens.find((l) => isObject(l['writer']) && l['writer']['kind'] === w.kind && l['writer']['id'] === w.id);
    expect(sorted(strs(of(WRITER.alpha)?.['items'], 'alpha\'s items')), 'alpha made the two nodes').toEqual(['alpha.api', 'alpha.db']);
    expect(strs(of(WRITER.alpha)?.['patches'], 'alpha\'s patches'), 'in patches 1 and 3').toEqual([P(1), P(3)]);
    expect(sorted(strs(of(WRITER.bravo)?.['items'], 'bravo\'s items')), 'bravo made the two arrows').toEqual(sorted([tempId, 'bravo.link']));
    expect(strs(of(WRITER.bravo)?.['patches'], 'bravo\'s patches'), 'in patches 2 and 4').toEqual([P(2), P(4)]);
    expect(sorted(strs(of(WRITER.you)?.['items'], 'your items')), 'your nodes are yours').toEqual(['you.n1', 'you.n2']);

    // Each item's history.
    const rows = (reply: JsonObject): JsonObject[] => arr(reply['history'], 'history').map((h, i) => {
      const o = obj(h, `history[${i}]`);
      return { rev: num(o['rev'], 'rev'), patch: str(o['patch'], 'patch'), writer: obj(o['writer'], 'writer'), reason: str(o['reason'], 'reason') };
    });
    expect(rows(r[6]!), 'the database node\'s history: alpha drew it, then moved it').toEqual([
      { rev: 1, patch: P(1), writer: WRITER.alpha, reason: 'draw the two services' },
      { rev: 3, patch: P(3), writer: WRITER.alpha, reason: 'make room for the label' },
    ]);
    expect(rows(r[7]!), 'the link\'s history: bravo drew it, then bent it').toEqual([
      { rev: 2, patch: P(2), writer: WRITER.bravo, reason: 'link them' },
      { rev: 4, patch: P(4), writer: WRITER.bravo, reason: 'follow the database' },
    ]);

    // The record: one doc.patched per change, with its writer and session.
    const logged = record(state());
    expectValidPatched(logged);
    expect(logged.map((l) => [patchedData(l)['patch'], patchedData(l)['rev'], patchedData(l)['writer'], l.session]), 'one doc.patched per change, in order').toEqual([
      [P(1), 1, 'agent', ALPHA.id], [P(2), 2, 'agent', BRAVO.id], [P(3), 3, 'agent', ALPHA.id], [P(4), 4, 'agent', BRAVO.id],
    ]);
    expect(patchedData(logged[0]!)['achieved'], 'each event carries what its patch achieved').toEqual(ach);
    expect(logged.every((l) => patchedData(l)['doc'] === `doc:${DOC.board}`), 'each names the document').toBe(true);

    // Both agents' layers on screen, each outlined with its name.
    const bands = arr(r[8]!['bands'], 'screen: bands').map((b, i) => obj(b, `bands[${i}]`)).filter((b) => b['band'] === 'agent');
    expect(sorted(bands.map((b) => String(b['name']))), 'both agent layers are on screen, named').toEqual(sorted([ALPHA.name, BRAVO.name]));
    expect(bands.every((b) => b['outline'] === true), 'each outlined').toBe(true);
  });
});

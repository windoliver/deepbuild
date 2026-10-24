// AC1 two agents' layers merge cleanly, by stable ID; AC7 order keys for siblings inserted at one spot.
import { describe, expect, it } from 'vitest';
import {
  ASALPHA, ASBRAVO, CANVAS, DOC, P, PANELS, PROCESSES, SESSIONS, W, arr, arrow, canonical, canvas, create, expectBadInput, fixture, isObject,
  item, items, node, obj, outcome, patch, posOf, read, reorderAfter, send, show, shown, sorted, str, ulid, useBinaries, useFolders, world, writerOf,
  type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence } = useFolders();

const A = patch(P(1), 0, [create(node('alpha.api', 'API', [260, 40])), create(arrow('alpha.link', 'API link', 'alpha.api'))]);
const B = patch(P(2), 0, [create(node('bravo.db', 'Database', [260, 200])), create(arrow('bravo.link', 'Database link', 'bravo.db'))]);

describe('AC1 two agents editing different layers merge cleanly', () => {
  it('AC1 two agents\' patches on one base, in each other\'s layer\'s absence, both apply in either arrival order, to one revision hash, each change in its writer\'s layer', () => {
    const ab = show(world(evidence(), [read(), send(ASALPHA, A), send(ASBRAVO, B), read()])).replies;
    const ba = show(world(evidence(), [read(), send(ASBRAVO, B), send(ASALPHA, A), read()])).replies;
    for (const [name, r] of [['alpha then bravo', ab], ['bravo then alpha', ba]] as const) {
      expect([outcome(r[1]!), outcome(r[2]!)], `${name}: both patches apply (the second's stale base rebases: no ID it touches changed)`).toEqual(['applied', 'applied']);
      const doc = shown(r[3]!).document;
      for (const id of ['alpha.api', 'alpha.link']) expect(writerOf(doc, id), `${name}: ${id} is in alpha's layer`).toBe(W.alpha);
      for (const id of ['bravo.db', 'bravo.link']) expect(writerOf(doc, id), `${name}: ${id} is in bravo's layer`).toBe(W.bravo);
      const seed = items(fixture('board.json'));
      for (const id of ['you.n1', 'you.n2']) expect(item(doc, id), `${name}: your ${id} is as it was`).toEqual(seed[id]);
      expect(posOf(doc, 'alpha.api'), `${name}: alpha's node is where alpha put it`).toEqual([260, 40, 0]);
      expect(posOf(doc, 'bravo.db'), `${name}: bravo's node is where bravo put it`).toEqual([260, 200, 0]);
      expect(shown(r[3]!).hash, `${name}: the shown hash is the canonical document's`).toBe(canonical(doc).sha256);
    }
    expect(shown(ab[3]!).hash, 'either arrival order gives one revision hash').toBe(shown(ba[3]!).hash);
  });

  it('AC1 the kernel\'s merge by ID of the two writers\' documents from one base is clean, symmetric, and the hub\'s revision; one item both changed is a conflict naming it, never a lost change', () => {
    const ab = show(world(evidence(), [read(), send(ASALPHA, A), read(), send(ASBRAVO, B), read()])).replies;
    const ba = show(world(evidence(), [send(ASBRAVO, B), read()])).replies;
    const base = shown(ab[0]!).document;
    const a = shown(ab[2]!).document;
    const b = shown(ba[1]!).document;
    const both = shown(ab[4]!);
    const ours = canvas('merge', { base, a, b });
    const theirs = canvas('merge', { base, a: b, b: a });
    expect(ours['outcome'], 'the two layers\' edits merge cleanly').toBe('merged');
    expect(theirs['outcome'], 'in either order').toBe('merged');
    expect(str(ours['hash'], 'merge: hash'), 'merge(a, b) and merge(b, a) give one hash').toBe(str(theirs['hash'], 'merge: hash'));
    expect(ours['hash'], 'the merge is the revision the hub made from both patches').toBe(both.hash);
    expect(canonical(obj(ours['doc'], 'merge: doc')).sha256, 'the merged document hashes to the merge\'s hash').toBe(ours['hash']);
    expect(sorted(Object.keys(items(obj(ours['doc'], 'merge: doc')))), 'the union by ID: your nodes and both agents\' items').toEqual(sorted(['you.n1', 'you.n2', 'alpha.api', 'alpha.link', 'bravo.db', 'bravo.link']));

    // Both sides changed your node, differently: no merge picks one and drops the other's change.
    const moved = (doc: JsonObject, x: number): JsonObject => {
      const out = JSON.parse(JSON.stringify(doc)) as JsonObject;
      obj(obj(items(out)['you.n1'], 'you.n1')['at'], 'you.n1.at')['pos'] = [x, 40, 0];
      return out;
    };
    const clash = canvas('merge', { base, a: moved(a, 300), b: moved(b, 500) });
    expect(clash['outcome'], 'one item changed two ways is a conflict, not a merge that loses a writer\'s change').toBe('conflict');
    const ids = arr(clash['conflicts'], 'merge: conflicts').map((c, i) => str(obj(c, `conflicts[${i}]`)['id'], `conflicts[${i}].id`));
    expect(ids, 'the conflict names the item').toContain('you.n1');
  });

  it('deep-canvas merge answers bad_input to a line it can\'t read, and to one with no a or b', () => {
    expectBadInput(CANVAS, 'merge', { base: fixture('board.json') });
  });
});

describe('AC7 two writers inserting siblings at one spot get distinct order keys seeded from writer and patch, and the merge orders them the same on every machine', () => {
  // Each inserts a node of its own between your n1 (a0) and n2 (a1): created with no key, then placed after n1.
  const insert = (id: string, n: number, doc: string = DOC.board): JsonObject =>
    patch(P(n), 0, [create(node(id, id, [300, 120], null)), reorderAfter(id, 'you.n1')], doc);
  const keyOf = (doc: JsonObject, id: string): string => str(item(doc, id)?.['order'], `${id}'s order key`);
  /** Top-level items in draw order among siblings: by order key, ties by ID, each compared by code point. */
  const siblings = (doc: JsonObject): string[] => Object.entries(items(doc))
    .filter(([, v]) => isObject(v) && (v['parent'] ?? null) === null)
    .map(([id, v]) => [id, String((v as JsonObject)['order'])] as const)
    .sort(([ia, ka], [ib, kb]) => (ka < kb ? -1 : ka > kb ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0))
    .map(([id]) => id);

  it('AC7 alpha\'s and bravo\'s inserts after your n1 get distinct base-62 keys between n1\'s and n2\'s; both arrival orders and a replay give the same keys, the same sibling order and one revision hash', () => {
    const runs = [
      [send(ASALPHA, insert('alpha.mid', 1)), send(ASBRAVO, insert('bravo.mid', 2)), read()],
      [send(ASBRAVO, insert('bravo.mid', 2)), send(ASALPHA, insert('alpha.mid', 1)), read()],
      [send(ASALPHA, insert('alpha.mid', 1)), send(ASBRAVO, insert('bravo.mid', 2)), read()],
    ].map((calls) => show(world(evidence(), calls)).replies);
    for (const [i, r] of runs.entries()) expect([outcome(r[0]!), outcome(r[1]!)], `run ${i + 1}: both inserts apply`).toEqual(['applied', 'applied']);
    const docs = runs.map((r) => shown(r[2]!).document);
    const [ka, kb] = [keyOf(docs[0]!, 'alpha.mid'), keyOf(docs[0]!, 'bravo.mid')];
    expect(ka, 'the two writers\' keys are distinct').not.toBe(kb);
    for (const k of [ka, kb]) {
      expect(k, `${k} is a base-62 fractional key`).toMatch(/^[0-9A-Za-z]+$/);
      expect('a0' < k && k < 'a1', `${k} falls between n1's key a0 and n2's key a1`).toBe(true);
    }
    for (const [i, doc] of docs.entries()) {
      expect([keyOf(doc, 'alpha.mid'), keyOf(doc, 'bravo.mid')], `run ${i + 1} gives the same keys`).toEqual([ka, kb]);
      expect(siblings(doc), `run ${i + 1} orders the siblings the same`).toEqual(siblings(docs[0]!));
    }
    expect(siblings(docs[0]!).filter((id) => id !== 'alpha.mid' && id !== 'bravo.mid'), 'your nodes keep their places').toEqual(['you.n1', 'you.n2']);
    expect(siblings(docs[0]!).indexOf('you.n2'), 'both inserts sit between n1 and n2').toBe(3);
    expect(new Set(runs.map((r) => shown(r[2]!).hash)).size, 'one revision hash in every run').toBe(1);
  });

  it('AC7 the jitter is seeded from the writer and the patch: the same insert under four patch IDs, by alpha and by bravo, does not give one key', () => {
    // One run per writer, so no hub sees a patch ID twice; four boards each, one insert on each.
    const keys = [ASALPHA, ASBRAVO].map((who) => {
      const docs: JsonObject = {};
      const calls: JsonObject[] = [];
      for (let k = 0; k < 4; k++) {
        const doc = ulid('01JB96D', 100 + k);
        docs[doc] = { panel: 'main', document: fixture('board.json') };
        calls.push(send(who, insert('shared.mid', 50 + k, doc)), read(doc));
      }
      const replies = show({ evidence: evidence(), sessions: SESSIONS, processes: PROCESSES, panels: PANELS, docs, calls }).replies;
      return [0, 1, 2, 3].map((k) => {
        expect(outcome(replies[2 * k]!), `${String(who['session'])}: insert ${k + 1} applies`).toBe('applied');
        return keyOf(shown(replies[2 * k + 1]!).document, 'shared.mid');
      });
    });
    expect(new Set(keys[0]).size, `alpha's keys under four patch IDs are not all one key: ${keys[0]!.join(', ')}`).toBeGreaterThan(1);
    expect(keys[0]!.some((k, i) => k !== keys[1]![i]), `alpha's and bravo's keys under the same patch IDs are not all the same: ${JSON.stringify(keys)}`).toBe(true);
  });
});

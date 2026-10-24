// AC4 an item of a kind this build doesn't know survives other writers' patches byte for byte, and a patch
// that targets it is refused with unknown_kind. AC5 a document requires the lowest minor of each kind its
// fields use, so one that uses no new field opens in the previous release.
import { describe, expect, it } from 'vitest';
import {
  ASALPHA, ASBRAVO, CLI_YOU, P, arr, arrow, canvas, codes, create, del, fixture, item, items, obj, outcome, patch, read,
  send, set, show, shown, sorted, str, strs, useBinaries, useFolders, world, type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence } = useFolders();

const SCENE = 'parity/kernel/unknown-kind-roundtrip.scene.json';
const GIZMO = obj(items(fixture(SCENE))['bravo.gizmo'], 'the fixture\'s gizmo');

describe('AC4 an item of a kind this build doesn\'t know survives other writers\' patches byte for byte, and a patch that targets it is refused with unknown_kind (parity/kernel/unknown-kind-roundtrip.scene)', () => {
  it('AC4 bravo\'s acme.gizmo@2 is kept byte for byte through your patch and alpha\'s, each of which applies', () => {
    const calls = [
      read(),
      send(CLI_YOU, patch(P(1), 0, [set('you.n1', 'items/you.n1/at/pos', [200, 40, 0])])), read(),
      send(ASALPHA, patch(P(2), 1, [create(arrow('alpha.to-n1', 'Arrow to node 1', 'you.n1'))])), read(),
    ];
    const r = show(world(evidence(), calls, {}, fixture(SCENE))).replies;
    expect([outcome(r[1]!), outcome(r[3]!)], 'both other writers\' patches apply').toEqual(['applied', 'applied']);
    for (const i of [0, 2, 4]) {
      const doc = shown(r[i]!).document;
      expect(item(doc, 'bravo.gizmo'), `read ${i / 2 + 1}: the gizmo is exactly as the newer release saved it`).toStrictEqual(GIZMO);
    }
    const bytes = (i: number): string => JSON.stringify(item(shown(r[i]!).document, 'bravo.gizmo'));
    expect(bytes(4), 'its JSON text, key order included, is unchanged').toBe(bytes(0));
  });

  it('AC4 a patch that targets the unknown item, its own writer\'s or yours, set or delete, is refused with unknown_kind and changes nothing', () => {
    const targeting = [
      send(ASBRAVO, patch(P(1), 0, [set('bravo.gizmo', 'items/bravo.gizmo/params/teeth', 14)])),
      send(ASBRAVO, patch(P(2), 0, [del('bravo.gizmo')])),
      send(CLI_YOU, patch(P(3), 0, [set('bravo.gizmo', 'items/bravo.gizmo/at/pos', [0, 0, 0])])),
    ];
    const r = show(world(evidence(), [read(), ...targeting, read()], {}, fixture(SCENE))).replies;
    for (const [i, what] of ['bravo\'s set', 'bravo\'s delete', 'your set'].entries()) {
      expect(outcome(r[i + 1]!), `${what} on the unknown item is refused`).toBe('refused');
      expect(codes(r[i + 1]!), `${what} is refused with unknown_kind`).toContain('unknown_kind');
    }
    expect(shown(r[4]!).hash, 'the document is unchanged').toBe(shown(r[0]!).hash);
    expect(item(shown(r[4]!).document, 'bravo.gizmo'), 'the gizmo is as saved').toStrictEqual(GIZMO);
  });
});

describe('AC5 a document requires the lowest minor of each kind its fields use, so a document that uses no new field opens in the previous release', () => {
  // test.slab is registered at 3.1 in this build; `corner` arrived in minor 1. The previous release had 3.0.
  const DOC0: JsonObject = {
    format: 1, id: 'slabs', profile: 'board', title: 'Slabs', description: 'Two slabs, one writer.', size: [640, 360],
    layers: { main: { writer: 'you:you', title: 'You', order: 'a0' } }, items: {},
  };
  const slab = (id: string, order: string, params: JsonObject): JsonObject => ({ id, kind: 'test.slab@3', name: id, order, params });
  const p = (n: number, ops: JsonObject[]): JsonObject => ({ patch: P(n), doc: 'slabs', base: n - 1, reason: 'slabs', ops });
  const apply = (doc: JsonObject, patches: JsonObject[]): JsonObject => {
    const out = canvas('apply', { doc, writer: 'you:you', patches });
    expect(out['outcome'], `the patches apply: ${JSON.stringify(out['issues'])}`).toBe('applied');
    return obj(out['doc'], 'apply: doc');
  };
  /** The `requires.kinds` entries for test.slab. */
  const slabMinors = (doc: JsonObject): string[] => {
    const requires = doc['requires'];
    const kinds = requires && typeof requires === 'object' && !Array.isArray(requires) ? strs(requires['kinds'] ?? [], 'requires.kinds') : [];
    return kinds.filter((k) => k.startsWith('test.slab@'));
  };
  const created = (): JsonObject => apply(DOC0, [p(1, [{ op: 'create', item: slab('s1', 'a0', { width: 5 }) }, { op: 'create', item: slab('s2', 'a1', { label: 'two' }) }])]);

  it('AC5 slabs that use no minor-1 field require test.slab@3.0; setting corner requires 3.1; unsetting it goes back to 3.0; a stale 3.1 is lowered', () => {
    const plain = created();
    expect(slabMinors(plain), 'no slab uses corner: the document requires test.slab@3.0, not the build\'s 3.1').toEqual(['test.slab@3.0']);
    const cornered = apply(plain, [p(2, [{ op: 'set', id: 's1', path: 'items/s1/params/corner', value: 2 }])]);
    expect(slabMinors(cornered), 's1 uses corner, a minor-1 field: test.slab@3.1').toEqual(['test.slab@3.1']);
    const back = apply(cornered, [p(3, [{ op: 'unset', id: 's1', path: 'items/s1/params/corner' }])]);
    expect(slabMinors(back), 'with corner gone, back to test.slab@3.0').toEqual(['test.slab@3.0']);
    const stale = apply({ ...plain, requires: { kinds: ['test.slab@3.1'] } }, [p(2, [{ op: 'set', id: 's2', path: 'items/s2/params/label', value: 'second' }])]);
    expect(slabMinors(stale), 'a document saved requiring 3.1 that uses no minor-1 field is written requiring 3.0').toEqual(['test.slab@3.0']);
  });

  it('AC5 the document that uses no new field opens in the previous release (a build with test.slab at 3.0) with no issue and no notice; the one that uses corner still opens there, corner skipped with a notice', () => {
    const plain = created();
    const opened = canvas('check', { doc: plain, as_build: ['test.slab@3.0'] });
    expect(opened['ok'], 'it opens in the previous release').toBe(true);
    expect(opened['issues'], 'with no issue').toEqual([]);
    expect(opened['notices'], 'and no notice').toEqual([]);
    expect(sorted(strs(opened['draws'], 'draws')), 'both slabs draw').toEqual(['s1', 's2']);
    const cornered = apply(plain, [p(2, [{ op: 'set', id: 's1', path: 'items/s1/params/corner', value: 2 }])]);
    const older = canvas('check', { doc: cornered, as_build: ['test.slab@3.0'] });
    expect(older['ok'], 'the cornered document opens there too').toBe(true);
    const notices = arr(older['notices'], 'notices').map((n, i) => obj(n, `notices[${i}]`));
    expect(notices.some((n) => n['code'] === 'unknown_field' && str(n['path'], 'path') === 'items/s1/params/corner'), `corner is skipped with an unknown_field notice: ${JSON.stringify(notices)}`).toBe(true);
    const now = canvas('check', { doc: cornered });
    expect([now['ok'], now['notices']], 'and this build, at 3.1, reads corner with no notice').toEqual([true, []]);
  });
});

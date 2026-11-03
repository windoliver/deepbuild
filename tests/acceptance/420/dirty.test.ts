// AC8: "For every schema path of every scene3d and building kind, a patch changing only that path followed by one
// frame equals a clean rebuild by hash; a planted kind that maps a rebuild-class param to shading fails, naming
// the path"
//
// The `kinds` call lists every kind with its schema, its dirty map (path → dirty class), a fixture document holding
// one item of the kind, and for every path a `[from, to]` pair of valid values. For each scene3d and building kind
// and each of its paths, one session: the fixture with the path at `from` is shown and a frame evaluated; a
// revision that differs only at that path (`to`) is shown and one frame evaluated; then the same revision is
// evaluated clean (#387's `clean: true`: every node runs, nothing from the cache or the epochs). The incremental
// frame must have the clean frame's nodes with the same result hashes, and the change must show (some node's
// result differs from the frame at `from`, so a missed rebuild can't hide). Coverage: the kinds the issue names are
// listed, every param of each kind's schema has a path in the sweep, and every dirty-map path is swept. The planted
// `slab_size_as_shading` maps slab@1's `params/size` (a rebuild-class param) to shading, and must fail, naming
// slab@1 and params/size.

import { describe, expect, it } from 'vitest';
import {
  AC, KINDS, REGISTRY, admitted, canon, clone, docId, evalCall, failsNaming, isObject, kindsOf, nodesOf, none, obj, registryKinds,
  runShow, scenario, setPath, show, useBins, useDir, type JsonObject, type JsonValue, type KindRow, type Node, type ShowPlanted,
} from './helpers.ts';

const bins = useBins(['deep-show']);
const dir = useDir();

/** The kinds this issue adds (Builder; Building module; Curve; Modifier's curve), beside #378's marks. */
const BUILDERS = ['slab@1', 'lathe@1', 'extrude@1', 'tube@1', 'ball@1', 'coil@1', 'plate@1', 'display@1'];
const BUILDING = ['arch.wall@1', 'arch.opening@1', 'arch.slab@1', 'arch.roof@1', 'arch.stair@1', 'arch.zone@1', 'arch.level@1', 'arch.guard_rail@1'];
const CLASSES = ['transform', 'geometry', 'shading', 'presence', 'text', 'reading', 'time'];

function listed(): { kinds: KindRow[]; modules: Record<string, string> } {
  const [reg, kinds] = runShow(bins.bin('deep-show'), scenario(dir(), [], [REGISTRY, KINDS]));
  return { kinds: kindsOf(kinds!), modules: registryKinds(reg!) };
}

/** The fixture's document with the item's `path` set to `value`. */
function withValue(row: KindRow, path: string, value: JsonValue): JsonObject {
  const doc = clone(row.fixture!.document);
  const item = obj(obj(doc['items'], `${row.kind}'s fixture items`)[row.fixture!.item], `${row.kind}'s fixture item`);
  setPath(item, path, clone(value));
  return doc;
}

const results = (nodes: Node[]): Map<string, string> => new Map(nodes.map((n) => [`${n.operator}|${n.item ?? ''}`, n.result]));

/** One kind's sweep: for each path, the frame after a one-path revision against a clean rebuild. Failures name the kind and the path. */
function sweepProblems(row: KindRow, paths: string[], planted?: ShowPlanted): string[] {
  const docs = paths.map((_, i) => docId(i + 1));
  const calls: JsonObject[] = [];
  paths.forEach((path, i) => {
    const [from, to] = row.sweep[path]!;
    calls.push(show(docs[i]!, withValue(row, path, from)), evalCall(docs[i]!, '0s'), show(docs[i]!, withValue(row, path, to)), evalCall(docs[i]!, '0s'), evalCall(docs[i]!, '0s', true));
  });
  const replies = runShow(bins.bin('deep-show'), scenario(dir(), docs, calls, planted ? { planted } : {}));
  const out: string[] = [];
  paths.forEach((path, i) => {
    const [shownFrom, atFrom, shownTo, patched, clean] = replies.slice(5 * i, 5 * i + 5);
    const where = `${row.kind} ${path}`;
    admitted(shownFrom!, `${where}: the fixture at from`);
    admitted(shownTo!, `${where}: the revision at to`);
    const before = results(nodesOf(atFrom!, `${where}: the frame at from`));
    const after = results(nodesOf(patched!, `${where}: the frame after the revision`));
    const fresh = results(nodesOf(clean!, `${where}: the clean rebuild`));
    for (const [node, result] of fresh) {
      const got = after.get(node);
      if (got === undefined) out.push(`${where}: the frame after a revision changing only ${path} has no node ${node.replace('|', ' on ')}, which the clean rebuild has`);
      else if (got !== result) out.push(`${where}: after a revision changing only ${path}, ${node.replace('|', ' on ')} wrote ${got.slice(0, 12)}, but a clean rebuild writes ${result.slice(0, 12)}`);
    }
    for (const node of after.keys()) if (!fresh.has(node)) out.push(`${where}: the frame after the revision has a node ${node.replace('|', ' on ')} the clean rebuild doesn't`);
    if (canon(Object.fromEntries(before)) === canon(Object.fromEntries(fresh))) out.push(`${where}: changing ${path} from ${canon(row.sweep[path]![0])} to ${canon(row.sweep[path]![1])} changes no node's result, so the sweep can't see a missed rebuild`);
  });
  return out;
}

describe(`${AC[8]} every schema path of every scene3d and building kind: a one-path revision and one frame equal a clean rebuild`, () => {
  it(`${AC[8]} the kinds call lists every scene3d and building kind the issue adds, each with a fixture and a sweep over every param and every dirty-map path`, () => {
    const { kinds, modules } = listed();
    for (const k of BUILDERS) expect(modules[k], `${k} is registered by scene3d`).toBe('scene3d');
    for (const k of BUILDING) expect(modules[k], `${k} is registered by the building module`).toBe('building');
    const ours = kinds.filter((k) => k.module === 'scene3d' || k.module === 'building');
    expect(ours.map((k) => k.kind).sort(), 'the kinds call lists the same scene3d and building kinds as the registry').toEqual(Object.keys(modules).filter((k) => modules[k] === 'scene3d' || modules[k] === 'building').sort());
    const problems: string[] = [];
    for (const row of ours) {
      if (!row.fixture) { problems.push(`${row.kind}: no fixture`); continue; }
      if (!isObject(obj(row.fixture.document['items'], `${row.kind}: fixture items`)[row.fixture.item])) problems.push(`${row.kind}: its fixture holds no item ${row.fixture.item}`);
      const paths = Object.keys(row.sweep);
      for (const param of Object.keys(row.params)) if (!paths.some((p) => p === `params/${param}` || p.startsWith(`params/${param}/`))) problems.push(`${row.kind}: param ${param} has no path in the sweep`);
      for (const path of Object.keys(row.dirty)) if (!(path in row.sweep)) problems.push(`${row.kind}: dirty-map path ${path} isn't swept`);
      for (const [path, cls] of Object.entries(row.dirty)) if (!CLASSES.includes(cls)) problems.push(`${row.kind}: ${path} has dirty class ${cls}, not one of ${CLASSES.join(', ')}`);
      for (const [path, [from, to]] of Object.entries(row.sweep)) if (canon(from) === canon(to)) problems.push(`${row.kind}: ${path} sweeps from and to one value`);
    }
    none(problems, 'the kinds\' sweeps');
    const slab = ours.find((k) => k.kind === 'slab@1');
    expect(slab?.params['size']?.['cost'], 'slab@1\'s size is a rebuild-class param').toBe('rebuild');
    expect(slab?.dirty['params/size'], 'slab@1 maps params/size to geometry').toBe('geometry');
  }, 900_000);

  it(`${AC[8]} for every path of every scene3d and building kind, a revision changing only that path and one frame equal a clean rebuild, node by node, by hash`, () => {
    const { kinds } = listed();
    const ours = kinds.filter((k) => (k.module === 'scene3d' || k.module === 'building') && k.fixture !== null);
    expect(ours.length, 'there are kinds to sweep').toBeGreaterThan(BUILDERS.length + BUILDING.length - 1);
    const problems = ours.flatMap((row) => sweepProblems(row, Object.keys(row.sweep)));
    none(problems, 'one-path revisions against clean rebuilds');
  }, 3_600_000);

  it(`${AC[8]} the planted slab_size_as_shading (slab@1 maps its rebuild-class size to shading) fails the sweep, naming slab@1 and params/size`, () => {
    const { kinds } = listed();
    const slab = kinds.find((k) => k.kind === 'slab@1');
    expect(slab?.fixture, 'slab@1 has a fixture').toBeTruthy();
    expect('params/size' in (slab?.sweep ?? {}), 'slab@1 sweeps params/size').toBe(true);
    failsNaming(sweepProblems(slab!, ['params/size'], 'slab_size_as_shading'), ['slab@1', 'params/size'], 'the planted slab_size_as_shading');
  }, 900_000);
});


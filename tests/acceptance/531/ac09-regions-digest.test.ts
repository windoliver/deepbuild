// Criterion 9 (no upstream test): "A program that exports `regions_digest` equal to its item's layout digest passes
// check; one built against the same item before a second control was added to its reads, which moves every later
// read, exports another digest and is refused at check, naming the first entry whose offset differs; a program that
// exports none passes as before; and a planted check that compares only the regions' total sizes admits a program
// built for the same reads in another order and fails, naming the entry"
//
// Through `deep-logic check` (README: deep-logic, Layouts). The item `aim` reads controls and `src.level`, another
// logic item's array (f64 × 4). v1 reads [c1, src.level]; v2, the same item once a second control was added,
// [c1, c2, src.level], which moves src.level and the seed; v3 reads v1's reads in another order, [src.level, c1].
// A program learns its item's layout digest from `check` (as from `deep_query`) and exports it; a check names the
// entry that moved from the layouts it has computed for the item before (the item's history): within one
// `deep-logic` process, every layout an earlier `check` computed. So each process first checks v1, v2 and v3 with a
// program that exports no digest, then the programs that export one.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, admitted, checkCall, logicBin, onMac, piece, prebuild, refusedOf, show, type JsonObject, type LogicPlanted, type Program } from './helpers.ts';
import { aim, levels } from './programs.ts';

prebuild(() => { logicBin(); });

const READS = { v1: ['c1', 'src.level'], v2: ['c1', 'c2', 'src.level'], v3: ['src.level', 'c1'] } as const;
type Version = keyof typeof READS;
const aimPiece = (v: Version, p: Program): JsonObject => piece({
  seed: 531_09, controls: ['c1', 'c2'],
  items: { src: { program: levels(), writes: { level: { type: 'f64', count: 4 } } }, aim: { program: p, reads: [...READS[v]], writes: { hit: { type: 'i32' } } } },
});
const VERSIONS: Version[] = ['v1', 'v2', 'v3'];
/** The layout digests `check` gives aim at v1, v2 and v3 (with a program that exports no digest), in a process of its own. */
function digests(planted?: LogicPlanted): Record<Version, string> {
  const out = onMac(VERSIONS.map((v) => checkCall(aimPiece(v, aim()))), planted);
  return Object.fromEntries(VERSIONS.map((v, i) => [v, admitted(out[i]!, `aim at ${v} with no regions_digest`)['aim']!.layout.digest])) as Record<Version, string>;
}
/** In one process: v1, v2 and v3 checked with no digest (the item's history), then each call of `then`. */
const history = (then: JsonObject[], planted?: LogicPlanted): JsonObject[] =>
  onMac([...VERSIONS.map((v) => checkCall(aimPiece(v, aim()))), ...then], planted).slice(VERSIONS.length);
const entryNamed = (r: JsonObject): JsonObject | null => {
  const e = r['entry'];
  return typeof e === 'object' && e !== null && !Array.isArray(e) ? e : null;
};

describe(`${AC[9]} check compares a program's regions_digest with its item's layout digest`, () => {
  it(`${AC[9]} a program exporting its item's layout digest passes check, and one exporting none passes as before`, () => {
    const d = digests();
    expect(new Set(Object.values(d)).size, `the three layouts have three digests: ${show(d as unknown as JsonObject)}`).toBe(3);
    const [plain, own] = history([checkCall(aimPiece('v2', aim())), checkCall(aimPiece('v2', aim(d.v2)))]);
    expect(admitted(plain!, 'aim at v2, no regions_digest')['aim']!.layout.digest, 'a program that exports no digest passes as before').toBe(d.v2);
    expect(admitted(own!, 'aim at v2, exporting v2\'s digest')['aim']!.layout.digest, 'a program exporting its item\'s digest passes check').toBe(d.v2);
  }, TIMEOUT);

  it(`${AC[9]} a program built before c2 was added to the reads exports another digest and is refused, naming the first entry whose offset differs`, () => {
    const d = digests();
    const [stale] = history([checkCall(aimPiece('v2', aim(d.v1)))]);
    const r = refusedOf(stale!, 'aim at v2 with a program built for v1');
    expect([r.code, r.item], 'refused by the logic module\'s check, naming the item').toEqual(['logic_refused', 'aim']);
    const named = r.refusals.map(entryNamed).filter((e) => e !== null);
    expect(named.length, `a refusal names the entry: ${show(r.refusals)}`).toBeGreaterThan(0);
    // c2 has no offset in v1's layout and src.level moved: the first entry whose offset differs is either (README: Readings).
    expect(named.some((e) => e['region'] === 'reads' && (e['name'] === 'c2' || e['name'] === 'src.level')), `the refusal names c2 or src.level, the first read whose offset differs: ${show(named)}`).toBe(true);
    expect(named.some((e) => e['name'] === 'c1'), 'c1, which didn\'t move, isn\'t named').toBe(false);
  }, TIMEOUT);

  it(`${AC[9]} a planted check that compares only the regions' total sizes (digest_compares_total_sizes) admits a program built for the same reads in another order and fails, naming the entry`, () => {
    const real = history([checkCall(aimPiece('v1', aim(digests().v3)))])[0]!;
    const r = refusedOf(real, 'aim at v1 with a program built for v3 (the same reads in another order)');
    expect(r.refusals.map(entryNamed).some((e) => e?.['region'] === 'reads' && e['name'] === 'c1'), `the shipped check names c1, the first entry whose offset differs: ${show(r.refusals)}`).toBe(true);
    const twinDigests = digests('digest_compares_total_sizes');
    const twin = history([checkCall(aimPiece('v1', aim(twinDigests.v3)))], 'digest_compares_total_sizes')[0]!;
    const failures = twin['ok'] === true ? ['entry c1: the planted check admits a program whose reads are in another order (c1 sits at another offset)'] : [];
    expect(failures, 'the planted check fails, naming the entry').toEqual(['entry c1: the planted check admits a program whose reads are in another order (c1 sits at another offset)']);
  }, TIMEOUT);
});

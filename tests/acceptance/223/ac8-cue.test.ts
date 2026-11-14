// AC8 #223.7ab209fd: "A `warp` cue over a group with `linear {matrix: [[1, 1], [0, 1]]}` keys the warp's mix from 0 to 1
// inside the cue's span and ends on the sheared grid within 0.5 px, and the verb passes the cue kit; a planted `warp`
// verb whose last key lands one flick past its span is refused by the kit, naming the verb"
//
// The film (640 × 360, 2 s, naming the first-party verbs pack `deepbuild/verbs@1.0.0`, offered to the scenario as
// #222's suite offers it): group `g` on the plane of origin (320, 180) u, unit 100 u, y up, warped by `linear {matrix:
// [[1, 1], [0, 1]]}` at `mix: 0`; its child `grid`, the path fn grid x [270, 370, 10], y [130, 230, 10] (11 × 11
// lines over the plane's [−0.5, 0.5]²); and the cue list `list` (`cues@1`) holding one cue, `{id: "shear", kind:
// "warp", targets: ["g"], params: {warp: "g"}, span: "1s"}` (README: The warp verb).
// On `deep-show run` (full set): the film is presented with no error; the expansion of `list` (#222's `expansions`
// reading) writes the marker `cues.shear` over [0, 1 s], and the cue's channels include one on
// `items/g/params/warp/mix`, every key of them inside [0, 1 s]; `eval` reads that mix 0 at the cue's start and 1 at
// its end (within 1e-9); and deep-show's `path` of `grid` at the cue's end lies within 0.5 u (px at zoom 1) of the
// grid sheared, (x, y) ↦ (x + y, y) in the plane, both ways. deep://registries lists `warp` in `cue.kind@1` with
// origin `first_party` and a PASSing kit, each of its five rules PASS (#222's rules).
// The planted entry: `cue.kind@1`'s `planted` list holds an entry named `warp`, the warp verb whose last key lands one
// flick past its span; its kit result FAILs, its rule `inside_span` FAILs, and that failure's message names `warp`.
// Wrong programs: the base (no `warp` verb in the pack: the film's cue is unresolved and the film refused); a verb that
// keys the mix outside its span or not to 1; a mix keyed on another path; a kit that admits the planted entry.
import { describe, expect, it } from 'vitest';
import {
  AC, KIT_RULES, TIMEOUT, VERBS_AT, VERBS_PACK, arr, bothWays, docId, evalAt, figure, fl, flicksOf, gridItem, gridLines, imageOf, isObject, kitOf,
  mat, mentions, none, num, obj, onScreen, planeJson, present, presented, registryRow, run, scenario, shellFilm, showPathCall, showSubpaths,
  showTime, str, useBins, useFolders, valuesOf, warpGroup, type JsonObject, type Plane,
} from './helpers.ts';

const bin = useBins(['show']);
const folder = useFolders();
const DOC = docId(8);
const CUE_KINDS = 'cue.kind@1';
const MIX = 'items/g/params/warp/mix';
const CUE_PLANE: Plane = { origin: [320, 180], unit: 100, y: 'up' };
const X: [number, number, number] = [270, 370, 10];
const Y: [number, number, number] = [130, 230, 10];
const sheared = onScreen(CUE_PLANE, (q) => mat([[1, 1], [0, 1]], q));

const FILM: JsonObject = {
  ...shellFilm(figure('warp-cue', [640, 360], [
    warpGroup('g', { linear: { matrix: [[1, 1], [0, 1]] }, mix: 0, plane: planeJson(CUE_PLANE) }),
    gridItem('grid', 'a1', X, Y, 1, { parent: 'g' }),
  ], { transport: { span: '2s' } })),
};
obj(FILM['items'], 'the film items')['list'] = { id: 'list', kind: 'cues@1', name: 'Cue list', order: 'z0', params: { cues: [{ id: 'shear', kind: 'warp', targets: ['g'], params: { warp: 'g' }, span: '1s' }] } };
FILM['packs'] = [VERBS_AT];

/** The cue `shear`'s marker window [t, t + span] and channels in the reply's expansion of `list` (#222's reading). */
function expansion(reply: JsonObject): { marker: [number, number] | null; channels: { target: string; times: number[] }[] } {
  const all = arr(reply['expansions'], 'the deep show reply: expansions').filter(isObject).filter((e) => e['instance'] === 'list');
  expect(all.length, 'the reply expands the cue list list once').toBe(1);
  const m = isObject(all[0]!['markers']) ? all[0]!['markers']['cues.shear'] : undefined;
  const t0 = isObject(m) ? flicksOf(m['t']) : null;
  const span = isObject(m) ? flicksOf(m['span'] ?? 0) : null;
  const channels = Object.entries(obj(all[0]!['channels'], 'the expansion: channels')).filter(([id]) => id === 'list.shear' || id.startsWith('list.shear.')).map(([id, c]) => {
    const co = obj(c, `channels.${id}`);
    const keys = co['keys'];
    const list = Array.isArray(keys) ? keys : isObject(keys) ? Object.values(keys) : [];
    return { target: str(co['target'], `channels.${id}.target`), times: list.map((k) => flicksOf(isObject(k) ? k['t'] : undefined) ?? NaN) };
  });
  return { marker: t0 !== null && span !== null ? [t0, t0 + span] : null, channels };
}

describe(`${AC[8]} the warp cue verb keys the mix inside its span and passes the cue kit`, () => {
  it(`${AC[8]} a warp cue over a group sheared by [[1, 1], [0, 1]] keys its mix from 0 to 1 inside the cue's span, ends on the sheared grid within 0.5 px, and the verb passes the cue kit`, () => {
    const end = fl(1);
    const [registries, shown, atStart, atEnd, drawn] = run(bin('show'), scenario(folder(), [
      { call: 'registries' }, present(DOC, FILM), evalAt(DOC, 0, { paths: [MIX] }), evalAt(DOC, end, { paths: [MIX] }), showPathCall(DOC, 'grid', end),
    ], { packs: [VERBS_PACK] }));
    presented(shown!, 'the film playing the warp cue');
    const e = expansion(shown!);
    expect(e.marker, `the cue writes its marker cues.shear over [0, 1 s]`).toEqual([0, end]);
    expect(e.channels.map((c) => c.target), `the warp cue keys the warp's mix, ${MIX}`).toContain(MIX);
    const outside = e.channels.flatMap((c) => c.times.filter((t) => !(t >= 0 && t <= end)).map((t) => `${c.target} keyed at ${Number.isNaN(t) ? 'an unreadable time' : showTime(t)}`));
    none(outside, 'every key the warp cue writes lies inside its span [0, 1 s]');
    expect(num(valuesOf(atStart!, 'the film at 0')[MIX], 'the mix at the cue\'s start'), 'the mix reads 0 at the cue\'s start').toBeCloseTo(0, 9);
    expect(num(valuesOf(atEnd!, 'the film at 1 s')[MIX], 'the mix at the cue\'s end'), 'the mix reads 1 at the cue\'s end').toBeCloseTo(1, 9);
    none(bothWays(showSubpaths(drawn!, 'the grid at the cue\'s end'), gridLines(X, Y).map((l) => imageOf(l, sheared, 200)), 0.5, 'the grid at the cue\'s end against the sheared grid'),
      'the warp cue ends on the sheared grid within 0.5 px');

    const row = registryRow(registries!, CUE_KINDS);
    const entry = arr(row['entries'], `${CUE_KINDS}: entries`).filter(isObject).find((x) => x['name'] === 'warp');
    expect(entry, `${CUE_KINDS} lists the verb warp`).toBeDefined();
    expect(entry!['origin'], 'warp is a first-party verb').toBe('first_party');
    const kit = kitOf(entry!['kit'], 'warp\'s kit result');
    expect(kit.verdict, `warp passes the cue kit: ${JSON.stringify(kit.raw).slice(0, 600)}`).toBe('PASS');
    for (const rule of KIT_RULES) expect(kit.rules.find((r) => r.rule === rule)?.verdict, `warp passes the cue kit's rule ${rule}`).toBe('PASS');
  }, TIMEOUT);

  it(`${AC[8]} the cue kit refuses a planted warp verb whose last key lands one flick past its span, naming the verb`, () => {
    const [registries] = run(bin('show'), scenario(folder(), [{ call: 'registries' }], { packs: [VERBS_PACK] }));
    const planted = arr(registryRow(registries!, CUE_KINDS)['planted'], `${CUE_KINDS}: planted`).filter(isObject);
    const entry = planted.find((x) => x['name'] === 'warp');
    expect(entry, `${CUE_KINDS} lists a planted entry warp; it lists ${planted.map((x) => String(x['name'])).join(', ') || 'none'}`).toBeDefined();
    const kit = kitOf(entry!['result'], 'the planted warp\'s kit result');
    expect(kit.verdict, `the kit refuses the planted warp: ${JSON.stringify(kit.raw).slice(0, 600)}`).toBe('FAIL');
    const rule = kit.rules.find((r) => r.rule === 'inside_span');
    expect(rule?.verdict, 'the planted warp fails the rule inside_span').toBe('FAIL');
    expect(mentions(rule?.message ?? '', 'warp'), `the inside_span failure names the verb warp: ${JSON.stringify(rule?.message ?? null)}`).toBe(true);
  }, TIMEOUT);
});

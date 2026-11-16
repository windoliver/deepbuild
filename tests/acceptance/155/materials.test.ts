// AC8 #155.ec088f1d: "A film whose collections are bound to paper and metal plays a scrape for each stroke from its
// collection's material, each starting on its stroke occurrence's sample, and seeking to any time plays the same voices;
// a planted spawn that takes the first collection's material for every stroke plays paper on the metal strokes and
// fails, naming the stroke"
//
// A real hub with deepbuild/foley-render; deep-show reads the hub's evidence store and the runs among the scenario's
// `jobs`. The film (Document envelope with Path `path@1` builds that emit, as #466 left them) holds two paths of four
// strokes each, `pencil` in collection `a_sketch` and `wire` in `b_frame`, and binds `foley_materials: {a_sketch:
// "paper", b_frame: "metal"}` (Foley: on the film). Each path's build progress is held in steps (hold keys) so stroke k
// of each `<item>.build` list starts on a flick of its own, between samples: pencil's at 0.5 s + 2k s and wire's at
// 1.5 s + 2k s, plus some thousands of flicks. Two spawns, one per list, play `src: {generator: {job: "foley.scrape",
// output: "variant"}}`, `pick: "by_variant"`, `variant: "2"`, `span: "352800000"` (half a second): a foley job named by
// its action alone takes the material bound to the collection of the occurrence's item *(chosen)*.
//   - foley_plan answers foley.paper.scrape and foley.metal.scrape; both are run with deep_job.
//   - `media_mix` over the film: eight voices, one per stroke, each starting at its stroke's flick; the pencil's play
//     foley.paper.scrape and the wire's foley.metal.scrape, at level 2 (`job` and `output`, README). In the mixed sound
//     each stroke's first 2,400 samples from ⌈t ÷ 14,700⌉ match the variant it names, rendered alone by a strip of that
//     asset, with one gain per channel and a residual under 10⁻⁴ (so on that very sample: a sound one sample off fits
//     far worse), and fit the other material's same variant worse.
//   - Seeking: four seeded windows of 0.6 s, sought to after the whole film is played and asked cold in a run of their
//     own, equal the played samples bit for bit, and the cold run's voices are the played run's.
// The planted spawn `foley_first_collection_material` (scenario `planted`) takes the first bound collection's material,
// paper, for every stroke; the same judge fails it, naming the stroke (`wire.build[k]`). The merge base fails first: no
// foley_plan, no generator source.
import { describe, expect, it } from 'vitest';
import {
  AC, PACK_REF, RATE, SAMPLE, TIMEOUT, VARIANTS, at, deepJob, failsNaming, firstDiff, fitGain, foleyPlanCall, foleyPlanOf, generator, installFoley,
  installedOk, jobArgs, mixCall, mixOf, none, openWorld, pcmOf, playedOf, proof, runShow, sOf, sampleAt, scenario, secs, show, useShow, variantOf,
  variantsOf, type JsonObject, type Line, type Mix, type Pcm, type Planted, type SegmentAsk, type World,
} from './helpers.ts';

const bin = useShow();
const SPAN = secs(9);
const STROKES = 4;
const ITEMS = { pencil: { collection: 'a_sketch', material: 'paper', from: 0.5, offset: 7_000 }, wire: { collection: 'b_frame', material: 'metal', from: 1.5, offset: 3_000 } } as const;
type Item = keyof typeof ITEMS;
const WINDOW = 2400;
/** The master 20 dB down before its limiter (Bus), so the limiter never acts and every path is linear. */
const QUIET: JsonObject = { master: { gain: -20 } };

/** Stroke k of `item` starts at this flick: off the sample grid by `offset + 1,000·k` flicks. */
const strokeAt = (item: Item, k: number): number => secs(ITEMS[item].from + 2 * k) + ITEMS[item].offset + 1_000 * k;

function path(id: Item, order: string): JsonObject {
  const d = Array.from({ length: STROKES }, (_, k) => `M 10 ${10 + 20 * k} L 190 ${10 + 20 * k}`).join(' ');
  return { id, kind: 'path@1', name: id, order, params: { d, build: { progress: 0, emits: true } } };
}
/** The build held at 0, then at (k + ½) ÷ 4 from stroke k's flick, then 1: stroke k is first past k ÷ 4 at its flick. */
function progress(id: Item): JsonObject {
  const keys: JsonObject = { k0: { t: 0, value: 0, interp: 'hold' } };
  for (let k = 0; k < STROKES; k++) keys[`k${k + 1}`] = { t: strokeAt(id, k), value: (k + 0.5) / STROKES, interp: 'hold' };
  keys['end'] = { t: strokeAt(id, STROKES - 1) + secs(0.6), value: 1, interp: 'hold' };
  return { target: `items/${id}/params/build/progress`, type: 'f32', keys };
}
const scrape = (list: string): JsonObject => ({
  on: { list }, play: { src: generator('foley.scrape', 'variant') }, pick: 'by_variant', variant: '2', round_robin: 'hash', span: '352800000', cooldown: 0, seed: 155,
});
function film(): JsonObject {
  return {
    format: 1, id: 'foley-strokes', profile: 'film', title: 'Strokes with foley', description: 'Two paths drawn stroke by stroke, bound to paper and metal, for the #155 acceptance tests.',
    size: [200, 100], transport: { sample_rate: RATE, span: SPAN }, packs: [PACK_REF],
    items: { pencil: path('pencil', 'a1'), wire: path('wire', 'a2') },
    channels: { pencil_build: progress('pencil'), wire_build: progress('wire') },
    collections: { [ITEMS.pencil.collection]: { members: ['pencil'] }, [ITEMS.wire.collection]: { members: ['wire'] } },
    foley_materials: { [ITEMS.pencil.collection]: ITEMS.pencil.material, [ITEMS.wire.collection]: ITEMS.wire.material },
    strips: {}, buses: QUIET,
    spawns: { scrape_pencil: scrape('pencil.build'), scrape_wire: scrape('wire.build') },
  };
}

interface Rendered { w: World; replies: Line[]; variants: Record<string, Record<string, string>> }
async function rendered(): Promise<Rendered> {
  const w = await openWorld({ foley: true });
  const [installed, planned] = runShow(bin(), scenario(w.evidence, [installFoley(), foleyPlanCall(film())]), 'the strokes film planned');
  installedOk(installed, 'install_pack of deepbuild/foley');
  const plan = foleyPlanOf(planned, 'foley_plan of the strokes film');
  const replies: Line[] = [];
  const variants: Record<string, Record<string, string>> = {};
  for (const m of ['paper', 'metal']) {
    const id = `foley.${m}.scrape`;
    expect(Object.keys(plan), `foley_plan answers the job ${id}, the scrape of a bound material`).toContain(id);
    const o = await deepJob(w, jobArgs(plan[id]!));
    variants[id] = variantsOf(o, `the run of ${id}`);
    replies.push(o.value);
  }
  return { w, replies, variants };
}

/** Every variant of both scrapes rendered alone, each by a strip of its asset playing 0.1 s, a quarter second apart,
 * through the same quiet master: the reference windows. */
function solos(r: Rendered): Record<string, Float32Array[]> {
  const ids = Object.entries(r.variants).flatMap(([job, v]) => VARIANTS.map((o) => ({ key: `${job}/${o}`, sha: v[o]! })));
  const gap = RATE / 4;
  const strips = Object.fromEntries(ids.map((x, i) => [`s${i}`, { track: i, src: { asset: x.sha }, start: i * gap * SAMPLE, in: 0, span: secs(0.1) }]));
  const span = secs((ids.length + 1) / 4);
  const asks: SegmentAsk[] = [{ from: 0, to: span, write: true }];
  const [m] = runShow(bin(), scenario(r.w.evidence, [mixCall({ transport: { sample_rate: RATE, span }, buses: QUIET, strips }, asks)]), 'each scrape variant alone');
  const p = pcmOf(r.w.evidence, mixOf(m, asks, 'each scrape variant alone').segments[0]!, 'each scrape variant alone');
  return Object.fromEntries(ids.map((x, i) => [x.key, p.channels.map((c) => c.slice(i * gap, i * gap + WINDOW))]));
}

/** The voices and the sound judged against the strokes; each failure names its stroke. */
function judge(m: Mix, p: Pcm | null, ref: Record<string, Float32Array[]>): string[] {
  const failures: string[] = [];
  if (m.voices.length !== 2 * STROKES) failures.push(`the film starts ${m.voices.length} voices on its ${2 * STROKES} strokes`);
  for (const item of Object.keys(ITEMS) as Item[]) {
    const { material } = ITEMS[item];
    const other = material === 'paper' ? 'metal' : 'paper';
    for (let k = 0; k < STROKES; k++) {
      const t = strokeAt(item, k);
      const name = `${item}.build[${k}] (stroke ${k} of ${item}, at ${sOf(t)})`;
      const v = m.voices.find((x) => x.spawn === `scrape_${item}` && x.occurrence === k);
      if (!v) { failures.push(`${name}: no voice`); continue; }
      if (v.start !== t) failures.push(`${name}: its voice starts at ${v.start} flicks, not its stroke's ${t}`);
      const { job, output } = playedOf(v, name);
      if (job !== `foley.${material}.scrape`) { failures.push(`${name}: plays ${job}, not foley.${material}.scrape, the scrape of its collection's material`); continue; }
      if (variantOf(output)?.level !== 2) failures.push(`${name}: plays ${output}, not a level-2 variant`);
      if (!p) continue;
      const s = sampleAt(t);
      const fit = (key: string) => [0, 1].map((c) => {
        const want = ref[key]?.[c];
        if (!want) return { gain: 0, residual: Number.POSITIVE_INFINITY };
        return fitGain(Array.from({ length: WINDOW }, (_, i) => at(p, c, s + i)), want, 0, WINDOW);
      });
      const mine = fit(`${job}/${output}`);
      const theirs = fit(`foley.${other}.scrape/${output}`);
      if (!mine.every((f) => f.residual < 1e-4 && f.gain > 0.1)) failures.push(`${name}: from sample ${s} the sound isn't ${job}'s ${output} (residuals ${mine.map((f) => f.residual.toExponential(2)).join(', ')}, gains ${mine.map((f) => f.gain.toFixed(3)).join(', ')})`);
      if (!theirs.every((f, c) => f.residual > mine[c]!.residual)) failures.push(`${name}: the sound fits ${other}'s scrape as well as ${material}'s`);
    }
  }
  return failures;
}

function mixFilm(r: Rendered, asks: SegmentAsk[], what: string, planted?: Planted): Mix {
  const [, mixed] = runShow(bin(), scenario(r.w.evidence, [installFoley(), mixCall(film(), asks)], { jobs: r.replies, ...(planted ? { planted } : {}) }), what);
  return mixOf(mixed, asks, what);
}
/** Four windows of 0.6 s at seeded times (mulberry32, seed 155). */
function windows(): number[] {
  let a = 155;
  const next = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return Array.from({ length: 4 }, () => Math.floor(next() * (SPAN - secs(0.6))));
}
const voiceList = (m: Mix): string => JSON.stringify(m.voices.map((v) => [v.spawn, v.occurrence, v.start, v.job, v.output]));

describe(`${AC[8]} a film bound to paper and metal scrapes each stroke in its collection's material, on its sample, the same when sought`, () => {
  it(`${AC[8]} eight strokes: the pencil's scrape paper and the wire's metal, each from its stroke's sample; seeks equal playing with the same voices; the planted first-collection material fails, naming the stroke`, async () => {
    const r = await rendered();
    const ref = solos(r);
    const seeks = windows();
    const asks: SegmentAsk[] = [{ from: 0, to: SPAN, write: true }, ...seeks.map((t) => ({ from: t, to: t + secs(0.6), write: true }))];
    const played = mixFilm(r, asks, 'the strokes film, played then sought into');
    const pcm = pcmOf(r.w.evidence, played.segments[0]!, 'the strokes film, played');
    const clean = judge(played, pcm, ref);
    const seekFailures: string[] = [];
    seeks.forEach((t, i) => {
      const d = firstDiff(pcm, pcmOf(r.w.evidence, played.segments[1 + i]!, `the seek to ${sOf(t)}`));
      if (d !== null) seekFailures.push(`the seek to ${sOf(t)} differs from playing at sample ${d}`);
    });
    const coldAsks: SegmentAsk[] = seeks.map((t) => ({ from: t, to: t + secs(0.6), write: true }));
    const cold = mixFilm(r, coldAsks, 'the strokes film, sought into cold');
    seeks.forEach((t, i) => {
      const d = firstDiff(pcm, pcmOf(r.w.evidence, cold.segments[i]!, `the cold seek to ${sOf(t)}`));
      if (d !== null) seekFailures.push(`the cold seek to ${sOf(t)} differs from playing at sample ${d}`);
    });
    if (voiceList(cold) !== voiceList(played)) seekFailures.push(`the cold seeks' voices differ from playing's: ${voiceList(cold).slice(0, 600)} against ${voiceList(played).slice(0, 600)}`);
    const planted = judge(mixFilm(r, [{ from: 0, to: secs(0.05) }], 'the strokes film (planted foley_first_collection_material)', 'foley_first_collection_material'), null, ref);
    proof('ac8-strokes.json', { strokes: Object.fromEntries((Object.keys(ITEMS) as Item[]).map((i) => [i, Array.from({ length: STROKES }, (_, k) => ({ t: strokeAt(i, k), sample: sampleAt(strokeAt(i, k)) }))])), voices: played.voices.map((v) => v.raw), clean, seeks: seekFailures, planted, samples: SAMPLE });
    none(clean, 'the strokes film');
    expect(seekFailures, `seeking plays the same voices: ${seekFailures.join(' | ')}`).toEqual([]);
    failsNaming(planted, /^wire\.build\[\d\] .*plays foley\.paper\.scrape, not foley\.metal\.scrape/, 'the planted foley_first_collection_material');
    expect(show(planted).includes('pencil.build'), 'the planted spawn still scrapes paper on the pencil, so only the wire\'s strokes fail').toBe(false);
  }, 3 * TIMEOUT);
});

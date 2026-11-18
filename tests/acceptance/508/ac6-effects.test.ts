// AC6: "wave_field, plume, arc and airflow each draw a fixture from their params: seeking to 3 s equals playing to it
// by pixel hash on one machine, and each one's measured cost is within 25% of its declaration on the reference Mac;
// plume and airflow run as presets of particles@1, as sparks does; a planted effect that reads the wall clock differs
// after a seek and fails, naming the effect"
//
// Each effect's fixture is a document at tests/fixtures/figures/effect-<kind>/figure.json holding at least one
// `effect@1` of that kind with its params (README: Surfaces this job invents). In one `deep-gpu run` per effect: the
// fixture played over frames 0 to 90 at 30 fps with `timings: true`, a cold seek (`from`) to frame 90 (3 s), and the
// fixture without its effect items at frame 90. Draws from its params: frame 90 differs from the fixture without the
// effect, and frames 45 and 90 differ (it moves, so a seek can be told from a play). Seek equals play: the seek's
// pixel hash is the played frame 90's. Presets of particles@1: the operators the plume (and the airflow) adds to the
// frame's `passes` are among those a `particles@1` item adds to #380's scene, the sparks the base draws. Cost: each
// effect item's pass, keyed `effect/<item ID>` in `passes_ms` and `declared_ms`, its median measured over its median
// declared within 25% of 1, five runs after a warm-up judged by the perf lane's `judgeLimit`; off a reference Mac at
// rest that part is INCONCLUSIVE, after every other part has been judged. Wrong programs: the base (no such kinds, no
// fixtures: BLOCKED); an effect that draws nothing, moves by a counter or the clock, or costs other than it declares;
// a plume or airflow drawn by its own operator; and `--planted effect_reads_wall_clock`, whose seek must fail, naming
// each effect.
import { describe, expect, it } from 'vitest';
import {
  EFFECT_FIXTURE, EXPLAINERS, TIMEOUT, ac, asSession, assetPaths, drawnOf, effectItems, effectScene, failsNaming, fixture, frameAt,
  inconclusive, judgeLimit, keyedMs, load, lookOf, median, none, requireGpu, runGpu, show, timingProblem, useBins, useDir, view3d, without,
  writeJson, type Drawn, type Explainer, type JsonObject, type Load, type Planted,
} from './helpers.ts';

const bin = useBins();
const dir = useDir();
const FPS = 30;
const LAST = 90;
const MID = 45;
let written = 0;

interface Reading { kind: Explainer; ids: string[]; play: Drawn; seek: Drawn; bare: Drawn }
function reading(kind: Explainer, planted?: Planted): Reading {
  const f = fixture(EFFECT_FIXTURE[kind]);
  const ids = effectItems(f.document, kind).map(([id]) => id);
  const out = dir();
  const look = lookOf(f);
  const doc = writeJson(out, `${kind}-${++written}`, asSession(f.document));
  const bare = writeJson(out, `${kind}-bare-${written}`, asSession(without(f.document, ids)));
  const assets = assetPaths(f);
  const [play, seek, plain] = runGpu(bin('deep-gpu'), out, [
    view3d({ doc, look, size: f.size, fps: FPS, frames: LAST + 1, timings: true, assets }),
    view3d({ doc, look, size: f.size, fps: FPS, from: LAST, frames: 1, assets }),
    view3d({ doc: bare, look, size: f.size, fps: FPS, from: LAST, frames: 1, assets }),
  ], planted);
  return { kind, ids, play: drawnOf(play!, `${kind}: played`), seek: drawnOf(seek!, `${kind}: sought`), bare: drawnOf(plain!, `${kind}: without its effect`) };
}
const opsOf = (d: Drawn): Set<string> => new Set(d.passes.map((p) => p.operator).filter((o): o is string => o !== null));
const added = (withIt: Drawn, without: Drawn): string[] => { const b = opsOf(without); return [...opsOf(withIt)].filter((o) => !b.has(o)); };

/** Draws from its params, seeks as it plays; one sentence per miss, each naming the effect. */
function seekFailures(r: Reading): string[] {
  const failures: string[] = [];
  const k = r.kind;
  if (r.ids.length === 0) return [`${k}: its fixture holds no effect@1 of kind ${k}`];
  const last = frameAt(r.play, LAST, `${k}: played`).pixelHash;
  const sought = frameAt(r.seek, LAST, `${k}: sought`).pixelHash;
  if (!last || last !== sought) failures.push(`${k}: seeking to 3 s (frame ${LAST}) draws ${String(sought)}, playing to it ${String(last)}`);
  if (last === frameAt(r.bare, LAST, `${k}: without its effect`).pixelHash) failures.push(`${k}: frame ${LAST} is the same without its effect items, so it draws nothing`);
  if (last === frameAt(r.play, MID, `${k}: played`).pixelHash) failures.push(`${k}: frames ${MID} and ${LAST} are the same, so it doesn't move and a seek can't be told from a play`);
  return failures;
}
/** Each effect item's median measured pass time over its median declared one. */
function ratios(r: Reading): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const id of r.ids) {
    const key = `effect/${id}`;
    const m = r.play.frames.map((f) => keyedMs(f, 'passes_ms', key)); const d = r.play.frames.map((f) => keyedMs(f, 'declared_ms', key));
    out.set(id, m.some((x) => x === null) || d.some((x) => x === null) ? null : median(m as number[]) / median(d as number[]));
  }
  return out;
}

describe(`${ac(6)} wave_field, plume, arc and airflow draw their fixtures from their params, seek as they play and cost what they declare`, () => {
  it(`${ac(6)} each of wave_field, plume, arc and airflow draws its fixture, seeking to 3 s equals playing by pixel hash, plume and airflow run as presets of particles@1, and each one's measured cost is within 25% of its declaration on the reference Mac`, () => {
    requireGpu();
    const warm = EXPLAINERS.map((k) => reading(k));
    const failures = warm.flatMap(seekFailures);
    // Presets of particles@1: the operators a particles@1 item adds to #380's scene, the sparks the base draws.
    const out = dir();
    const sparks = effectScene('particles'); const plain = effectScene([]);
    const [s1, s0] = runGpu(bin('deep-gpu'), out, [sparks, plain].map((s, i) => view3d({ doc: writeJson(out, `sparks-${i}`, s.doc), look: s.look, size: s.doc['size'] as [number, number], frames: 1 })));
    const particleOps = new Set(added(drawnOf(s1!, 'a particles@1 item'), drawnOf(s0!, 'the scene without it')));
    if (particleOps.size === 0) failures.push(`a particles@1 item adds no operator to the frame's passes: ${show(drawnOf(s1!, 'a particles@1 item').passes)}`);
    for (const r of warm.filter((x) => x.kind === 'plume' || x.kind === 'airflow')) {
      const ops = added(r.play, r.bare);
      if (ops.length === 0 || ops.some((o) => !particleOps.has(o))) failures.push(`${r.kind}: it adds the operators ${show(ops)} to the frame, not particles@1's ${show([...particleOps])}, so it isn't a preset of particles@1`);
    }
    for (const r of warm) for (const [id, v] of ratios(r)) if (v === null) failures.push(`${r.kind}: frames of its fixture don't time effect/${id} in passes_ms with its declared_ms`);
    none(failures, 'the four explainer effects');

    const problem = timingProblem();
    if (problem) inconclusive(`each effect's measured cost against its declaration counts only on a reference Mac at rest: ${problem}`);
    const runs: Reading[][] = []; const loads: Load[] = [];
    for (let k = 0; k < 5; k++) { const start = load(); runs.push(EXPLAINERS.map((e) => reading(e))); loads.push({ start, end: load() }); }
    const judged: [string, JsonObject][] = [];
    for (const [i, kind] of EXPLAINERS.entries()) {
      for (const id of warm[i]!.ids) {
        const off = runs.map((run) => Math.abs((ratios(run[i]!).get(id) ?? Number.POSITIVE_INFINITY) - 1));
        judged.push([`${kind} (effect/${id}): |measured ÷ declared − 1| (at most 0.25)`, judgeLimit(0.25, off, loads)]);
      }
    }
    for (const [name, v] of judged) console.log(`${ac(6)} ${name}: ${String(v['status'])} ${show(v['runs'] ?? null)}${v['reason'] ? ` (${String(v['reason'])})` : ''}`);
    expect(judged.filter(([, v]) => v['status'] === 'FAIL').map(([n, v]) => `${n}: ${show(v)}`), 'no effect costs more than 25% away from its declaration').toEqual([]);
    const open = judged.filter(([, v]) => v['status'] !== 'PASS');
    if (open.length) inconclusive(open.map(([n, v]) => `${n}: ${String(v['status'])} ${String(v['reason'] ?? '')}`).join('; '));
  }, TIMEOUT);

  it(`${ac(6)} a planted effect that reads the wall clock (--planted effect_reads_wall_clock) differs after a seek and fails, naming the effect`, () => {
    requireGpu();
    const failures = EXPLAINERS.flatMap((k) => seekFailures(reading(k, 'effect_reads_wall_clock'))).filter((f) => f.includes('seeking to 3 s'));
    failsNaming(failures, [...EXPLAINERS].map((k) => `${k}: seeking`), 'effect_reads_wall_clock');
  }, TIMEOUT);
});

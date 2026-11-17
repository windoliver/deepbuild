// AC2 #155.c0ec4150: "Over authored moments, markers.moment tagged hit with a speed in each payload, variant picks level
// 3 for a hit at 4 m/s and level 1 at 0.5 m/s, and the round robin never repeats the previous take over 1,000
// occurrences; a planted round robin that picks by hash alone, with no check against the previous take, repeats one
// within them and fails, naming the occurrence"
//
// A real hub with deepbuild/foley-render renders foley.wood.hit (its twelve variants); deep-show reads the hub's
// evidence store and the run among the scenario's `jobs`. The media document pins deepbuild/foley@1.0.0 and holds 1,050
// markers of kind moment, 40 ms apart from 0.1 s: 1,000 tagged `hit` whose payloads carry `speed` (in each run of ten:
// seven at 4 m/s, two at 0.5 m/s, one at 2 m/s) and, every 21st, 50 tagged `whoosh`. One spawn, `hits`, on
// `{list: "markers.moment", tags: ["hit"]}` plays `src: {generator: {job: "foley.wood.hit", output: "variant"}}` with
// `pick: "by_variant"`, `variant: "clamp(1 + floor(speed / 2), 1, 3)"` and `round_robin: "hash"` (Spawn: variant and
// span), no cooldown. Read from `media_mix`'s `voices` (#500's, with each voice's `job` and `output`, README):
//   - 1,000 voices, one on each hit, none on a whoosh; every voice plays foley.wood.hit; level 3 at 4 m/s, level 1 at
//     0.5 m/s (and 2 at 2 m/s, the expression's own);
//   - at each level no voice repeats the take of the level's voice before it; all four takes sound at each level; and
//     level 3's takes are not one fixed cycle (the pick is a hash).
// The planted round robin `round_robin_by_hash_alone` (scenario `planted`) picks hash mod 4 with no check against the
// previous take; the same judge fails it, naming the occurrence that repeats. The merge base fails first: no
// generator source, no markers.moment list.
import { describe, expect, it } from 'vitest';
import {
  AC, PACK_REF, TIMEOUT, deepJob, failsNaming, foleyPlanCall, foleyPlanOf, generator, installFoley, installedOk, jobArgs, mixCall, mixOf, none, openWorld,
  playedOf, proof, runShow, sOf, scenario, secs, useShow, variantOf, variantsOf, type JsonObject, type Mix, type Planted, type SegmentAsk, type World,
} from './helpers.ts';

const bin = useShow();
const JOB = 'foley.wood.hit';
const COUNT = 1050;
const STEP = secs(0.04);
const T0 = secs(0.1);
const SPAN = T0 + COUNT * STEP + secs(2);

interface Moment { id: string; t: number; hit: boolean; speed: number }
function moments(): Moment[] {
  const out: Moment[] = [];
  let h = 0;
  for (let k = 0; k < COUNT; k++) {
    const id = `m${String(k).padStart(4, '0')}`;
    if (k % 21 === 20) { out.push({ id, t: T0 + k * STEP, hit: false, speed: 4 }); continue; }
    const r = h++ % 10;
    out.push({ id, t: T0 + k * STEP, hit: true, speed: r < 7 ? 4 : r < 9 ? 0.5 : 2 });
  }
  return out;
}
const levelFor = (speed: number): number => Math.min(3, Math.max(1, 1 + Math.floor(speed / 2)));

function momentsDoc(list: Moment[]): JsonObject {
  return {
    transport: { sample_rate: 48_000, span: SPAN }, packs: [PACK_REF], strips: {},
    markers: Object.fromEntries(list.map((m) => [m.id, { kind: 'moment', t: m.t, tags: [m.hit ? 'hit' : 'whoosh'], payload: { speed: m.speed } }])),
    spawns: {
      hits: {
        on: { list: 'markers.moment', tags: ['hit'] }, play: { src: generator(JOB, 'variant') },
        pick: 'by_variant', variant: 'clamp(1 + floor(speed / 2), 1, 3)', round_robin: 'hash', cooldown: 0, max_voices: 64, seed: 155,
      },
    },
  };
}

/** The voices judged against the moments; each failure names its occurrence. */
function judge(m: Mix, list: Moment[]): string[] {
  const failures: string[] = [];
  const byT = new Map(list.map((x) => [x.t, x]));
  const hits = list.filter((x) => x.hit);
  if (m.voices.length !== hits.length) failures.push(`the spawn starts ${m.voices.length} voices on ${hits.length} moments tagged hit`);
  const seen = new Set<string>();
  const last = new Map<number, { rr: number; occ: number }>();
  const takes: Record<number, number[]> = { 1: [], 2: [], 3: [] };
  for (const v of [...m.voices].sort((a, b) => a.start - b.start)) {
    const mo = byT.get(v.start);
    const name = `occurrence ${v.occurrence}${mo ? ` (marker ${mo.id} at ${sOf(mo.t)})` : ''}`;
    if (!mo) { failures.push(`${name}: a voice at ${sOf(v.start)}, where no moment is`); continue; }
    if (!mo.hit) { failures.push(`${name}: a voice on a moment tagged whoosh, which the filter leaves out`); continue; }
    seen.add(mo.id);
    const { job, output } = playedOf(v, name);
    const variant = variantOf(output);
    if (job !== JOB || !variant) { failures.push(`${name}: plays ${job}'s ${output}, not one of ${JOB}'s variants`); continue; }
    if (variant.level !== levelFor(mo.speed)) failures.push(`${name}: a hit at ${mo.speed} m/s plays level ${variant.level}, not ${levelFor(mo.speed)}`);
    const prev = last.get(variant.level);
    if (prev && prev.rr === variant.rr) failures.push(`${name}: repeats the take l${variant.level}r${variant.rr} of the level's voice before it (occurrence ${prev.occ})`);
    last.set(variant.level, { rr: variant.rr, occ: v.occurrence });
    takes[variant.level]!.push(variant.rr);
  }
  for (const h of hits) if (!seen.has(h.id)) { failures.push(`marker ${h.id} at ${sOf(h.t)}, tagged hit, starts no voice`); if (failures.length > 40) break; }
  for (const level of [1, 2, 3]) {
    const used = new Set(takes[level]);
    if (used.size !== 4) failures.push(`level ${level} sounds takes ${[...used].sort().join(', ')}, not all four`);
  }
  const t3 = takes[3]!;
  for (const p of [2, 3, 4]) if (t3.length > p && t3.every((r, i) => i < p || r === t3[i - p])) failures.push(`level 3's takes repeat one fixed cycle of ${p}, not a pick by hash`);
  return failures;
}

async function rendered(): Promise<{ w: World; list: Moment[]; doc: JsonObject; reply: JsonObject }> {
  const w = await openWorld({ foley: true });
  const list = moments();
  const doc = momentsDoc(list);
  const [installed, planned] = runShow(bin(), scenario(w.evidence, [installFoley(), foleyPlanCall(doc)]), 'the moments planned');
  installedOk(installed, 'install_pack of deepbuild/foley');
  const plan = foleyPlanOf(planned, 'foley_plan of the moments');
  expect(Object.keys(plan), `foley_plan answers the job ${JOB}`).toContain(JOB);
  const o = await deepJob(w, jobArgs(plan[JOB]!));
  variantsOf(o, `the run of ${JOB}`);
  return { w, list, doc, reply: o.value as JsonObject };
}
const ASKS: SegmentAsk[] = [{ from: 0, to: secs(0.05) }];
function voices(r: { w: World; doc: JsonObject; reply: JsonObject }, planted?: Planted): Mix {
  const [, mixed] = runShow(bin(), scenario(r.w.evidence, [installFoley(), mixCall(r.doc, ASKS)], { jobs: [r.reply], ...(planted ? { planted } : {}) }), `the moments mixed${planted ? ` (planted ${planted})` : ''}`);
  return mixOf(mixed, ASKS, `the moments${planted ? ` (planted ${planted})` : ''}`);
}

describe(`${AC[2]} authored moments pick their level by speed and never repeat the previous take`, () => {
  it(`${AC[2]} 1,000 hits on markers.moment: level 3 at 4 m/s, level 1 at 0.5 m/s, no take repeated after the level's previous one, all four takes heard; the planted round robin by hash alone fails, naming the occurrence`, async () => {
    const r = await rendered();
    const clean = judge(voices(r), r.list);
    const planted = judge(voices(r, 'round_robin_by_hash_alone'), r.list);
    proof('ac2-moments.json', { clean, planted: planted.slice(0, 20) });
    none(clean, 'the round robin over 1,000 authored hits');
    failsNaming(planted, /^occurrence \d+ .*repeats the take/, 'the planted round_robin_by_hash_alone');
  }, 2 * TIMEOUT);
});

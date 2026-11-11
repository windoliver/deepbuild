// AC3 #154.6e31be7c: "Editing one part re-renders one stem, and the other stems are cache hits"
//
// A score of three parts, each its own stem: sampled keys, a plucked string and a synth pad. Every stem is rendered
// once in a fresh hub. Then one part is edited at a time (a plucked note's pitch; then one more keys note), the score is
// planned again and every stem is run again through deep_job: the edited part's stem is a cache miss under a new key
// with new bytes, and each other stem is a cache hit with the key and the outputs it had, its job unchanged. The merge
// base is the wrong program (no score kind, no plan, no score.render).
import { describe, expect, it } from 'vitest';
import { AC, KEYS_FIXTURE, once, plan, pluck, renderAll, sampled, scoreDoc, scoreWorld, show, synth, TIMEOUT, useShow, type Event, type Rendered } from './helpers.ts';

const bin = useShow();
const KEYS = KEYS_FIXTURE();
/** Times are written in seconds; a "beat" here is 0.5 s. */
const atBeat = (x: number): string => `${x / 2}s`;
const n = (beat: number, inst: string, pitch: number, dur = '0.2s'): Event => ({ at: atBeat(beat), inst, pitch, dur, vel: 0.8, attack: 0, release: 0.01 });
function events(edit: { guitarPitch?: number; moreKeys?: boolean } = {}): Record<string, Event> {
  const out: Record<string, Event> = {};
  for (let i = 0; i < 8; i++) out[`k${i}`] = n(1 + i, 'keys', 69);
  for (let i = 0; i < 8; i++) out[`g${i}`] = n(1.5 + i, 'guitar', [57, 60, 64, 62][i % 4]!);
  out.p0 = n(1, 'pad', 60, '3s');
  out.p1 = n(7, 'pad', 64, '3s');
  if (edit.guitarPitch !== undefined) out.g3 = n(4.5, 'guitar', edit.guitarPitch);
  if (edit.moreKeys) out.k8 = n(9, 'keys', 69);
  return out;
}
const doc = (edit: { guitarPitch?: number; moreKeys?: boolean } = {}) => scoreDoc({
  id: 'cache', instruments: { keys: sampled(KEYS, 'keys'), guitar: pluck('nylon', 'guitar'), pad: synth('pad', 'pad') },
  events: events(edit), span: '12s', packs: [KEYS],
});
const world = once(() => scoreWorld([KEYS]));

/** The judge: the edited stem missed under a new key with new bytes; every other stem hit with its old key and outputs. */
function judge(before: Record<string, Rendered>, after: Record<string, Rendered>, edited: string): string[] {
  const failures: string[] = [];
  for (const [name, a] of Object.entries(after)) {
    const b = before[name];
    if (!b) { failures.push(`stem ${name} is new`); continue; }
    if (name === edited) {
      if (a.cache !== 'miss') failures.push(`the edited stem ${name} wasn't re-rendered: cache ${a.cache}`);
      if (a.key === b.key) failures.push(`the edited stem ${name} kept its key ${a.key}`);
      if (a.stem === b.stem) failures.push(`the edited stem ${name} kept its bytes ${a.stem}`);
    } else {
      if (a.cache !== 'hit') failures.push(`stem ${name}, whose part wasn't edited, was re-rendered: cache ${a.cache}`);
      if (a.key !== b.key) failures.push(`stem ${name}'s key moved from ${b.key} to ${a.key} when only ${edited} was edited`);
      if (a.stem !== b.stem || a.meta !== b.meta) failures.push(`stem ${name}'s outputs changed when only ${edited} was edited`);
    }
  }
  return failures;
}

describe(`${AC[3]} editing one part re-renders one stem, and the other stems are cache hits`, () => {
  it(`${AC[3]} a plucked note's pitch edited: only the guitar stem misses; then one more keys note: only the keys stem misses`, async () => {
    const { w, dirs } = await world();
    const first = plan(bin(), w.evidence, doc(), dirs, 'the score');
    expect(Object.keys(first.stems).sort(), 'three stems, one per part').toEqual(['guitar', 'keys', 'pad']);
    const r0 = await renderAll(w, first, 'the score');
    for (const [name, r] of Object.entries(r0)) expect(r.cache, `stem ${name} is rendered on its first run`).toBe('miss');

    const second = plan(bin(), w.evidence, doc({ guitarPitch: 59 }), dirs, 'the score with g3 moved');
    for (const name of ['keys', 'pad']) expect(second.stems[name]?.params, `stem ${name}'s job is unchanged when the guitar part is edited: ${show(second.stems[name]?.params, 300)}`).toEqual(first.stems[name]?.params);
    const r1 = await renderAll(w, second, 'the score with g3 moved');
    expect(judge(r0, r1, 'guitar'), 'after editing the guitar part').toEqual([]);

    const third = plan(bin(), w.evidence, doc({ guitarPitch: 59, moreKeys: true }), dirs, 'the score with k8 added');
    const r2 = await renderAll(w, third, 'the score with k8 added');
    expect(judge(r1, r2, 'keys'), 'after editing the keys part').toEqual([]);
  }, TIMEOUT);
});

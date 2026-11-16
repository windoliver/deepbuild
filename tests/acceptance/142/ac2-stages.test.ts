// AC2 #142.77ca866d: "Moving an example from the 2D stage to the 3D stage changes no cue, time or word, and every
// landing stays on its beat within one frame"
//
// Each of the nine examples with a 3D stage (every recipe but linear_map), as the pack ships it, presented on the 2D
// stage and again with only `params.stage` set to "3d" (README: The examples):
//   - No cue or time changes: every cue of its list has its marker `cues.<id>` in both expansions (README: The
//     expansion), at the same start and the same end, to the flick.
//   - No word changes: the words the expansion draws (every derived item's `params.text`) are the same in both.
//   - Every landing stays on its beat: a landing is an entrance with a word, a cue with `text` whose kind's
//     `cue.kind@1` entry has class `enter` (README: Cues in a film recipe); its word is the one derived item whose
//     `params.text` is the cue's `text`. On each stage, the word's evaluated state (`items/<id>/at`, `adjust` and
//     `params`) is read at every frame from the cue's start to two frames past its end; it lands at the first frame
//     from which the state holds still to the last of those, which must come after the cue's start (an entrance moves
//     its word) and by one frame past its end. The 3D landing is within one frame of the 2D landing.
// The example needs at least one landing, or the criterion reads nothing.
// Wrong programs: the base; a 3D stage that re-times the cues (a glide added before each), drops or rewrites a word,
// or plays the words late; a recipe whose 3D words never settle.
import { describe, it } from 'vitest';
import {
  AC, STAGED_3D, TIMEOUT, brief, classesOf, cueWindow, docId, errors, evalAt, exampleOf, expansionOf, frameOf, itemDrawing, none, onStage, present,
  run, same, scenario, showTime, useFolders, useShow, valuesOf, wordsOf, type JsonObject, type JsonValue, type Rows,
} from './helpers.ts';

const show = useShow();
const folder = useFolders();
const fields = (id: string): string[] => [`items/${id}/at`, `items/${id}/adjust`, `items/${id}/params`];

/** The first frame (index into `states`) from which every state equals the last one. */
function settled(states: JsonValue[]): number {
  let k = states.length - 1;
  while (k > 0 && same(states[k - 1], states[states.length - 1])) k--;
  return k;
}

describe(`${AC[2]} the 3D stage keeps the 2D stage's cues, times, words and landings`, () => {
  it(`${AC[2]} each example moved to the 3D stage keeps every cue's marker, every word, and every landing within one frame`, () => {
    const failures: string[] = [];
    for (const recipe of STAGED_3D) {
      const ex = exampleOf(recipe);
      if (Array.isArray(ex)) { failures.push(...ex); continue; }
      const docs = [onStage(ex.doc, '2d'), onStage(ex.doc, '3d')];
      const [r2, r3, regs] = run(show(), scenario(folder(), [present(docId(1), docs[0]!), present(docId(2), docs[1]!), { call: 'registries' }]));
      const bad = [r2!, r3!].map((r, i) => (r['outcome'] !== 'presented' || errors(r).length ? `${recipe} on the ${i ? '3d' : '2d'} stage: not presented with no error: ${brief(r, 1200)}` : '')).filter(Boolean);
      if (bad.length) { failures.push(...bad); continue; }
      const e: Rows[] = [expansionOf(r2!, ex.instance, `${recipe} 2d`), expansionOf(r3!, ex.instance, `${recipe} 3d`)];
      for (const c of ex.cues) {
        const id = String(c['id']);
        const [w2, w3] = [cueWindow(e[0]!, id, `${recipe} 2d`), cueWindow(e[1]!, id, `${recipe} 3d`)];
        if (w2.start !== w3.start || w2.end !== w3.end) failures.push(`${recipe}: cue ${id} runs ${showTime(w2.start)}–${showTime(w2.end)} on the 2D stage, ${showTime(w3.start)}–${showTime(w3.end)} on the 3D stage`);
      }
      const [words2, words3] = [wordsOf(e[0]!), wordsOf(e[1]!)];
      if (JSON.stringify(words2) !== JSON.stringify(words3)) failures.push(`${recipe}: the 2D stage draws the words ${brief(words2, 400)}, the 3D stage ${brief(words3, 400)}`);

      const classes = classesOf(regs!);
      const landings = ex.cues.filter((c) => typeof c['text'] === 'string' && classes.get(String(c['kind'])) === 'enter');
      if (!landings.length) { failures.push(`${recipe}: its example has no entrance with a word, so no landing to keep`); continue; }
      const frame = frameOf(ex.doc);
      const plan: { cue: string; stage: number; item: string; frames: number[] }[] = [];
      for (const c of landings) {
        const id = String(c['id']);
        const w = cueWindow(e[0]!, id, `${recipe} 2d`);
        const frames: number[] = [];
        for (let k = Math.ceil(w.start / frame); k <= Math.floor(w.end / frame) + 2; k++) frames.push(k * frame);
        for (const s of [0, 1]) {
          const found = itemDrawing(e[s]!, String(c['text']));
          if ('why' in found) failures.push(`${recipe} on the ${s ? '3d' : '2d'} stage, cue ${id}: ${found.why}`);
          else plan.push({ cue: id, stage: s, item: found.id, frames });
        }
      }
      const calls: JsonObject[] = [present(docId(1), docs[0]!), present(docId(2), docs[1]!)];
      const at: number[] = [];
      for (const p of plan) { at.push(calls.length); for (const t of p.frames) calls.push(evalAt(docId(p.stage + 1), t, { paths: fields(p.item) })); }
      const replies = run(show(), scenario(folder(), calls));
      const landed = new Map<string, number>();
      plan.forEach((p, i) => {
        const what = `${recipe} on the ${p.stage ? '3d' : '2d'} stage, cue ${p.cue} (${p.item})`;
        const states = p.frames.map((t, k) => valuesOf(replies[at[i]! + k]!, `${what} at ${showTime(t)}`) as JsonValue);
        const k = settled(states);
        if (k === 0) failures.push(`${what}: its word doesn't change from the cue's start, so it never enters`);
        if (k > p.frames.length - 2) failures.push(`${what}: its word still moves one frame past the cue's end`);
        landed.set(`${p.cue}/${p.stage}`, p.frames[k]!);
      });
      for (const c of landings) {
        const [l2, l3] = [landed.get(`${String(c['id'])}/0`), landed.get(`${String(c['id'])}/1`)];
        if (l2 === undefined || l3 === undefined) continue;
        if (Math.abs(l2 - l3) > frame) failures.push(`${recipe}: cue ${String(c['id'])} lands at ${showTime(l2)} on the 2D stage and at ${showTime(l3)} on the 3D stage, more than one frame apart`);
      }
    }
    none(failures, 'the 3D stage changes no cue, time or word, and every landing stays on its beat');
  }, 4 * TIMEOUT);
});

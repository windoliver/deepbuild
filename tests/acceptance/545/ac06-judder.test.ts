// Criterion 6 (no upstream test): "In a live piece, a 60 Hz logic item that writes a follow camera's position with
// `hold`, read by a shot's `move: logic`, raises `logic.judder` at check, naming the item, the array, the shot, 60 Hz
// and 120 Hz; with `interpolate: linear`, with the brief's `hold: [position]`, or with the item at 120 Hz it raises
// none; the same held array read by an instancer's `pos` column raises it, naming the instancer, while an i32 read by
// an instancer's `proto` raises none; and a planted check that looks only at shots misses the instancer and fails,
// naming it"
//
// Through `deep-logic check` of a piece with `live: true`, its `readers` and its `brief` (README: deep-logic, check
// issues). The camera item `cam` writes `position` (vec3, held unless a case says linear), `target` (vec3, always
// linear, so it never judders), `kind` (i32), `alive` (bool) and `gen` (i32). The shot `follow` reads position and
// target through `move: logic`; the instancer `swarm` reads `pos` from cam.position, `proto` from cam.kind, and its
// required `live` and `gen` columns from cam.alive and cam.gen. A live piece with no displays in its brief is drawn at
// 120 Hz. `judder_checks_shots_only` raises logic.judder for shots' `move: logic` only.
import { describe, it } from 'vitest';
import { AC, TIMEOUT, checkCall, failsNaming, judderOf, logic, logicBin, none, piece, prebuild, type JsonObject, type Judder, type Planted } from './helpers.ts';
import { still } from './programs.ts';

prebuild(() => { logicBin(); });

const SEED = 545_06;
const SHOT: JsonObject = { kind: 'shot', move: { logic: { position: 'cam.position', target: 'cam.target' } } };
const SWARM: JsonObject = {
  kind: 'instance@1',
  columns: { pos: { array: 'cam.position' }, proto: { array: 'cam.kind', as: 'u32' }, live: { array: 'cam.alive', as: 'bool' }, gen: { array: 'cam.gen', as: 'u32' } },
};
interface Case { name: string; position: 'hold' | 'linear'; rate: number; hold?: string[]; swarm?: boolean; want: Judder[] }
const judder = (reader: string): Judder => ({ item: 'cam', array: 'cam.position', reader, step_rate: 60, frame_rate: 120 });
const CASES: Case[] = [
  { name: 'the held position read by the shot', position: 'hold', rate: 60, want: [judder('follow')] },
  { name: 'the position declared linear', position: 'linear', rate: 60, want: [] },
  { name: 'the brief\'s hold: [position]', position: 'hold', rate: 60, hold: ['position'], want: [] },
  { name: 'the item at 120 Hz', position: 'hold', rate: 120, want: [] },
  { name: 'the held position read by the shot and by the instancer swarm, whose proto reads an i32', position: 'hold', rate: 60, swarm: true, want: [judder('follow'), judder('swarm')] },
];
const pieceOf = (c: Case): JsonObject => piece({
  seed: SEED, live: true,
  readers: { follow: SHOT, ...(c.swarm ? { swarm: SWARM } : {}) },
  ...(c.hold ? { brief: { hold: c.hold } } : {}),
  items: {
    cam: {
      program: still(), step_rate: c.rate,
      writes: { position: { type: 'vec3', interpolate: c.position }, target: { type: 'vec3', interpolate: 'linear' }, kind: { type: 'i32' }, alive: { type: 'bool' }, gen: { type: 'i32' } },
    },
  },
});

/** Each case's logic.judder issues against the criterion, each failure naming the case and the reader. */
function judge(planted: Planted[] = []): string[] {
  const replies = logic(CASES.map((c) => checkCall(pieceOf(c))), planted);
  const failures: string[] = [];
  const key = (j: Judder): string => `${j.item} ${j.array} read by ${j.reader}, stepped at ${j.step_rate} Hz and drawn at ${j.frame_rate} Hz`;
  const kindOf = (reader: string): string => (reader === 'swarm' ? 'the instancer swarm' : `the shot ${reader}`);
  CASES.forEach((c, i) => {
    const got = judderOf(replies[i]!, `the check of ${c.name}`).map(key);
    const want = c.want.map(key);
    for (const w of c.want) if (!got.includes(key(w))) failures.push(`${c.name}: logic.judder doesn't name ${kindOf(w.reader)}: ${key(w)}`);
    for (const g of got) if (!want.includes(g)) failures.push(`${c.name}: logic.judder raised ${g}, which the criterion says it doesn't`);
  });
  return failures;
}

describe(`${AC[6]} logic.judder: a held pose drawn faster than its item steps is raised at check, naming the item, the array, the reader and both rates`, () => {
  it(`${AC[6]} the held position read by the shot raises it naming cam, cam.position, follow, 60 Hz and 120 Hz; linear, the brief's hold and 120 Hz raise none; the instancer's pos raises it naming swarm, its i32 proto none`, () => {
    none(judge(), 'logic.judder over the cases');
  }, TIMEOUT);

  it(`${AC[6]} a planted check that looks only at shots (judder_checks_shots_only) misses the instancer and fails, naming it`, () => {
    none(judge(), 'the real check on the same pieces');
    failsNaming(judge(['judder_checks_shots_only']), /logic\.judder doesn't name the instancer swarm: cam cam\.position read by swarm, stepped at 60 Hz and drawn at 120 Hz/, 'the planted check');
  }, TIMEOUT);
});

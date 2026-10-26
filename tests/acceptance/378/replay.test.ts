// #378.9e1f580f: unchanged draw lists replay: a static 3D fixture of 2,000 boxes in 40 batches, all in view
// while the camera orbits it for 10 s, encodes each batch once, in the first frame, counted on the noop lane,
// and every frame equals by pixel hash on one machine a run that encodes every draw each frame; a patch that
// moves one box or recolors it encodes nothing again, and one that adds a box encodes only that box's batch
// again, each next frame equal to the clean run; a planted worker that keeps replaying after the add leaves
// the new box out and fails, naming the batch, and one that encodes every batch each frame fails the count.
// The fixture is generated (helpers.ts: orbitDoc): forty writer layers of fifty boxes, one batch each
// (README: Readings), under a camera turning 900° in 10 s, 600 frames at 60 fps. Patches from the rows'
// writers: b17-25 moves before frame 200 and is recolored before frame 300; b29-50 is added to row 29 before
// frame 400. The run that encodes every draw each frame is `--planted encodes_every_frame`, which is also the
// planted worker that must fail the count; `--planted replays_after_add` keeps replaying row 29's old
// encoding. At the base `deep-gpu` answers the view3d call with bad_input.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, ORBIT, boxId, boxItem, everyFrame, frameAt, gridPos, look, orbitDoc, readIds, requireGpu, runGpu, set, useBins, useOut, view3d, view3Reply, writeDoc, writerOf,
  type Frame3, type JsonObject, type Planted, type View3,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const MOVED = boxId(17, 25);
const ADDED = boxId(29, 50);
const ROW_OF_ADD = 29;
const [mx, my, mz] = gridPos(17, 25);
const { layer: _layer, ...added } = boxItem(ROW_OF_ADD, 50);
const PATCHES = [
  { frame: 200, writer: writerOf(17), ops: [set(MOVED, 'at/pos', [mx + 0.6, my, mz])] },
  { frame: 300, writer: writerOf(17), ops: [set(MOVED, 'params/paint', { fill: { role: 'c3' } })] },
  { frame: 400, writer: writerOf(ROW_OF_ADD), ops: [{ op: 'create', item: added as JsonObject }] },
];
const ADD_FRAME = 400;
const rowOf = (id: string): number => Number(id.slice(1, 3));
const rowBoxes = (row: number, withAdd = false): string[] => [...Array.from({ length: ORBIT.perLayer }, (_, i) => boxId(row, i)), ...(withAdd && row === ROW_OF_ADD ? [ADDED] : [])].sort();

function orbit(startup: { backend?: 'noop'; planted?: Planted }, extra: { targets?: ('ids')[]; capture?: number[] } = {}): View3 {
  const doc = writeDoc(out(), 'orbit.json', orbitDoc());
  const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc, look: look(), size: ORBIT.size, frames: ORBIT.frames, fps: ORBIT.fps, patches: PATCHES, counts: true, ...extra })], startup);
  const what = `the orbit${startup.backend ? ' on noop' : ''}${startup.planted ? ` with --planted ${startup.planted}` : ''}`;
  const v = view3Reply(reply!, what);
  everyFrame(v, ORBIT.frames, what);
  return v;
}

/** The replay counts (frame 0 encodes the 40 batches, later frames encode nothing but the add's one batch), each problem naming its frame and batch. */
function replayProblems(frames: Frame3[], what: string): string[] {
  const problems: string[] = [];
  const first = frames[0]!;
  if (first.encoded === null) return [`${what}: frame 0 carries no encode counts`];
  const names = new Map<number, string>();
  const seen = new Set<string>();
  for (const b of first.encoded) {
    const rows = new Set(b.items.map(rowOf));
    if (rows.size !== 1) { problems.push(`${what}: frame 0's batch ${b.batch} spans rows ${[...rows].join(', ')}`); continue; }
    const row = [...rows][0]!;
    names.set(row, b.batch);
    if (JSON.stringify([...b.items].sort()) !== JSON.stringify(rowBoxes(row))) problems.push(`${what}: frame 0's batch ${b.batch} holds ${b.items.length} items, not row ${row}'s 50 boxes`);
    b.items.forEach((id) => seen.add(id));
  }
  if (first.encoded.length !== ORBIT.layers) problems.push(`${what}: frame 0 encodes ${first.encoded.length} batches, not ${ORBIT.layers}`);
  if (seen.size !== ORBIT.layers * ORBIT.perLayer) problems.push(`${what}: frame 0's batches draw ${seen.size} boxes, not 2,000`);
  for (const f of frames.slice(1)) {
    if (f.encoded === null) { problems.push(`${what}: frame ${f.frame} carries no encode counts`); continue; }
    const named = (bs: { batch: string }[]): string => bs.slice(0, 5).map((b) => b.batch).join(', ');
    if (f.frame === ADD_FRAME) {
      const mine = f.encoded.filter((b) => b.items.includes(ADDED));
      const others = f.encoded.filter((b) => !b.items.includes(ADDED));
      if (mine.length !== 1) problems.push(`${what}: frame ${f.frame}: batch ${names.get(ROW_OF_ADD) ?? `of row ${ROW_OF_ADD}`} (row ${ROW_OF_ADD}'s boxes) didn't encode again after the add of ${ADDED}: it replayed its old draws`);
      else if (JSON.stringify([...mine[0]!.items].sort()) !== JSON.stringify(rowBoxes(ROW_OF_ADD, true))) problems.push(`${what}: frame ${f.frame}: batch ${mine[0]!.batch} encoded again holds ${mine[0]!.items.length} items, not row ${ROW_OF_ADD}'s 50 boxes and ${ADDED}`);
      if (others.length) problems.push(`${what}: frame ${f.frame} encodes ${others.length} other batches again after the add (${named(others)})`);
      if (f.replayed !== null && f.replayed !== ORBIT.layers - 1) problems.push(`${what}: frame ${f.frame} replays ${f.replayed} batches, not ${ORBIT.layers - 1}`);
    } else {
      if (f.encoded.length) problems.push(`${what}: frame ${f.frame} encodes ${f.encoded.length} batches again (${named(f.encoded)})${f.frame === 200 ? ' after a move' : f.frame === 300 ? ' after a recolor' : ''}`);
      if (f.replayed !== null && f.replayed !== ORBIT.layers) problems.push(`${what}: frame ${f.frame} replays ${f.replayed} batches, not ${ORBIT.layers}`);
    }
  }
  return problems;
}

/** Frames whose pixel hash differs from the reference run's, each named. */
function hashProblems(frames: Frame3[], reference: Frame3[], what: string): string[] {
  return reference.flatMap((r, i) => {
    const f = frames[i];
    if (!f || f.frame !== r.frame) return [`${what}: frame ${r.frame} is missing`];
    return f.pixel_hash !== null && f.pixel_hash === r.pixel_hash ? [] : [`${what}: frame ${r.frame}'s pixel hash ${f.pixel_hash} isn't the every-draw run's ${r.pixel_hash}`];
  });
}

describe('#378.9e1f580f unchanged draw lists replay: 2,000 boxes in 40 batches orbited for 10 s encode each batch once, in the first frame; a move or a recolor encodes nothing again, an add encodes only its batch again; planted workers fail', () => {
  it('#378.9e1f580f counted on the noop lane: frame 0 encodes the 40 batches, one per row of 50 boxes; no later frame encodes again, after the move and the recolor included; the add encodes only row 29\'s batch, with the new box', () => {
    const v = orbit({ backend: 'noop' });
    expect(v.frames.every((f) => f.pixel_hash === null), 'the noop backend makes no pixels').toBe(true);
    expect(replayProblems(v.frames, 'the orbit on noop'), 'the encode counts').toEqual([]);
  }, 1_800_000);

  it('#378.9e1f580f a planted worker that encodes every batch each frame (--planted encodes_every_frame) fails the count, naming the frame', () => {
    const problems = replayProblems(orbit({ backend: 'noop', planted: 'encodes_every_frame' }).frames, 'encodes_every_frame');
    expect(problems.join('\n'), 'the count check fails at frame 1, naming it and the batches').toMatch(/frame 1 encodes 40 batches again/);
  }, 1_800_000);

  it('#378.9e1f580f a planted worker that keeps replaying after the add (--planted replays_after_add) fails the count, naming the batch', () => {
    const clean = orbit({ backend: 'noop' });
    const rowBatch = clean.frames[0]!.encoded?.find((b) => b.items.includes(boxId(ROW_OF_ADD, 0)))?.batch;
    expect(rowBatch, 'the clean run names row 29\'s batch').toBeDefined();
    const problems = replayProblems(orbit({ backend: 'noop', planted: 'replays_after_add' }).frames, 'replays_after_add');
    expect(problems.join('\n'), `the count check fails at the add, naming row ${ROW_OF_ADD}'s batch`).toContain(`frame ${ADD_FRAME}: batch ${rowBatch!} (row ${ROW_OF_ADD}'s boxes) didn't encode again after the add of ${ADDED}`);
  }, 1_800_000);

  it('#378.9e1f580f on this machine\'s GPU every frame of the orbit, before and after the move, the recolor and the add, equals by pixel hash a run that encodes every draw each frame, and every box is in view', () => {
    requireGpu();
    const capture = [0, 150, 300, 399, ADD_FRAME, 599];
    const clean = orbit({}, { targets: ['ids'], capture });
    const every = orbit({ planted: 'encodes_every_frame' });
    expect(replayProblems(clean.frames, 'the orbit on the GPU'), 'the encode counts on the GPU').toEqual([]);
    expect(new Set(clean.frames.map((f) => f.pixel_hash)).size, 'the camera orbits: frames differ').toBeGreaterThan(ORBIT.frames / 2);
    expect(hashProblems(clean.frames, every.frames, 'the replaying run'), 'frames whose hash differs from the every-draw run').toEqual([]);
    for (const n of capture) {
      const ids = readIds(out(), frameAt(clean, n, 'the orbit'), `frame ${n}'s object-ID target`);
      const want = [...Array.from({ length: ORBIT.layers }, (_, l) => rowBoxes(l)).flat(), ...(n >= ADD_FRAME ? [ADDED] : [])];
      const missing = want.filter((id) => !ids.count.has(id));
      expect(missing.slice(0, 10), `frame ${n}: every box is in view (${missing.length} missing)`).toEqual([]);
    }
  }, 3_600_000);

  it('#378.9e1f580f on the GPU, the planted worker that keeps replaying after the add (--planted replays_after_add) leaves the new box out of the frame, and the frames after the add differ from the every-draw run, naming the frame and the batch', () => {
    requireGpu();
    const every = orbit({ planted: 'encodes_every_frame' });
    const planted = orbit({ planted: 'replays_after_add' }, { targets: ['ids'], capture: [ADD_FRAME] });
    const before = hashProblems(planted.frames.slice(0, ADD_FRAME), every.frames.slice(0, ADD_FRAME), 'replays_after_add');
    expect(before, 'before the add the planted worker draws every frame as the every-draw run').toEqual([]);
    const after = hashProblems(planted.frames.slice(ADD_FRAME), every.frames.slice(ADD_FRAME), 'replays_after_add');
    expect(after[0], 'the first frame after the add differs, named').toMatch(new RegExp(`frame ${ADD_FRAME}'s pixel hash`));
    const ids = readIds(out(), frameAt(planted, ADD_FRAME, 'the planted orbit'), `frame ${ADD_FRAME}'s object-ID target`);
    const batch = planted.frames[0]!.encoded?.find((b) => b.items.includes(boxId(ROW_OF_ADD, 0)))?.batch ?? `of row ${ROW_OF_ADD}`;
    expect(ids.count.has(ADDED), `the planted worker leaves ${ADDED} out of frame ${ADD_FRAME}: batch ${batch} replayed without it`).toBe(false);
  }, 3_600_000);
});

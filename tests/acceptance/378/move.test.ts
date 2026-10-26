// #378.f24f1923: a move updates one instance record and rebuilds no mesh.
// fixtures/move.json: nine 1 m boxes of one size under a still camera. A patch from the layer's writer moves
// box-4 (`items/box-4/at/pos`) before frame 2. Counted on the noop lane (`deep-gpu run --backend noop`,
// no GPU): frame 2 writes exactly one instance record and builds no mesh, and the frames around it write
// and build nothing; frame 0 shows the counters count (it builds the box mesh and writes all nine records).
// The check's twins: the same reply doctored to rebuild a mesh, or to rewrite every record, on the move
// fails it, naming the frame. On the GPU, the moved frame equals by pixel hash a fresh run of the moved
// document. At the base `deep-gpu` answers the view3d call with bad_input.
import { describe, expect, it } from 'vitest';
import {
  GPU_BIN, clone, fixture, fixturePath, frameAt, look, requireGpu, runGpu, set, useBins, useOut, view3d, view3Reply, writeDoc,
  type Frame3, type JsonObject,
} from './helpers.ts';

const bins = useBins([GPU_BIN]);
const out = useOut();
const DOC = fixture('move.json');
const SIZE = DOC['size'] as [number, number];
const MOVED_TO = [0.75, 0.5, 0.5];
const MOVE = { frame: 2, writer: 'agent-a', ops: [set('box-4', 'at/pos', MOVED_TO)] };
const FRAMES = 4;

/** The move frame writes one instance record and builds no mesh; still frames write and build nothing. Each problem names the frame. */
function moveProblems(frames: Frame3[], what: string): string[] {
  const problems: string[] = [];
  for (const f of frames) {
    if (f.instances_written === null || f.meshes_built === null) { problems.push(`${what}: frame ${f.frame} carries no counts`); continue; }
    if (f.frame === 0) continue;
    const records = f.frame === MOVE.frame ? 1 : 0;
    if (f.instances_written !== records) problems.push(`${what}: frame ${f.frame}${f.frame === MOVE.frame ? ' (the move)' : ''} writes ${f.instances_written} instance records, not ${records}`);
    if (f.meshes_built !== 0) problems.push(`${what}: frame ${f.frame}${f.frame === MOVE.frame ? ' (the move)' : ''} builds ${f.meshes_built} meshes, not 0`);
  }
  return problems;
}

describe('#378.f24f1923 a move updates one instance record and rebuilds no mesh', () => {
  it('#378.f24f1923 counted on the noop lane, the move writes exactly one instance record and builds no mesh; the check fails a doctored reply that rebuilds or rewrites on the move, naming the frame', () => {
    const [reply] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: fixturePath('move.json'), look: look(), size: SIZE, frames: FRAMES, patches: [MOVE], counts: true })], { backend: 'noop' });
    const v = view3Reply(reply!, 'the move fixture on noop');
    expect(v.frames.map((f) => f.frame), 'every frame latched once, in order').toEqual([0, 1, 2, 3]);
    const first = frameAt(v, 0, 'the move fixture');
    expect(first.meshes_built, 'frame 0 builds the boxes\' mesh: the counter counts builds').toBeGreaterThanOrEqual(1);
    expect(first.instances_written, 'frame 0 writes every box\'s instance record: the counter counts records').toBeGreaterThanOrEqual(9);
    expect(v.frames.every((f) => f.pixel_hash === null), 'the noop backend makes no pixels').toBe(true);
    expect(moveProblems(v.frames, 'the move'), 'the move\'s counts').toEqual([]);
    // The check's twins, on doctored copies of this reply.
    const rebuilt = v.frames.map((f) => (f.frame === MOVE.frame ? { ...f, meshes_built: 1 } : f));
    expect(moveProblems(rebuilt, 'twin').join('\n'), 'a move that rebuilds a mesh fails, naming the frame').toMatch(/frame 2 \(the move\) builds 1 meshes/);
    const rewritten = v.frames.map((f) => (f.frame === MOVE.frame ? { ...f, instances_written: 9 } : f));
    expect(moveProblems(rewritten, 'twin').join('\n'), 'a move that rewrites every record fails, naming the frame').toMatch(/frame 2 \(the move\) writes 9 instance records/);
  }, 600_000);

  it('#378.f24f1923 on the GPU, the moved frame equals by pixel hash a fresh run of the document with the box already moved, and differs from the frame before it', () => {
    requireGpu();
    const moved = clone(DOC);
    ((moved['items'] as Record<string, JsonObject>)['box-4']!['at'] as JsonObject)['pos'] = MOVED_TO;
    const replies = runGpu(bins.bin(GPU_BIN), out(), [
      view3d({ doc: fixturePath('move.json'), look: look(), size: SIZE, frames: FRAMES, patches: [MOVE], counts: true }),
    ]);
    const [fresh] = runGpu(bins.bin(GPU_BIN), out(), [view3d({ doc: writeDoc(out(), 'moved.json', moved), look: look(), size: SIZE })]);
    const v = view3Reply(replies[0]!, 'the move fixture');
    const before = frameAt(v, 1, 'the move fixture').pixel_hash;
    const after = frameAt(v, 2, 'the move fixture').pixel_hash;
    const clean = frameAt(view3Reply(fresh!, 'the moved document, fresh'), 0, 'the moved document').pixel_hash;
    expect(before, 'frame 1 has a pixel hash').not.toBeNull();
    expect(after, 'the move shows: frame 2 differs from frame 1').not.toBe(before);
    expect(after, 'frame 2 equals a fresh run of the moved document').toBe(clean);
    expect(moveProblems(v.frames, 'the move on the GPU'), 'the move\'s counts on the GPU').toEqual([]);
  }, 600_000);
});

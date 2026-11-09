// #1413.8d4c0949: a build within memory opens no extra error scope per frame. Alpha opens with a 1 MiB
// `test.alloc@1` buffer and at frame 30 revises to a 2 MiB one; each frame reports the error scopes pushed on the
// render thread during it (README: error_scopes). The two frames that build (1 and 30) open the out-of-memory scope
// around their build; every other frame opens none. At the base no frame reports `error_scopes`, and there is no
// `test-faults` feature, so the binary doesn't build.
import { describe, expect, it } from 'vitest';
import { MIB, W, alloc, liveCall, liveReply, run, sceneDoc, useBuild, useDir, viewOf, writeDoc } from './helpers.ts';

const bin = useBuild();
const dir = useDir();
const FRAMES = 60;
const BUILDS = [1, 30];

describe('#1413.8d4c0949 a build within memory opens no extra error scope per frame', () => {
  it('#1413.8d4c0949 builds of 1 MiB and 2 MiB buffers open a scope around each build and none in any other frame, and nothing fails', () => {
    const d = dir();
    const first = writeDoc(d, 'first', sceneDoc('Within memory', { fits: alloc('fits', 'fits-1', MIB) }));
    const second = writeDoc(d, 'second', sceneDoc('Within memory, again', { fits: alloc('fits', 'fits-2', 2 * MIB) }));
    const { replies } = run(bin(), d, [liveCall({
      frames: FRAMES,
      sessions: [{ session: 'alpha', writer: W.alpha, doc: first }],
      events: [{ frame: BUILDS[1]!, revise: { session: 'alpha', doc: second } }],
      report: ['errors'],
    })]);
    const live = liveReply(replies[0]!, 'the live call with builds within memory');
    expect(live.writer_errors, 'a build within memory tells its writer no error').toEqual([]);
    expect(live.frames.filter((f) => !viewOf(f, 'alpha').drawn || viewOf(f, 'alpha').rung !== 'base').map((f) => f.frame), 'alpha draws every frame at its base rung').toEqual([]);
    const scopes = live.frames.map((f) => [f.frame, f.error_scopes] as const);
    expect(scopes.filter(([, n]) => n === null).map(([f]) => f), 'every frame reports the error scopes it opened (report: errors)').toEqual([]);
    for (const b of BUILDS) expect(scopes.find(([f]) => f === b)![1], `frame ${b} builds, inside an out-of-memory scope`).toBeGreaterThanOrEqual(1);
    const extra = scopes.filter(([f, n]) => !BUILDS.includes(f) && n !== 0).map(([f, n]) => `frame ${f}: ${n}`);
    expect(extra, 'no frame that builds nothing opens an error scope').toEqual([]);
  }, 3_600_000);
});

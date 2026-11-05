// AC7: "A revision that removes the last item sampling a 2,048 px texture lands while a frame that samples it is
// still in flight: the frame completes with no validation error, the texture's memory is released after that
// frame's `gpu_done` fence, by the meter's count, and the next frame doesn't bind it; a planted cache that releases
// at the revision raises a destroyed-resource error on the in-flight frame and fails, naming the texture"
//
// #379's `live` call in the `test-meter` build, with the test.gpu module's `test.texture@1` (a 2,048 × 2,048 rgba8
// texture with its whole mip chain, drawn on a 1 m quad, so drawing it samples it). One writer's session over nine
// frames: frames 1–2 hold two items that share the texture by content key; the revision at frame 3 drops one, so
// the other is its last reader; frame 5, which samples it, is held in flight (`hold`: its `gpu_done` withheld
// until frame 7 is presented); the revision at frame 6 drops the last reader while frame 5 is in flight. Read from
// the reply: the texture is one result key K of at least 22,369,620 B (all twelve mips); frames 1–5 bind K and
// list it among the writer's results, frames 6–9 do neither (out of the cache at once, and not bound); frame 5's
// `gpu_done` comes after frame 7's present; K is released exactly once, after that `gpu_done`, with its bytes;
// the meter's count still holds K's bytes at frames 6 and 7 and drops by exactly K's bytes at frame 8; no frame is
// missing and the device reports no error. `--planted releases_at_revision` releases K when the revision lands and
// must raise a `destroyed_resource` error on frame 5 naming K, and fail the check, naming K. Fences on Metal:
// INCONCLUSIVE off macOS.

import { describe, expect, it } from 'vitest';
import {
  AC, TEXTURE_PX, W, failsNaming, liveCall, liveReply, none, requireGpu, runGpu, sceneDoc, useBins, useDir, writeJson, type JsonObject, type Live,
  type LiveFrame, type Startup,
} from './helpers.ts';

const bins = useBins(['deep-gpu+test-meter']);
const dir = useDir();
const SESSION = 's-alpha';
const FRAMES = 9;
const HELD = 5;
const UNTIL = 7;
const DROP_ONE = 3;
const DROP_LAST = 6;
/** A 2,048 × 2,048 rgba8 texture with all twelve mips holds at least this many bytes. */
const TEXTURE_MIN = Array.from({ length: 12 }, (_, i) => (TEXTURE_PX >> i) ** 2 * 4).reduce((a, b) => a + b, 0);

const texture = (pos: [number, number, number]): JsonObject => ({ kind: 'test.texture@1', params: { size: [TEXTURE_PX, TEXTURE_PX], format: 'rgba8', mips: 'all', pattern: 'shared' }, at: { pos } });
function texDoc(count: 0 | 1 | 2): JsonObject {
  const items: Record<string, JsonObject> = {
    cam: { kind: 'camera@1', params: { projection: 'perspective', position: [0, 2, 6], target: [0, 1, 0], fov: 45 } },
    plinth: { kind: 'mark.box@1', params: { size: [1, 0.2, 1], paint: { fill: { role: 'muted' } } }, at: { pos: [0, 0.1, 0] } },
  };
  if (count >= 1) items['t2'] = texture([0.8, 1, 0]);
  if (count === 2) items['t1'] = texture([-0.8, 1, 0]);
  return sceneDoc(`Textures ${count}`, items, { size: [256, 256], camera: 'cam', budget: { class: 'work_product' }, requires: { modules: { scene3d: '^1', 'test.gpu': '^1' } } });
}

function run(startup: Startup = {}): Live {
  const [two, one, none0] = [texDoc(2), texDoc(1), texDoc(0)].map((d, i) => writeJson(dir(), `rev${i}.json`, d));
  const [reply] = runGpu(bins.bin('deep-gpu+test-meter'), dir(), [liveCall({
    frames: FRAMES,
    sessions: [{ session: SESSION, writer: W.alpha, doc: two! }],
    events: [
      { frame: DROP_ONE, revise: { session: SESSION, doc: one! } },
      { frame: HELD, hold: { session: SESSION, until: UNTIL } },
      { frame: DROP_LAST, revise: { session: SESSION, doc: none0! } },
    ],
    report: ['memory', 'fences', 'binds', 'errors'],
  })], startup);
  return liveReply(reply!);
}

const frame = (live: Live, n: number): LiveFrame => {
  const f = live.frames.find((x) => x.frame === n);
  expect(f, `frame ${n} is reported`).toBeDefined();
  return f!;
};
const held = (f: LiveFrame) => f.writers.find((w) => w.writer === W.alpha);

/** The texture: the one result of the writer at frame 1 large enough to be a 2,048 px texture with its mips. */
function textureKey(live: Live): { key: string; bytes: number } {
  const w = held(frame(live, 1));
  expect(w, `frame 1: the meter counts ${W.alpha}`).toBeDefined();
  const big = w!.results.filter((r) => r.bytes >= TEXTURE_MIN);
  expect(big.length, `frame 1: the two items share one ${TEXTURE_PX} px texture by content key (one result of at least ${TEXTURE_MIN} B): ${JSON.stringify(w!.results)}`).toBe(1);
  return big[0]!;
}

/** What AC7 asks of the release; every failure names the texture's key. */
function releaseProblems(live: Live, tex: { key: string; bytes: number }): string[] {
  const out: string[] = [];
  const K = tex.key;
  const missing = Array.from({ length: FRAMES }, (_, i) => i + 1).filter((n) => !live.frames.some((f) => f.frame === n));
  if (missing.length) out.push(`texture ${K}: frames ${missing.join(', ')} are missing`);
  for (const e of live.errors) out.push(`texture ${K}: the device reported ${e.code} at frame ${e.frame ?? '?'}${e.resource ? ` naming ${e.resource}` : ''}: ${e.message.slice(0, 200)}`);
  for (const f of live.frames) {
    const binds = (f.binds.get(SESSION) ?? []).includes(K);
    const listed = (held(f)?.results ?? []).some((r) => r.key === K);
    if (f.frame <= HELD && !binds) out.push(`texture ${K}: frame ${f.frame} doesn't bind it, though an item samples it`);
    if (f.frame >= DROP_LAST && binds) out.push(`texture ${K}: frame ${f.frame} binds it after the revision removed its last reader`);
    if (f.frame <= HELD && !listed) out.push(`texture ${K}: frame ${f.frame}'s results don't list it, though a revision reads it`);
    if (f.frame >= DROP_LAST && listed) out.push(`texture ${K}: frame ${f.frame} still lists it among the writer's results: it didn't leave the cache when its last reader went`);
  }
  const at = (event: string, n: number) => live.fences.find((x) => x.event === event && x.frame === n && (x.session === null || x.session === SESSION));
  const done = at('gpu_done', HELD);
  const shown = at('present', UNTIL);
  if (!done) out.push(`texture ${K}: frame ${HELD}'s gpu_done is not in the fence record`);
  if (!shown) out.push(`texture ${K}: frame ${UNTIL}'s present is not in the fence record`);
  if (done && shown && done.seq < shown.seq) out.push(`texture ${K}: frame ${HELD}'s gpu_done came before frame ${UNTIL}'s present, so it wasn't in flight when the revision at frame ${DROP_LAST} landed`);
  const releases = live.fences.filter((x) => x.event === 'release' && x.resource === K);
  if (releases.length !== 1) out.push(`texture ${K}: released ${releases.length} times, not once`);
  for (const r of releases) {
    if (done && r.seq < done.seq) out.push(`texture ${K}: released (seq ${r.seq}) before frame ${HELD}'s gpu_done (seq ${done.seq}), while that frame was in flight`);
    if (r.bytes !== tex.bytes) out.push(`texture ${K}: released ${r.bytes} B, not its ${tex.bytes} B`);
  }
  const count = (n: number): number | null => held(frame(live, n))?.count_bytes ?? null;
  const [c5, c6, c7, c8, c9] = [count(5), count(6), count(7), count(8), count(9)];
  if (c5 === null || c6 === null || c7 === null || c8 === null || c9 === null) out.push(`texture ${K}: the meter doesn't count ${W.alpha} at frames 5–9`);
  else {
    if (c6 < c5 - 1 || c7 < c5 - 1) out.push(`texture ${K}: the meter's count fell before frame ${HELD}'s gpu_done (frame 5: ${c5} B, 6: ${c6} B, 7: ${c7} B)`);
    if (c7 - c8 !== tex.bytes) out.push(`texture ${K}: the meter's count fell by ${c7 - c8} B at frame 8, not by the texture's ${tex.bytes} B`);
    if (c9 !== c8) out.push(`texture ${K}: the meter's count moved again at frame 9 (${c8} B to ${c9} B)`);
  }
  return out;
}

describe(`${AC[7]} a shared result is released only after the GPU finished every frame that binds it`, () => {
  it(`${AC[7]} removing the last item sampling a ${TEXTURE_PX} px texture while a frame that samples it is in flight: no error, released after that frame's gpu_done by the meter's count, and not bound by the next frame`, () => {
    requireGpu();
    const live = run();
    const tex = textureKey(live);
    none(releaseProblems(live, tex), 'the texture\'s release');
  }, 900_000);

  it(`${AC[7]} the planted releases_at_revision raises a destroyed_resource error on the in-flight frame ${HELD} and fails, naming the texture`, () => {
    requireGpu();
    const live = run({ planted: 'releases_at_revision' });
    const tex = textureKey(live);
    expect(live.errors.some((e) => e.code === 'destroyed_resource' && e.frame === HELD && e.resource === tex.key), `a destroyed_resource error on frame ${HELD} names the texture ${tex.key}: ${JSON.stringify(live.errors).slice(0, 1500)}`).toBe(true);
    failsNaming(releaseProblems(live, tex), [tex.key], 'the planted releases_at_revision');
  }, 900_000);
});

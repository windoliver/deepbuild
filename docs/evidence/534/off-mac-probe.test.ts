// Off-Mac probe of #534's Mac-pinned legs: the same calls without the pin or the judge, readings printed.
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { STEP_60, bakeCall, bakeOf, checkCall, firstFrameDiff, layoutFor, live, logicBin, num, openSaveCall, openedOf, piece, run, savesDir, str, yours, type JsonValue } from '../../../tests/acceptance/534/helpers.ts';
import { DUNGEON, dungeonPiece, dungeonTrack } from '../../../tests/acceptance/534/dungeon.ts';
import { FLOCK_WRITES, big, flock, hoard, layoutProbe } from '../../../tests/acceptance/534/programs.ts';

it('frames: reopened equal never-quit; save_drops_globals differs', () => {
  logicBin();
  const FRAMES = [{ from: 1799 * STEP_60, count: 601, arrays: [`${DUNGEON}.floor`, `${DUNGEON}.health`, `${DUNGEON}.inv`] }];
  for (const planted of [[], ['save_drops_globals']] as const) {
    const dir = savesDir();
    bakeOf(run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: 1800, saves_dir: dir })], [...planted])[0]!, 'save');
    const o = openedOf(run([openSaveCall(dungeonPiece(), { saves_dir: dir, slot: 1, track: dungeonTrack(), steps: 2400, frames: FRAMES })], [...planted])[0]!, 'open');
    const nq = bakeOf(run([bakeCall(dungeonPiece(), { track: dungeonTrack(), steps: 2400, frames: FRAMES })])[0]!, 'nq');
    const d = firstFrameDiff(o.frames[0]!, nq.frames[0]!);
    console.log('PROBE frames', planted, o.frames[0]?.length, JSON.stringify(d), JSON.stringify(o.frames[0]?.[0]), JSON.stringify(o.frames[0]?.[600]));
    if (planted.length === 0) expect(d).toBeNull(); else expect(d).not.toBeNull();
  }
}, 600_000);

it('budget readings', async () => {
  const p = piece({ seed: 534_41, items: { big: { program: big(), writes: { v: { type: 'i32' } } } } });
  let l = live(); await l.call({ call: 'about' }); let t0 = performance.now(); const r = await l.call(checkCall(p)); console.log('PROBE check ms', performance.now() - t0, r['ok']); l.signal('SIGKILL');
  const hoard4 = (at: number[]) => piece({ seed: 534_04, items: { hoard: { program: hoard(64, at), writes: { request: { type: 'i32' } }, budget: { memory: 4 }, saves: { slots: 1, request: 'request' } } } });
  const b = bakeOf(run([bakeCall(hoard4([]), { steps: 600 })])[0]!, 'b');
  const ns = (b.checkpoints['hoard'] ?? []).map((c) => c.ns); console.log('PROBE checkpoint ns', ns.length, Math.max(...(ns as number[])) / 1e6, ns.every((x) => x !== null));
  const s = bakeOf(run([bakeCall(hoard4([9]), { steps: 10, saves_dir: savesDir() })])[0]!, 's').saves[0]; console.log('PROBE save ms', s!.write_ns! / 1e6, s!.on_ui_thread);
  const fl = layoutFor(layoutProbe(), ['wind'], FLOCK_WRITES);
  const fp = piece({ seed: 532_01, class: 'figure', controls: ['wind'], items: { flock: { program: flock(fl), reads: ['wind'], writes: FLOCK_WRITES } } });
  l = live(); const v = await l.call({ call: 'view', piece: fp, track: [yours('wind', 30, 0.2), yours('wind', 300, -0.4)] as unknown as JsonValue, span: 30 });
  let f = await l.call({ call: 'frame', session: str(v['session'], 's'), seek: 10 }); let e = 0, n = 0;
  for (let i = 0; i < 10000; i++) { e += num(f['eval_ns'], 'e'); n += num(f['steps'], 'n'); if (f['stale'] !== true) break; f = await l.call({ call: 'frame', session: str(v['session'], 's') }); }
  console.log('PROBE flock ms/step', e / n / 1e6, n); l.signal('SIGKILL');
  l = live(); const v2 = await l.call({ call: 'view', piece: piece({ seed: 534_42, items: {} }), track: [], span: 10 }); console.log('PROBE empty view', JSON.stringify(v2).slice(0, 200));
  if (v2['session']) { for (let i = 0; i < 3; i++) { const g = await l.call({ call: 'frame', session: str(v2['session'], 's'), ...(i === 0 ? { seek: 5 } : {}) }); console.log('PROBE empty frame', g['steps'], g['eval_ns']); } }
  l.signal('SIGKILL');
}, 600_000);

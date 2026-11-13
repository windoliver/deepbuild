// AC8 #173.67e2e72d: The determinism check on the castle flythrough gives the same seek-against-play result with frame
// history on and off, and after an orbit by hand in the live view, since it compares canonical renders; a planted
// determinism check that hashes the live view's resolved frames reports a difference after the orbit where the
// canonical renders agree.
//
// The castle as committed, in its own look, played by `view3d` at 30 fps for frames 0–149 (5 s) in three legs of one
// process: history off; history on (antialias, window 8); history on with your hand orbiting the live view (`viewer`
// camera) from 0° at frame 60 out to 30° at frame 90 and back to 0° at frame 120. Each call then runs the determinism
// check (`determinism: {at_times}`, same machine) at 1 s, 2.5 s and 4 s: at each time a canonical render played to it
// against one sought to it, each by its GPU pixel hash (#1897's). Every leg reads PASS, each time's played and sought
// hashes are equal, and each time's hash is the same in all three legs (canonical renders see neither the window nor
// the hand); the three times hash differently (the flythrough moves). The orbit leg's live view drew with history.
// `--planted determinism_hashes_live_view` (the check hashes the frames this live view showed and resolves, played and
// sought, instead of canonical renders) on the orbit leg reads FAIL, its played and sought hashes differing at 2.5 s,
// in the middle of the hand's orbit, where the honest check's canonical renders agree.
// Wrong programs: the base (no `determinism` on view3d, no history, no hand orbit); a check that reads the window or
// the hand's view.
import { describe, expect, it } from 'vitest';
import {
  AC, CASTLE_FPS, FLICKS, HISTORY_OFF, HISTORY_ON, arr, castle, castleLook, framesOf, isObject, num, obj, requireMetal, runGpu, secs, shown, str, useDir,
  useGpu, view3dCall, type GpuPlanted, type JsonObject,
} from './helpers.ts';

const ID = AC[8];
const bin = useGpu();
const dir = useDir();
const FRAMES = 150;
const AT_TIMES = [FLICKS, 2.5 * FLICKS, 4 * FLICKS];
/** Your hand: from frame 60 to 90 out 1° a frame, back to 0° by frame 120. */
const HAND = Array.from({ length: 61 }, (_, i) => ({ frame: 60 + i, camera: { azimuth: i <= 30 ? i : 60 - i } }));
const HASH = /^[0-9a-f]{32}$/;

interface Compared { result: string; frames: { t: number; play: string; seek: string }[]; drewWithHistory: number }
function legs(orbitOnly: boolean, planted?: GpuPlanted): Compared[] {
  requireMetal();
  const c = castle();
  const leg = (history: JsonObject, hand: boolean): JsonObject => view3dCall({
    doc: c.doc, look: castleLook(c, history), size: c.size, packs: c.packs, fps: CASTLE_FPS, frames: FRAMES, determinism: { at_times: AT_TIMES },
    ...(hand ? { viewer: HAND } : {}),
  });
  const calls = orbitOnly ? [leg(HISTORY_ON, true)] : [leg(HISTORY_OFF, false), leg(HISTORY_ON, false), leg(HISTORY_ON, true)];
  const names = orbitOnly ? ['history on, after an orbit by hand'] : ['history off', 'history on', 'history on, after an orbit by hand'];
  return runGpu(bin(), dir(), calls, planted).map((r, i) => {
    const what = names[i]!;
    const frames = framesOf(r, what);
    expect(isObject(r['determinism']), `${what}: the call reports its determinism check: ${shown(r['determinism'] ?? null)}`).toBe(true);
    const d = obj(r['determinism'], `${what}: determinism`);
    const rows = arr(d['frames'], `${what}: determinism.frames`).map((v, j) => {
      const f = obj(v, `${what}: determinism.frames[${j}]`);
      const hash = (side: string): string => {
        const h = str(obj(f[side], `${what}: determinism.frames[${j}].${side}`)['pixel_hash'], `${what}: ${side}.pixel_hash`);
        expect(h, `${what}: ${side}.pixel_hash is the 128-bit GPU pixel hash`).toMatch(HASH);
        return h;
      };
      return { t: num(f['t'], `${what}: determinism.frames[${j}].t`), play: hash('play'), seek: hash('seek') };
    });
    expect(rows.map((x) => x.t), `${what}: one comparison per time asked`).toEqual(AT_TIMES);
    return { result: str(d['result'], `${what}: determinism.result`), frames: rows, drewWithHistory: frames.filter((f) => f.history?.mode === 'antialias').length };
  });
}

describe(`${ID} the determinism check compares canonical renders, whatever the live view did`, () => {
  it(`${ID} seek against play on the castle reads PASS with one hash per time with history off, on, and on after an orbit by hand`, () => {
    const [off, on, orbit] = legs(false);
    for (const [name, x] of [['history off', off!], ['history on', on!], ['history on, after an orbit by hand', orbit!]] as const) {
      console.log(`${ID}: ${name}: ${x.result}; ${x.frames.map((f) => `${secs(f.t)} play ${f.play} seek ${f.seek}`).join('; ')}`);
      expect(x.result, `${name}: the determinism check passes`).toBe('PASS');
      for (const f of x.frames) {
        expect(f.seek, `${name}: at ${secs(f.t)} seeking hashes as playing`).toBe(f.play);
        expect(f.play, `${name}: at ${secs(f.t)} the canonical render is the one with history off`).toBe(off!.frames.find((g) => g.t === f.t)!.play);
      }
    }
    expect(new Set(off!.frames.map((f) => f.play)).size, 'the flythrough moves: the three times hash differently').toBe(AT_TIMES.length);
    expect(orbit!.drewWithHistory, 'the live view your hand orbited drew its moving frames with history').toBeGreaterThan(100);
  }, 3_600_000);

  it(`${ID} a planted check that hashes the live view's resolved frames (determinism_hashes_live_view) reports a difference at 2.5 s after the orbit by hand`, () => {
    const [orbit] = legs(true, 'determinism_hashes_live_view');
    const at = orbit!.frames.find((f) => f.t === 2.5 * FLICKS)!;
    console.log(`${ID} (--planted determinism_hashes_live_view): ${orbit!.result}; at 2.5 s play ${at.play}, seek ${at.seek}`);
    expect(orbit!.result, '--planted determinism_hashes_live_view: the check on the live view\'s frames fails after the orbit').toBe('FAIL');
    expect(at.seek, '--planted determinism_hashes_live_view: at 2.5 s, in the hand\'s orbit, the live view\'s played and sought frames differ').not.toBe(at.play);
  }, 3_600_000);
});

// AC6 #173.126ffc47: A view that stops after an orbit settles to the frame a render-back takes at that t and view, byte
// for byte, and an export, a render-back snapshot and a golden of the same revision are byte-identical with frame
// history on or off and after any playback.
//
// The rest. The still scene (helpers: `stillDoc`, nothing in it moves) in the plain look with frame history on
// (antialias, window 8) and #419's samples {live: 1, export: 16, at_rest: none} through a 1.5 px Blackman-Harris
// filter, by `view3d` at 30 fps for frames 0–99. Your hand orbits the view (`viewer` camera, 1° a frame from frame 10
// to 30° at frame 39) and stops. While the hand moves (frames 12–39) the frames draw with history; once the view rests,
// history drops and the frame settles: some frame from 40 on reports samples {drawn: 16, settling: false} and history
// `none`, every frame after it to 99 does too with one final hash, and that hash is the render-back's: `class:
// render_back` at frame 99 through the same view (the hand's 30°). At-rest settling is left at `none` in the look:
// frame history turns it on (Look: frame history).
// The canonical renders. The orbiting scene (helpers: `orbitDoc`, its camera turning 15° a second) with one sample per
// frame live and in export, in three processes: (A) history off: the export of frame 30, the render-back of frame 30
// through a view your hand turned 20°, and the export of frame 0, whose PNG you bless as the golden `orbit-173` (#380's
// `decide`), then `golden` with the hash oracle on a `view3d` snapshot of the same revision; (B) history on, after
// playback (frames 0–45 with your hand orbiting through frames 20–40, then a seek back to 10 and on to 23): the same
// export, render-back and golden; (C) history on in a fresh process: the same three. The exports are one SHA-256, the
// render-backs one, and every golden reads PASS by hash with the same pixels.
// Wrong programs: the base (no history, no render-back class, no hand orbit); a settled frame that keeps history, or
// settles to other samples; an export, render-back or golden snapshot that reads the window, the look's history or
// state a playback left.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, HISTORY_OFF, HISTORY_ON, STILL_SIZE, frameAt, framesOf, look, obj, orbitDoc, requireMetal, runGpu, shown, stillDoc, str, useDir, useGpu, view3dCall,
  writeJson, type JsonObject, type ViewFrame,
} from './helpers.ts';

const ID = AC[6];
const bin = useGpu();
const dir = useDir();
const FPS = 30;
const REST_FRAMES = 100;
const ORBIT_FROM = 10;
const ORBIT_TO = 39;
const T = 30;
const ORBIT_SIZE: [number, number] = [480, 320];
const FIXTURE = 'orbit-173';

describe(`${ID} the frame you stop on is the render-back's, and canonical renders never see history`, () => {
  it(`${ID} a view that stops after an orbit settles to the render-back at that view byte for byte, and the export, render-back and golden are the same with history on, off and after playback`, () => {
    requireMetal();
    // The rest.
    const out = dir();
    const still = writeJson(out, 'still', stillDoc());
    const settling = look({ history: HISTORY_ON, live: 1, export: 16, atRest: 'none', filter: 'blackman_harris', filterPx: 1.5 });
    const hand = Array.from({ length: ORBIT_TO - ORBIT_FROM + 1 }, (_, i) => ({ frame: ORBIT_FROM + i, camera: { azimuth: i + 1 } }));
    const [liveReply, backReply] = runGpu(bin(), out, [
      view3dCall({ doc: still, look: settling, size: STILL_SIZE, fps: FPS, frames: REST_FRAMES, capture: 'every', targets: ['final'], viewer: hand }),
      view3dCall({ doc: still, look: settling, size: STILL_SIZE, fps: FPS, class: 'render_back', from: REST_FRAMES - 1, frames: 1, capture: [REST_FRAMES - 1], targets: ['final'], viewer: [{ frame: 0, camera: { azimuth: ORBIT_TO - ORBIT_FROM + 1 } }] }),
    ]);
    const live = framesOf(liveReply!, 'the view your hand orbits');
    for (let n = ORBIT_FROM + 2; n <= ORBIT_TO; n++) {
      const h = frameAt(live, n, 'the view your hand orbits').history;
      expect(h, `frame ${n}, while your hand orbits the view, reports its frame history`).not.toBeNull();
      expect(h!.mode, `frame ${n}, while your hand orbits the view, draws with history`).toBe('antialias');
    }
    const rest = live.filter((f) => f.frame > ORBIT_TO);
    const isSettled = (f: ViewFrame): boolean => f.samples?.drawn === 16 && f.samples.settling === false && f.history?.mode === 'none';
    const k = rest.findIndex(isSettled);
    console.log(`${ID}: at rest: ${rest.map((f) => `${f.frame}:${f.samples ? `${f.samples.drawn}${f.samples.settling ? 's' : ''}` : '-'}/${f.history?.mode ?? '-'}`).join(' ')}`);
    expect(k, `once the view rests, history drops and the frame settles to 16 samples by frame ${REST_FRAMES - 1}`).toBeGreaterThanOrEqual(0);
    const settled = rest.slice(k);
    for (const f of settled) {
      expect(isSettled(f), `frame ${f.frame}, after settling, stays settled without history`).toBe(true);
      expect(f.final, `frame ${f.frame}, after settling, keeps the settled frame's hash`).toBe(settled[0]!.final);
    }
    const back = frameAt(framesOf(backReply!, 'the render-back'), REST_FRAMES - 1, 'the render-back');
    expect(back.final, `the frame the view stops on (frame ${settled[0]!.frame}) equals the render-back at that t and view, byte for byte`).toBe(settled[0]!.final);

    // The canonical renders.
    const doc = writeJson(out, 'orbit', orbitDoc(ORBIT_SIZE));
    const store = join(out, 'goldens');
    const lookOf = (history: JsonObject): JsonObject => look({ history, live: 1, export: 1 });
    const canon = (history: JsonObject): JsonObject[] => [
      view3dCall({ doc, look: lookOf(history), size: ORBIT_SIZE, fps: FPS, class: 'export', from: T, frames: 1, capture: [T], targets: ['final'] }),
      view3dCall({ doc, look: lookOf(history), size: ORBIT_SIZE, fps: FPS, class: 'render_back', from: T, frames: 1, capture: [T], targets: ['final'], viewer: [{ frame: 0, camera: { azimuth: 20 } }] }),
    ];
    const golden = (history: JsonObject): JsonObject => ({ call: 'golden', store, fixture: FIXTURE, oracle: 'hash', view3d: { doc, look: lookOf(history), size: ORBIT_SIZE, fps: FPS } });
    interface Canon { exported: string | null; back: string | null; golden: JsonObject }
    const canonOf = (replies: JsonObject[], what: string): Omit<Canon, 'golden'> => ({
      exported: frameAt(framesOf(replies[0]!, `${what}: the export`), T, `${what}: the export`).final,
      back: frameAt(framesOf(replies[1]!, `${what}: the render-back`), T, `${what}: the render-back`).final,
    });
    // (A) history off; the golden blessed from the export of frame 0.
    const a1 = runGpu(bin(), out, [...canon(HISTORY_OFF), view3dCall({ doc, look: lookOf(HISTORY_OFF), size: ORBIT_SIZE, fps: FPS, class: 'export', from: 0, frames: 1, capture: [0], targets: ['final'] })]);
    const first = frameAt(framesOf(a1[2]!, 'history off: the export of frame 0'), 0, 'history off: the export of frame 0');
    const [decided, goldenA] = runGpu(bin(), out, [
      { call: 'decide', store, via: 'you', decision: { bless: { fixture: FIXTURE, png: join(out, `${str(first.final, 'the export of frame 0')}.png`) } } },
      golden(HISTORY_OFF),
    ]);
    expect(obj(decided, 'the blessing')['outcome'], `your blessing of the export of frame 0 is recorded: ${shown(decided)}`).toBe('decided');
    const A: Canon = { ...canonOf(a1, 'history off'), golden: goldenA! };
    // (B) history on, after playback with your hand orbiting and a seek.
    const playback = view3dCall({
      doc, look: lookOf(HISTORY_ON), size: ORBIT_SIZE, fps: FPS, frames: 60, seeks: [{ after: 45, to: 10 }],
      viewer: Array.from({ length: 21 }, (_, i) => ({ frame: 20 + i, camera: { azimuth: i } })),
    });
    const b = runGpu(bin(), out, [playback, ...canon(HISTORY_ON), golden(HISTORY_ON)]);
    const played = framesOf(b[0]!, 'the playback');
    expect(played.filter((f) => f.history?.mode === 'antialias').length, 'the playback drew its moving frames with history').toBeGreaterThan(30);
    const B: Canon = { ...canonOf(b.slice(1), 'history on, after playback'), golden: b[3]! };
    // (C) history on, in a fresh process.
    const c = runGpu(bin(), out, [...canon(HISTORY_ON), golden(HISTORY_ON)]);
    const C: Canon = { ...canonOf(c, 'history on, fresh'), golden: c[2]! };

    const rows: [string, Canon][] = [['history off', A], ['history on, after playback', B], ['history on, fresh', C]];
    console.log(`${ID}: export ${rows.map(([n, x]) => `${n} ${x.exported}`).join('; ')}`);
    for (const [name, x] of rows) {
      expect(x.exported, `the export of frame ${T} with ${name} is the one with history off, byte for byte`).toBe(A.exported);
      expect(x.back, `the render-back of frame ${T} with ${name} is the one with history off, byte for byte`).toBe(A.back);
      expect(x.golden['verdict'], `the golden with ${name} reads PASS by hash: ${shown(x.golden)}`).toBe('PASS');
      expect(obj(x.golden['numbers'], `the golden with ${name}: numbers`)['pixels'], `the golden's snapshot with ${name} has the pixels of the one with history off`).toBe(obj(A.golden['numbers'], 'the golden with history off: numbers')['pixels']);
    }
  }, 3_600_000);
});

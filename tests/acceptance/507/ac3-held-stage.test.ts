// AC3 #507.4b380d1c: "In present mode, a stage held 20 s keeps the music bus within 1 LU of its short-term loudness
// before the hold while a narration line after the marker waits, and a stage picked during the hold glides the camera to
// its shot while the timeline stays held; at 120 BPM in 4/4, with the marker 1.0 s past a bar line, an advance 3.3 s
// into the hold resumes the timeline 4.0 s into it; and a replay of that session renders the same samples when seeked
// as when played"
//
// One session of helpers.ts `heldFilm` in present mode on one display (README: Fixtures): → at 1 s leaves the stage at
// 0 s; the timeline reaches m1 (11 s, 1.0 s past the bar line at 10 s) at H1, read from where it plays at 5 s. Stage
// `side` of the stages control is picked 5 s into that hold; → 19.5 s into it, so with bars of 2 s the hold lasts 20 s
// (ten bars, the fewest reaching past the advance); the line at 11.5 s waits until then. m2 (21 s, 1.0 s past the bar
// line at 20 s) is reached at H2; → 3.3 s into that hold resumes it 4.0 s in (two bars), not at 3.3 s, nor at the bar
// lines 3.0 s or 5.0 s in. The session's sound is its replay through `media_mix` (README: The surface under test), played
// from 0 and sought into the long hold and across its end. Wrong programs: music that holds with the timeline, a
// narration line that plays through the hold, a stage pick that cuts or moves the timeline, a hold resumed at the
// advance or at the song's bar lines, a replay whose seek differs from its play.
import { describe, expect, it } from 'vitest';
import {
  DISPLAY_A, DOC, Driver, FRONT, HELD, MUSIC_HZ, SIDE, TIMEOUT, VOICE_HZ, A, arr, enterPresent, evalAt, fl, getEvidence, heldFilm,
  int, kWeighted, key, none, num, obj, pick, positionOf, presentEntry, readWav, sampleAt, secs, shortTerm, show, str, tonePower, useShow, useTemp,
  type JsonObject,
} from './helpers.ts';

const ID = 'AC3 #507.4b380d1c';
const bin = useShow();
const temp = useTemp();

interface Session {
  evidence: string;
  /** Where the long hold at m1 starts on the clock, where it ended, and where the short hold at m2 starts. */
  h1: number; r2: number; h2: number;
  /** The camera and position at each clock offset from the pick (s). */
  glide: { off: number; target: number[]; viewWidth: number; position: number }[];
  /** The second advance's stamp, and the position at each offset into the short hold (s). */
  third: number; short: { off: number; position: number }[];
  played: { first: number; channels: Float32Array[] };
  sought: { first: number; channels: Float32Array[] }[];
}
let made: Session | Error | undefined;
/** Times read back from positions may each sit a film frame off; 0.1 s is three frames, far under every gap tested. */
const slack = fl(0.1);
const PICK = 5; const RESUME_AT = 19.5;
const GLIDE = [-0.5, 0.2, 0.4, 0.6, 1.0, 2.0];
const SHORT = [3.0, 3.6, 3.9, 4.3, 5.0];

/** The session, run once for the file's four tests. */
function session(): Session {
  if (made === undefined) {
    try { made = run(); } catch (e) { made = e as Error; }
  }
  if (made instanceof Error) throw made;
  return made;
}
function run(): Session {
  const evidence = temp();
  const d = new Driver(bin(), { evidence, displays: [DISPLAY_A], doc: DOC.held });
  enterPresent(d, DOC.held, heldFilm(evidence), A, 'the held film in present mode');
  const r1 = d.step([key(fl(1), 'ArrowRight'), evalAt(fl(5), DOC.held)], 'leaving the first stage');
  presentEntry(r1[0], 'advance', '→ on the first stage');
  const p5 = positionOf(r1[1], 'eval at 5 s');
  expect(p5 > 0 && p5 < fl(HELD.m1), `at 5 s the timeline plays toward m1 (${secs(p5)})`).toBe(true);
  const h1 = fl(5) - p5 + fl(HELD.m1);
  const r2 = d.step([
    pick(h1 + fl(PICK), 'views', 'side'),
    ...GLIDE.map((o) => evalAt(h1 + fl(PICK + o), DOC.held, { film: true })),
    key(h1 + fl(RESUME_AT), 'ArrowRight'),
    evalAt(h1 + fl(21), DOC.held),
  ], 'the long hold');
  presentEntry(r2[GLIDE.length + 1], 'advance', '→ 19.5 s into the long hold');
  const glide = GLIDE.map((off, i) => {
    const e = obj(r2[i + 1], `eval ${off} s from the pick`);
    const cam = obj(obj(obj(e['film'], `eval ${off} s from the pick: film`)['cameras'], 'film.cameras')['cam'], 'film.cameras.cam');
    return {
      off, target: arr(cam['target'], 'the camera target').map((v, k) => num(v, `target[${k}]`)), viewWidth: num(cam['view_width'], 'view_width'),
      position: positionOf(e, `eval ${off} s from the pick`),
    };
  });
  const p21 = positionOf(r2[GLIDE.length + 2], 'eval 21 s into the long hold');
  const r2at = h1 + fl(21) - (p21 - fl(HELD.m1));
  const h2 = r2at + fl(HELD.m2 - HELD.m1);
  const mix = (segments: [number, number][]): JsonObject => ({ call: 'media_mix', at: h2 + fl(7), session: DOC.held, segments: segments.map(([from, to]) => ({ from, to, write: true })) });
  const r3 = d.step([
    key(h2 + fl(3.3), 'ArrowRight'),
    ...SHORT.map((o) => evalAt(h2 + fl(o), DOC.held)),
    mix([[0, h2 + fl(6)]]),
    mix([[h1 + fl(8), h1 + fl(12)], [h1 + fl(19), h1 + fl(23)]]),
  ], 'the short hold and the replay');
  const third = presentEntry(r3[0], 'advance', '→ 3.3 s into the short hold').t;
  const short = SHORT.map((off, i) => ({ off, position: positionOf(r3[i + 1], `eval ${off} s into the short hold`) }));
  const segs = (r: JsonObject | undefined, what: string): { first: number; channels: Float32Array[] }[] => {
    const m = obj(obj(r, what)['mix'], `${what}: mix`);
    expect(m['sample_rate'], `${what}: 48 kHz`).toBe(48_000);
    return arr(m['segments'], `${what}: segments`).map((s, i) => {
      const o = obj(s, `${what}: segments[${i}]`);
      const wav = readWav(getEvidence(evidence, str(o['wav'], `${what}: segments[${i}].wav`), `${what}: segments[${i}]`), `${what}: segments[${i}]`);
      return { first: int(o['first'], `${what}: segments[${i}].first`), channels: wav.channels };
    });
  };
  const played = segs(r3[SHORT.length + 1], 'the replay played from 0')[0]!;
  const sought = segs(r3[SHORT.length + 2], 'the replay sought');
  return { evidence, h1, r2: r2at, h2, glide, third, short, played, sought };
}

describe(`${ID} a held stage: the music, a stage's glide, holds of whole bars and the replay`, () => {
  it(`${ID} a stage held 20 s keeps the music within 1 LU of its short-term loudness before the hold, the line after it waiting`, () => {
    const s = session();
    expect(s.r2 - s.h1, `the long hold lasts 20 s, ten bars (it ended ${secs(s.r2 - s.h1)} after it began)`).toBeLessThanOrEqual(fl(20) + slack);
    expect(s.r2 - s.h1, `the long hold lasts 20 s, ten bars (it ended ${secs(s.r2 - s.h1)} after it began)`).toBeGreaterThanOrEqual(fl(20) - slack);
    const ch = s.played.channels;
    expect(ch.length, 'the replay is stereo').toBe(2);
    const k = kWeighted(ch);
    const before = shortTerm(k, sampleAt(s.h1));
    expect(before, `the music sounds before the hold (${before.toFixed(2)} LUFS short-term)`).toBeGreaterThan(-30);
    const failures: string[] = [];
    for (let t = s.h1 + fl(3); t <= s.h1 + fl(20); t += fl(0.5)) {
      const l = shortTerm(k, sampleAt(t));
      if (Math.abs(l - before) > 1) failures.push(`${secs(t - s.h1)} into the hold the short-term loudness is ${l.toFixed(2)} LUFS, ${(l - before).toFixed(2)} LU from ${before.toFixed(2)} before it`);
    }
    for (let t = s.h1 + fl(0.5); t < s.h1 + fl(19.5); t += fl(0.5)) {
      const v = tonePower(ch, VOICE_HZ, sampleAt(t), sampleAt(t + fl(0.5)));
      if (v > -50) failures.push(`${secs(t - s.h1)} into the hold the line after the marker sounds (${VOICE_HZ} Hz at ${v.toFixed(1)} dBFS)`);
    }
    const after = tonePower(ch, VOICE_HZ, sampleAt(s.r2 + fl(1)), sampleAt(s.r2 + fl(1.5)));
    if (after < -30) failures.push(`1 s after the hold ends the line still doesn't sound (${VOICE_HZ} Hz at ${after.toFixed(1)} dBFS): it never played`);
    const music = tonePower(ch, MUSIC_HZ, sampleAt(s.h1 + fl(10)), sampleAt(s.h1 + fl(10.5)));
    if (music < -30) failures.push(`10 s into the hold the music is at ${music.toFixed(1)} dBFS: it held with the timeline`);
    none(failures, 'the music bus and the narration line through the long hold');
  }, TIMEOUT);

  it(`${ID} a stage picked during the hold glides the camera to its shot while the timeline stays held`, () => {
    const s = session();
    const failures: string[] = [];
    const near = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6;
    for (const g of s.glide) if (g.position !== fl(HELD.m1)) failures.push(`${g.off} s from the pick the timeline is at ${secs(g.position)}, not held at ${HELD.m1} s`);
    const [pre, ...rest] = s.glide;
    if (!near(pre!.target[0]!, FRONT.target[0]) || !near(pre!.viewWidth, FRONT.view_width)) failures.push(`before the pick the camera isn't on front's shot: target ${show(pre!.target)}, width ${pre!.viewWidth}`);
    const moving = rest.filter((g) => g.off < 0.8);
    moving.forEach((g, i) => {
      if (!(g.target[0]! > FRONT.target[0] && g.target[0]! < SIDE.target[0])) failures.push(`${g.off} s from the pick the camera's target x is ${g.target[0]}, not between front's ${FRONT.target[0]} and side's ${SIDE.target[0]}: no glide`);
      if (!(g.viewWidth < FRONT.view_width && g.viewWidth > SIDE.view_width)) failures.push(`${g.off} s from the pick the view width is ${g.viewWidth}, not between ${FRONT.view_width} and ${SIDE.view_width}`);
      const prev = moving[i - 1];
      if (prev && !(g.target[0]! > prev.target[0]!)) failures.push(`${g.off} s from the pick the camera's target x (${g.target[0]}) hasn't moved on from ${prev.target[0]} at ${prev.off} s`);
    });
    for (const g of rest.filter((x) => x.off >= 1)) {
      if (!near(g.target[0]!, SIDE.target[0]) || !near(g.target[1]!, SIDE.target[1]) || !near(g.viewWidth, SIDE.view_width)) failures.push(`${g.off} s from the pick the camera isn't on side's shot: target ${show(g.target)}, width ${g.viewWidth}`);
    }
    none(failures, "the stage's glide during the hold");
  }, TIMEOUT);

  it(`${ID} at 120 BPM in 4/4, an advance 3.3 s into a hold on a marker 1.0 s past a bar line resumes the timeline 4.0 s into it`, () => {
    const s = session();
    const into = s.third - s.h2;
    expect(into > fl(3.2) && into < fl(3.4), `the advance is 3.3 s into the short hold (${secs(into)})`).toBe(true);
    const failures: string[] = [];
    for (const { off, position } of s.short) {
      const want = fl(HELD.m2 + Math.max(0, off - 4.0));
      const ok = off < 4.0 ? position === want : Math.abs(position - want) <= slack;
      if (!ok) failures.push(`${off} s into the short hold the timeline is at ${secs(position)}, not ${secs(want)}`);
    }
    none(failures, 'the short hold, resumed on the second whole bar from its marker');
  }, TIMEOUT);

  it(`${ID} a replay of that session renders the same samples when sought as when played`, () => {
    const s = session();
    const failures: string[] = [];
    for (const [i, seg] of s.sought.entries()) {
      const n = seg.channels[0]!.length;
      let energy = 0;
      for (const c of seg.channels) for (let j = 0; j < n; j++) energy += c[j]! * c[j]!;
      if (Math.sqrt(energy / (2 * n)) < 0.05) failures.push(`sought segment ${i} is silent: the replay rendered no music there`);
      for (let c = 0; c < 2 && failures.length < 6; c++) {
        const a = seg.channels[c]!; const b = s.played.channels[c]!;
        for (let j = 0; j < n; j++) {
          if (a[j] !== b[seg.first - s.played.first + j]) { failures.push(`sought segment ${i}, channel ${c}: sample ${seg.first + j} is ${a[j]} sought and ${b[seg.first - s.played.first + j]} played`); break; }
        }
      }
    }
    none(failures, 'the replay sought against the replay played');
  }, TIMEOUT);
});

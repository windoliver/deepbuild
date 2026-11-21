// AC4 #1217.582db303: Esc clears both points; the next click places A. The input track's hash and every evaluated data
// hash are identical with the tool used and unused through a recorded session, and an export of that session has the
// same pixel hash as one with the tool off.
//
// The fixture (README: Fixtures, the recorded session): `post`, a `slab@1` of size [1, 2, 1] on the origin, and
// `marker`, a small `slab@1` whose height a driver reads from the document-class slider `lift`
// (`items/marker/at/pos/1 = h`), 4 s at 6 frames a second, seen from (4, 5, 6) on a 640 × 480 frame.
//
// One recorded session, played twice in two processes with the same inputs at the same times, but for the viewer's
// setting: `true` in the run with the tool used, `false` in the run with it unused (the base stamps each entry with its
// gesture's serial, so the two runs hold the same number of inputs). The session: the setting; a click near corner
// (0.5, 2, 0.5) of the post's top and one near (−0.5, 2, 0.5); the slider set to 0.5 at 1 s; a click near
// (0.5, 2, −0.5) and one near the first corner; Esc; a click near the second corner; the slider set to 1.5 at 2.5 s.
// Then, in each run: the input track with its hash (`track`), the evaluated data hash at 0, 0.5 s, 1.5 s, 3 s and
// 3.9 s (`eval` with `data_hash`), and an export of every frame (`png_seq` at 6 frames a second, each frame's GPU hash
// in the receipt).
//
// With the tool used the replies must show it used: the two clicks place A and B on the post's corners, 1 m apart, and
// read "1.00 m"; the third click starts again (A at the third corner, B empty); the fourth places B; Esc leaves neither
// A nor B; the next click places A alone. With the tool unused no point is ever placed. The session is real: each
// track holds exactly the two slider entries, the evaluated data differs on the two sides of each entry, and the
// export's frames before, between and after the entries differ. Then the criterion: the two tracks' hashes are equal,
// the evaluated data hashes are equal at every time, and the exports' frame hashes are equal frame for frame.
//
// The planted `measure_writes_entry` (each point placed also appends an input entry) must fail this judgement, the
// failure naming the entries.
//
// Wrong programs this fails on: the base; Esc that clears one point, or turns the tool off; a third click that moves B
// instead of starting again; a tool that writes an input entry, changes an evaluated value, or draws into an export.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FLICKS, SESSION_PIECE, TIMEOUT, Script, at, builtOf, cameraDiffers, clickNear, clickProblem, dist, fmt, isObject, measureIn, notPresented, readoutText,
  requireMetal, runShow, scenario, sessionPiece, show, useShow, useTemp, type Answer, type Fixture, type JsonObject, type JsonValue, type Measure, type Planted, type V2,
  type V3,
} from './helpers.ts';

const bin = useShow();
const temp = useTemp();
const BOUND = 1e-5;
const [C0, C1, C2] = SESSION_PIECE.corners;

interface Run {
  answer: Answer; fixture: Fixture; clicks: V2[];
  shown: number; before: number; geometry: number; setting: number; ups: number[]; esc: number; track: number; hashes: number[]; exported: number;
}
/** The recorded session, with the tool turned on (`used`) or off. */
function session(used: boolean, planted?: Planted): Run {
  const fixture = sessionPiece(4);
  // 5 px inside the top face from the corner, off the face's diagonals, so the click lies inside one triangle.
  const near = (corner: V3): V2 => clickNear(fixture.cam, corner, [corner[0] * 0.2, SESSION_PIECE.top[1], corner[2] * 0.6]);
  const clicks = [near(C0), near(C1), near(C2), near(C0), near(C1)];
  const s = new Script();
  const shown = s.present(fixture.id, fixture.document);
  const before = s.scope();
  const geometry = s.geometry(fixture.id, ['post', 'marker']);
  const setting = s.measure(used);
  const ups = [s.click(clicks[0]!)[1], s.click(clicks[1]!)[1]];
  s.until(SESSION_PIECE.entries[0]!.t);
  s.control('lift', SESSION_PIECE.entries[0]!.value, 0);
  ups.push(s.click(clicks[2]!)[1], s.click(clicks[3]!)[1]);
  const esc = s.key('Escape');
  ups.push(s.click(clicks[4]!)[1]);
  s.until(SESSION_PIECE.entries[1]!.t);
  s.control('lift', SESSION_PIECE.entries[1]!.value, 0);
  const track = s.track(fixture.id);
  const hashes = SESSION_PIECE.times.map((t) => s.dataHash(fixture.id, t));
  const exported = s.exportFrames(fixture.id, join(temp(), 'frames'), SESSION_PIECE.rate);
  const what = `AC4 the session with the tool ${used ? 'used' : 'unused'}${planted ? ` (planted ${planted})` : ''}`;
  const answer = runShow(bin(), scenario(temp(), fixture.id, fixture.size, s.calls, planted ? { planted } : {}), what);
  return { answer, fixture, clicks, shown, before, geometry, setting, ups, esc, track, hashes, exported };
}

/** What a run recorded: its input track and its hash, its evaluated data hashes, its export's frame hashes. */
interface Recorded { entries: JsonObject[]; trackHash: JsonValue | undefined; data: (JsonValue | undefined)[]; outcome: JsonValue | undefined; frames: JsonValue[] }
function recorded(x: Run): Recorded {
  const r = x.answer.replies;
  const list = at(r[x.track], 'track');
  const frames = at(r[x.exported], 'receipt', 'frame_hashes');
  return {
    entries: Array.isArray(list) ? list.filter(isObject) : [], trackHash: at(r[x.track], 'hash'),
    data: x.hashes.map((i) => at(r[i], 'data_hash')), outcome: at(r[x.exported], 'outcome'), frames: Array.isArray(frames) ? frames : [],
  };
}
const seconds = (t: number): string => `${t / FLICKS} s`;
/** The criterion's judgement of the two runs: each failure in words. */
function differences(used: Recorded, unused: Recorded): string[] {
  const out: string[] = [];
  if (used.trackHash !== unused.trackHash) {
    const known = new Set(unused.entries.map((e) => JSON.stringify(e)));
    const extra = used.entries.filter((e) => !known.has(JSON.stringify(e)));
    out.push(`the input track's hash differs: ${String(used.trackHash)} with the tool used, ${String(unused.trackHash)} unused; with the tool used the track holds ${used.entries.length} entries to ${unused.entries.length}, these not in the other: ${show(extra, 1200)}`);
  }
  SESSION_PIECE.times.forEach((t, k) => {
    if (used.data[k] !== unused.data[k]) out.push(`the evaluated data hash at ${seconds(t)} differs: ${String(used.data[k])} with the tool used, ${String(unused.data[k])} unused`);
  });
  const frame = used.frames.findIndex((h, k) => h !== unused.frames[k]);
  if (frame >= 0 || used.frames.length !== unused.frames.length) out.push(`the export's pixel hash differs${frame >= 0 ? ` at frame ${frame}: ${String(used.frames[frame])} with the tool used, ${String(unused.frames[frame])} with it off` : `: ${used.frames.length} frames to ${unused.frames.length}`}`);
  return out;
}
const placedOn = (m: Measure): (string | null)[] => [m.a?.item ?? null, m.b?.item ?? null];

describe(`${AC[4]} Esc, the next click, and a recorded session with the tool used and unused`, () => {
  it(`${AC[4]} Esc clears both points and the next click places A; the input track's hash, every evaluated data hash and the export's frame hashes are the same with the tool used and unused`, () => {
    requireMetal();
    const used = session(true);
    expect(used.answer.ok, `deep-show run takes the session with the tool used: ${show(used.answer.raw, 2000)}`).toBe(true);
    const r = used.answer.replies;
    const f = used.fixture;
    expect(notPresented(r[used.shown]), 'the piece, a document that offers the measure tool (viewer_tools: {measure: true}), is presented').toBe('');
    expect(cameraDiffers(r[used.before], f.cam), 'the panel shows the piece through the fixture\'s camera').toBe('');

    // The fixture, held to the meshes the app built, with the marker at each height the slider gives it.
    const meshes = [0, ...SESSION_PIECE.entries.map((e) => e.value)].flatMap((h) => {
      const { built, problem } = builtOf(r[used.geometry], { post: SESSION_PIECE.placed.post, marker: [SESSION_PIECE.placed.marker[0], h, SESSION_PIECE.placed.marker[2]] });
      expect(problem, 'the fixture: geometry gives the post\'s and the marker\'s built meshes').toBe('');
      return built;
    });
    [C0, C1, C2, C0, C1].forEach((corner, k) => expect(clickProblem(f.cam, meshes, used.clicks[k]!, 'post', corner), `the fixture: click ${k + 1} snaps to the post's corner ${fmt(corner)} and to nothing else`).toBe(''));

    // The tool used: A and B, a third click, Esc, the next click.
    expect(measureIn(r[used.setting]).on, `the viewer's setting turns the tool on: state.measure is ${show(at(r[used.setting], 'state', 'measure'))}`).toBe(true);
    const [one, two, three, four, five] = used.ups.map((i) => measureIn(r[i]));
    expect(placedOn(one!), `the first click places A on the post: ${show(one!.raw)}`).toEqual(['post', null]);
    expect(placedOn(two!), `the second click places B on the post: ${show(two!.raw)}`).toEqual(['post', 'post']);
    expect(dist(two!.a!.point, C0), `A is the post's corner ${fmt(C0)}: got ${fmt(two!.a!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(dist(two!.b!.point, C1), `B is the post's corner ${fmt(C1)}: got ${fmt(two!.b!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(two!.readout?.distance, `the tool reads the 1 m between the two corners: ${readoutText(two!.readout)}`).toBe('1.00 m');
    expect(placedOn(three!), `a third click starts again: A placed, B empty: ${show(three!.raw)}`).toEqual(['post', null]);
    expect(dist(three!.a!.point, C2), `the third click's A is the corner it clicked, ${fmt(C2)}: got ${fmt(three!.a!.point)}`).toBeLessThanOrEqual(BOUND);
    expect(placedOn(four!), `the fourth click places B: ${show(four!.raw)}`).toEqual(['post', 'post']);
    const cleared = measureIn(r[used.esc]);
    expect(placedOn(cleared), `Esc clears both points: state.measure is ${show(cleared.raw)}`).toEqual([null, null]);
    expect(placedOn(five!), `the next click places A, and only A: ${show(five!.raw)}`).toEqual(['post', null]);
    expect(dist(five!.a!.point, C1), `the next click's A is the corner it clicked, ${fmt(C1)}: got ${fmt(five!.a!.point)}`).toBeLessThanOrEqual(BOUND);

    // The same session with the tool unused: no point is ever placed.
    const unused = session(false);
    expect(unused.answer.ok, `deep-show run takes the session with the tool unused: ${show(unused.answer.raw, 2000)}`).toBe(true);
    const q = unused.answer.replies;
    expect(notPresented(q[unused.shown]), 'the piece is presented in the run with the tool unused').toBe('');
    expect(measureIn(q[unused.setting]).on === true, 'with the setting false the tool is off').toBe(false);
    expect([...unused.ups, unused.esc].map((i) => placedOn(measureIn(q[i]))).flat(), 'with the tool unused no click places a point').toEqual(Array(12).fill(null));

    // The session is real: two entries on the document's slider, evaluated data that moves with them, frames that differ.
    const a = recorded(used); const b = recorded(unused);
    for (const [name, rec] of [['used', a], ['unused', b]] as const) {
      expect(rec.entries.map((e) => [e['t'], e['control'], e['value']]), `the session with the tool ${name} recorded the slider's two entries, at 1 s and 2.5 s`)
        .toEqual(SESSION_PIECE.entries.map((e) => [e.t, 'lift', e.value]));
      expect(typeof rec.trackHash === 'string' && /^[0-9a-f]{64}$/.test(rec.trackHash), `the session with the tool ${name} has an input track hash: ${show(rec.trackHash)}`).toBe(true);
      expect(rec.data.every((h) => typeof h === 'string' && h.length >= 32), `the session with the tool ${name} has an evaluated data hash at each of ${SESSION_PIECE.times.map(seconds).join(', ')}: ${show(rec.data)}`).toBe(true);
      expect(new Set([rec.data[1], rec.data[2], rec.data[3]]).size, `the evaluated data differs before, between and after the slider's entries (the tool ${name})`).toBe(3);
      expect(rec.outcome, `the session with the tool ${name} is exported: ${show(name === 'used' ? r[used.exported] : q[unused.exported], 800)}`).toBe('exported');
      expect(rec.frames.length, `the export with the tool ${name} hashes each of its ${SESSION_PIECE.frames} frames`).toBe(SESSION_PIECE.frames);
      expect(new Set([rec.frames[2], rec.frames[10], rec.frames[20]]).size, `the export's frames before, between and after the slider's entries differ (the tool ${name})`).toBe(3);
    }

    // The criterion.
    expect(a.trackHash, 'the input track\'s hash is the same with the tool used and unused').toBe(b.trackHash);
    expect(a.data, 'every evaluated data hash is the same with the tool used and unused').toEqual(b.data);
    expect(a.frames, 'the export of the session has the same pixel hashes as the one with the tool off').toEqual(b.frames);
    expect(differences(a, b), 'the criterion\'s judgement, as the planted program is held to it').toEqual([]);
    console.log(`${AC[4]}: track ${String(a.trackHash)} (${a.entries.length} entries); data hashes ${a.data.map((h) => String(h).slice(0, 12)).join(', ')}; ${a.frames.length} frames, ${new Set(a.frames).size} distinct`);
  }, TIMEOUT);

  it(`${AC[4]} the planted measure_writes_entry, which appends an input entry for each point placed, fails: the input track's hash differs, naming the entries`, () => {
    requireMetal();
    const planted = session(true, 'measure_writes_entry');
    expect(planted.answer.ok, `deep-show run takes the planted measure_writes_entry: ${show(planted.answer.raw, 2000)}`).toBe(true);
    const r = planted.answer.replies;
    expect(notPresented(r[planted.shown]), 'the piece is presented under the planted program').toBe('');
    // The planted program is the tool but for the entries: it places the same points.
    expect(placedOn(measureIn(r[planted.ups[1]!])), 'the planted program still places A and B on the post').toEqual(['post', 'post']);
    const unused = session(false);
    expect(unused.answer.ok, `deep-show run takes the session with the tool unused: ${show(unused.answer.raw, 2000)}`).toBe(true);
    const a = recorded(planted); const b = recorded(unused);
    expect(b.entries.length, 'the session with the tool unused recorded the slider\'s two entries').toBe(SESSION_PIECE.entries.length);
    const found = differences(a, b);
    console.log(`${AC[4]}: planted measure_writes_entry: ${found.join('; ').slice(0, 1500)}`);
    expect(found.length, 'the criterion\'s judgement fails the planted program').toBeGreaterThan(0);
    expect(found.some((line) => line.startsWith('the input track\'s hash differs')), `a failure names the input track: ${found.join('; ').slice(0, 1500)}`).toBe(true);
    expect(a.entries.length, 'the failure names the entries the planted tool wrote: its track holds more than the slider\'s two').toBeGreaterThan(b.entries.length);
  }, TIMEOUT);
});

// AC28 #157.41e9b5bf: "A 2 s looping document at 30 fps where a dot travels once around a circle exports with film.wrap
// passing; the same dot travelling 200 px in a straight line and starting over fails film.wrap, naming the wrap, its
// change and the largest neighbour change; a `ping_pong` document isn't checked, and a planted check that compares the
// last frame with the second fails the closed orbit's fixture"
//
// Through `deep-show run`'s `export`. The films: 320 × 180 at 30 fps for 2 s (60 frames), `transport.loop: "wrap"` (or
// `"ping_pong"`), a ground and a static side panel (helpers.ts `filmDoc`, no moving bars) and a 10 × 10 dot. The orbit:
// the dot goes once around a circle of radius 60 about (224, 90), its angle stepping 5° near the wrap and 7° half way
// round (6° − cos(2π(k + ½)/60) a frame), so the wrap's change is well under the largest neighbour change, and the last
// frame against the second is well over it. The line: the dot from x = 105 to x = 305, 200 px, then starting over.
// The orbit is also read back here (`readback: true`) and the mean absolute difference of the integer BGRA bytes is
// worked out frame by frame, so the fixture itself is shown to close. A FAIL is `{check: "film.wrap", wrap: [last,
// first], change, largest}`. Planted: `wrap_compares_second_frame`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, H264_AAC, TIMEOUT, exportCall, failsNaming, filmDoc, filmRun, getEvidence, hexes, issueLines, issuesOf, none, obj, perFrame, receiptOf, rect,
  useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const RATE: [number, number] = [30, 1];

/** The orbit's angle at frame k, in degrees: the sum of its steps 6° − cos(2π(j + ½)/60); 360° at k = 60. */
const angle = (k: number): number => { let a = 0; for (let j = 0; j < k; j++) a += 6 - Math.cos((2 * Math.PI * (j + 0.5)) / 60); return a; };
function loopFilm(evidence: string, path: 'orbit' | 'line', loop: 'wrap' | 'ping_pong'): JsonObject {
  const ks = Array.from({ length: 61 }, (_, k) => k);
  const xs = path === 'orbit' ? ks.map((k) => 224 + 60 * Math.cos((angle(k) * Math.PI) / 180) - 5) : ks.map((k) => 105 + (200 * k) / 60);
  const ys = path === 'orbit' ? ks.map((k) => 90 + 60 * Math.sin((angle(k) * Math.PI) / 180) - 5) : ks.map(() => 120);
  return filmDoc(evidence, {
    frames: 60, size: [320, 180], rate: RATE, moving: false, loop,
    items: [rect('dot', [xs[0]!, ys[0]!, 10, 10], 'accent', 10)],
    channels: { dot_x: perFrame('items/dot/params/box/0', RATE, xs), dot_y: perFrame('items/dot/params/box/1', RATE, ys) },
  });
}
function loopRun(path: 'orbit' | 'line', loop: 'wrap' | 'ping_pong', planted?: Planted): { reply: JsonObject; evidence: string } {
  const evidence = temp(); const dir = temp();
  const [reply] = filmRun(shows.bin(FULL), evidence, loopFilm(evidence, path, loop), [exportCall({ out: join(dir, `${path}.mp4`), ...H264_AAC, readback: true })], `the ${path} film looping by ${loop}`, planted);
  return { reply: reply!, evidence };
}
/** The mean absolute difference of two frames' integer BGRA bytes. */
function mad(a: Buffer, b: Buffer): number { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i]! - b[i]!); return s / a.length; }
/** The judge of a film that must pass film.wrap: delivered. Each failure of a FAIL starts `film.wrap:`. */
function passFailures(reply: JsonObject): string[] {
  if (reply['outcome'] === 'exported') return [];
  const w = issuesOf(reply, 'film.wrap').map((i) => `film.wrap: ${JSON.stringify(i)}`);
  return w.length ? w : [`the export wasn't delivered: ${issueLines(reply).join(' | ').slice(0, 800)}`];
}

describe(`${AC[28]} a loop that closes passes film.wrap, and one that jumps fails it`, () => {
  it(`${AC[28]} the dot once around a circle exports with film.wrap passing, its wrap's change no larger than its largest neighbour change by this suite's own reading`, () => {
    const { reply, evidence } = loopRun('orbit', 'wrap');
    none(passFailures(reply), 'film.wrap on the closed orbit');
    const raw = hexes(obj(reply['readback'], 'the orbit: readback')['frames'], 'readback.frames').map((h, k) => getEvidence(evidence, h, `frame ${k}`));
    expect(raw.length, '60 frames read back').toBe(60);
    const neighbours = raw.slice(1).map((f, k) => mad(raw[k]!, f));
    const wrap = mad(raw[59]!, raw[0]!);
    expect(wrap <= Math.max(...neighbours), `the orbit closes: its wrap changes ${wrap.toFixed(4)}, its largest neighbour change is ${Math.max(...neighbours).toFixed(4)}`).toBe(true);
    expect(receiptOf(reply, 'the orbit').frame_hashes.length, '60 frames delivered').toBe(60);
  }, TIMEOUT);

  it(`${AC[28]} the dot 200 px along a line and starting over FAILs film.wrap, naming the wrap, its change and the largest neighbour change`, () => {
    const { reply } = loopRun('line', 'wrap');
    expect(reply['outcome'], `the line FAILs: ${issueLines(reply).join(' | ').slice(0, 800)}`).toBe('failed');
    const w = issuesOf(reply, 'film.wrap');
    expect(w.length, `one film.wrap issue: ${issueLines(reply).join(' | ').slice(0, 800)}`).toBe(1);
    const i = w[0]!;
    expect(i['wrap'], 'it names the wrap, from the last frame to the first').toEqual([59, 0]);
    expect(typeof i['change'] === 'number' && typeof i['largest'] === 'number' && i['change'] > i['largest'], `it names the wrap's change and the largest neighbour change, the first over the second: ${JSON.stringify(i)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[28]} the same line in a ping_pong document isn't checked: it is delivered`, () => {
    const { reply } = loopRun('line', 'ping_pong');
    none(passFailures(reply), 'the ping_pong document');
  }, TIMEOUT);

  it(`${AC[28]} a planted check that compares the last frame with the second fails the closed orbit`, () => {
    const { reply } = loopRun('orbit', 'wrap', 'wrap_compares_second_frame');
    failsNaming(passFailures(reply), /^film\.wrap: /, 'the planted check (wrap_compares_second_frame)');
  }, TIMEOUT);
});

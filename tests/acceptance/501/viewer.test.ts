// AC5 #501.51510fec: "In the film viewer, `.` while paused at frame 100 shows the frame whose hash equals export frame
// 101, and ⌥→ lands on the next section marker's first frame"
// AC7 #501.bc463962: "A 24 fps film played in the film viewer on a 120 Hz display shows, on every presented frame, the
// evaluated data of one export frame by hash, while a figure on the same display evaluates at each presented frame's
// time"
//
// Through `deep-show run` in the full build. The film (README: Fixtures) is presented in panel `main` and exported
// whole as a PNG sequence, whose receipt gives every export frame's hash. The viewer's keys are #383's `input` key
// events in that panel; `viewer` reads what the panel's film viewer shows: paused or not, the frame, its time and the
// BLAKE3 of the shown frame's canonical raw buffer, as the export hashes its frames (README: `viewer`). Played: #488's
// `play` on a virtual 120 Hz display with `presented: true`, which lists each presented frame's display time, the
// time evaluated and the shown frame's hash. The criteria name no wrong program.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FILM, FLICKS, FULL, PANEL, TIMEOUT, arr, exportCall, figure, film, fl, hex64, int, n, none, obj, present, presented, putEvidence,
  receiptOf, runShow, scenario, show, toneWav, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();

const key = (k: string, mods: string[] = []): JsonObject => ({ call: 'input', panel: PANEL, event: { type: 'key', key: k, mods } });
const VIEWER: JsonObject = { call: 'viewer', panel: PANEL };
interface Shown { paused: boolean; frame: number; t: number; hash: string }
function shownOf(reply: JsonObject, what: string): Shown {
  const v = obj(reply['viewer'], `${what}: viewer`);
  return { paused: v['paused'] === true, frame: int(v['frame'], `${what}: viewer.frame`), t: int(v['t'], `${what}: viewer.t`), hash: hex64(v['hash'], `${what}: viewer.hash`) };
}
/** The film presented and exported whole, then `calls`; the export's frame hashes and the replies to `calls`. */
function withExport(calls: JsonObject[], what: string): { hashes: string[]; replies: JsonObject[] } {
  const evidence = temp(); const dir = temp();
  const replies = runShow(shows.bin(FULL), scenario(evidence, [
    present(DOC.a, film(putEvidence(evidence, toneWav()))),
    exportCall({ doc: DOC.a, out: join(dir, 'frames'), video: { codec: 'png_seq' } }),
    ...calls,
  ]), what);
  presented(replies[0]!, 'the film');
  const hashes = receiptOf(replies[1]!, 'the whole film as png_seq').frame_hashes;
  expect(hashes.length, 'the export holds 240 frames').toBe(FILM.frames);
  for (const k of [100, 101, 168]) expect(hashes.indexOf(hashes[k]!), `export frame ${k} differs from every other frame`).toBe(k);
  return { hashes, replies: replies.slice(2) };
}

describe(`${AC[5]} the film viewer's frame step and section key move only the transport`, () => {
  it(`${AC[5]} paused at frame 100, . shows export frame 101 by hash, and ⌥→ lands on the next section marker's first frame, 168 (7 s)`, () => {
    const first = withExport([VIEWER], 'the viewer as it opens');
    const toPause = shownOf(first.replies[0]!, 'the viewer as it opens').paused ? [] : [key('k')];
    const { hashes, replies } = withExport([...toPause, key('4'), key('.'), key('.'), key('.'), key('.'), VIEWER, key('.'), VIEWER, key('ArrowRight', ['alt']), VIEWER], 'the viewer\'s keys');
    const at = toPause.length + 5;
    const at100 = shownOf(replies[at]!, 'after 4 and four frame steps');
    expect([at100.paused, at100.frame, at100.hash], 'the viewer is paused at frame 100, showing export frame 100').toEqual([true, 100, hashes[100]]);
    const stepped = shownOf(replies[at + 2]!, 'after . at frame 100');
    expect(stepped.frame, '. while paused steps one frame').toBe(101);
    expect(stepped.hash, '. while paused at frame 100 shows the frame whose hash equals export frame 101').toBe(hashes[101]);
    const section = shownOf(replies[at + 4]!, 'after ⌥→ at frame 101');
    expect([section.frame, section.t], '⌥→ lands on section s3\'s first frame: frame 168 at 7 s').toEqual([FILM.sections.s3, fl(7)]);
    expect(section.hash, 'and shows export frame 168').toBe(hashes[168]);
  }, TIMEOUT);
});

interface Presented { at: number; t: number; hash: string }
function presentedOf(reply: JsonObject, what: string): Presented[] {
  expect(reply['outcome'], `${what} is played: ${show(reply)}`).toBe('played');
  return arr(reply['presented'], `${what}: presented`).map((p, i) => {
    const o = obj(p, `${what}: presented[${i}]`);
    return { at: int(o['at'], `${what}: presented[${i}].at`), t: int(o['t'], `${what}: presented[${i}].t`), hash: hex64(o['hash'], `${what}: presented[${i}].hash`) };
  });
}

describe(`${AC[7]} on a 120 Hz display a 24 fps film shows whole export frames while a figure evaluates at each presented frame`, () => {
  it(`${AC[7]} over 2 s at 120 Hz, every presented frame of the film shows one export frame by hash, and every presented frame of a figure on the same display is evaluated at its own time`, () => {
    const TO = fl(2); const VSYNC = FLICKS / 120;
    const { hashes, replies } = withExport([
      present(DOC.b, figure()),
      { call: 'play', doc: DOC.a, display_hz: 120, to: TO, presented: true },
      { call: 'play', doc: DOC.b, display_hz: 120, to: TO, presented: true },
    ], 'the film and a figure on one 120 Hz display');
    presented(replies[0]!, 'the figure');
    const filmFrames = presentedOf(replies[1]!, 'the film played');
    const figFrames = presentedOf(replies[2]!, 'the figure played');
    const vsyncs = Array.from({ length: TO / VSYNC + 1 }, (_, i) => i * VSYNC);
    expect(filmFrames.map((p) => p.at), 'the film is presented on every vsync from 0 to 2 s').toEqual(vsyncs);
    expect(figFrames.map((p) => p.at), 'the figure is presented on every vsync from 0 to 2 s').toEqual(vsyncs);
    const failures: string[] = [];
    for (const p of filmFrames) {
      const k = Math.floor(p.at / FILM.frame);
      if (p.t !== k * FILM.frame) failures.push(`the film at display ${n(p.at)} evaluates at ${n(p.t)}, not export frame ${k}'s ${n(k * FILM.frame)}`);
      else if (p.hash !== hashes[k]) failures.push(`the film at display ${n(p.at)} shows a frame whose hash isn't export frame ${k}'s`);
    }
    for (const p of figFrames) if (p.t !== p.at) failures.push(`the figure presented at ${n(p.at)} evaluates at ${n(p.t)}, not its own time`);
    none(failures, 'what the 120 Hz display shows');
    expect(new Set(filmFrames.map((p) => p.hash)).size, 'the film shows export frames 0 to 48 from 0 to 2 s, each held for five vsyncs').toBe(49);
  }, TIMEOUT);
});

// AC2 #518.3c98d3de: "A test AV1 tool qualifies on the fixture film and delivers a file export.fidelity passes on a
// machine whose decode worker decodes AV1; a planted AV1 tool that drops every 100th frame fails export.fidelity,
// naming frame 100; one that tags BT.601 fails export.color, naming the tags; and on a machine whose decode worker
// can't decode AV1 the export is BLOCKED, naming the codec, and never delivered"
//
// One build, `full,test-encode-tools` (README: Cargo features): the shipped set with the native test tools, of which
// three write AV1: `test-av1@1.0.0`, `test-av1-drops-100th@1.0.0`, which leaves out frames 100, 200, 300 and so on,
// and `test-av1-bt601@1.0.0`, which tags its file nclx 6-6-6. They are native because a tool runs with only its own
// folder to read, and no AV1 encoder runs there under Node (README: Why some tools are native). A test tool encodes
// only for an export whose brief pins it. The film is the 60 s fixture film (1,440 frames), asked for as AV1 with AAC.
//
// Which leg a machine can judge is asked of the decode worker itself, apart from every tool under test: FFmpeg makes
// a half-second AV1 file and `media_decode` is asked for one frame of it (helpers.ts `decodesAv1`). The three legs
// that need a decode worker that decodes AV1 are BLOCKED where it can't, and the leg that needs one that can't is
// BLOCKED where it can; neither is ever a pass. The qualification is `deep-show run`'s `encode_qualify`, the kind's
// qualification run on one named tool.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILM60, NATIVE, TIMEOUT, TOOLS, blocked, decodesAv1, encoderOf, entriesIn, exportCall, fidelityOf, film, filmRun, framesNamed, issueLines, issuesOf, meetsFloor,
  namesCodec, namesTags, pinned, readMovie, receiptOf, show, trackOf, useFileTemp, useShow, useTemp, type JsonObject,
} from './helpers.ts';

const shows = useShow([TOOLS]);
const temp = useTemp();
const kept = useFileTemp('av1');
const AV1_AAC: JsonObject = { video: { codec: 'av1' }, audio: { codec: 'aac' } };

/** Whether this machine's decode worker decodes AV1, asked once for the file. */
let can: boolean | undefined;
function decodes(): boolean {
  can ??= decodesAv1(shows.bin(TOOLS), kept(), kept());
  return can;
}
/** The leg needs a decode worker that decodes AV1 (or one that can't): BLOCKED on the other kind of machine. */
function needs(decoding: boolean): void {
  if (decodes() === decoding) return;
  blocked(decoding
    ? 'this leg is judged on a machine whose decode worker decodes AV1, and this one\'s, asked to decode an AV1 file, gave no frame'
    : 'this leg is judged on a machine whose decode worker can\'t decode AV1, and this one\'s decoded a frame of an AV1 file');
}
/** The 60 s fixture film asked for as AV1 with AAC from `tool`: the qualification's reply, the export's, the folder. */
function av1Run(tool: string): { qualified: JsonObject; reply: JsonObject; dir: string; out: string } {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'film.mp4');
  const [qualified, reply] = filmRun(shows.bin(TOOLS), evidence, film(evidence, FILM60.seconds), [
    { call: 'encode_qualify', tool }, exportCall({ out, ...AV1_AAC, ...pinned(tool) }),
  ], `the 60 s fixture film as AV1 by ${tool}`);
  return { qualified: qualified!, reply: reply!, dir, out };
}

describe(`${AC[2]} an AV1 tool is judged by decoding its own delivery, and blocked where the decode worker can't`, () => {
  it(`${AC[2]} on a machine whose decode worker decodes AV1, the test AV1 tool qualifies and delivers the 60 s fixture film: export.fidelity reads its 1,440 frames and 2,880,000 samples, and the file holds AV1`, () => {
    needs(true);
    const { qualified, reply, out } = av1Run(NATIVE.av1);
    expect(qualified['outcome'], `encode_qualify of ${NATIVE.av1} answers qualified: ${show(qualified, 800)}`).toBe('qualified');
    const r = receiptOf(reply, 'the AV1 delivery');
    expect(encoderOf(r.raw, 'the AV1 delivery').tool, 'the receipt\'s encoder names the test AV1 tool').toBe(NATIVE.av1);
    expect(r.frame_hashes.length, 'the receipt holds the film\'s 1,440 frame hashes').toBe(FILM60.frames);
    const f = fidelityOf(r.raw, 'the AV1 delivery');
    expect([f.frames, f.samples], 'export.fidelity read the delivery\'s own bytes: 1,440 frames and 2,880,000 sample frames per channel').toEqual([FILM60.frames, FILM60.samples]);
    expect(f.worst.every((w) => meetsFloor(w.psnr_y, w.ssim, f.floor)), `every frame export.fidelity lists as worst meets its floor of ${f.floor} dB: ${JSON.stringify(f.worst.slice(0, 4))}`).toBe(true);
    // This suite's own reading of the delivered file: one video track of 1,440 samples whose sample entry is AV1's.
    expect(existsSync(out), 'the delivery is at its destination').toBe(true);
    const video = trackOf(readMovie(readFileSync(out), 'film.mp4'), 'vide', 'film.mp4');
    expect([video.entry, video.samples], 'the delivered file\'s video track is AV1 (av01), 1,440 samples').toEqual(['av01', FILM60.frames]);
  }, TIMEOUT);

  it(`${AC[2]} a planted AV1 tool that drops every 100th frame fails export.fidelity, naming frame 100, and nothing is delivered`, () => {
    needs(true);
    const { reply, dir } = av1Run(NATIVE.av1Drops);
    const said = issueLines(reply).join(' | ').slice(0, 1200);
    expect(reply['outcome'], `the delivery that lacks frames 100, 200 and so on is not delivered: ${said}`).toBe('failed');
    const named = issuesOf(reply, 'export.fidelity').flatMap(framesNamed);
    expect(named.length > 0 && Math.min(...named), `export.fidelity names frame 100, the first frame the delivery lacks: ${said}`).toBe(100);
    expect(entriesIn(dir), 'the failed export left nothing at the destination or beside it').toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} a planted AV1 tool that tags BT.601 fails export.color, naming the tags 6-6-6, and nothing is delivered`, () => {
    needs(true);
    const { reply, dir } = av1Run(NATIVE.av1Bt601);
    const said = issueLines(reply).join(' | ').slice(0, 1200);
    expect(reply['outcome'], `the delivery tagged BT.601 is not delivered: ${said}`).toBe('failed');
    const color = issuesOf(reply, 'export.color');
    expect(color.length, `an export.color issue is raised: ${said}`).toBeGreaterThan(0);
    expect(color.some((i) => namesTags(i, [6, 6, 6])), `an export.color issue names the tags the file carries, nclx 6-6-6: ${said}`).toBe(true);
    expect(entriesIn(dir), 'the failed export left nothing at the destination or beside it').toEqual([]);
  }, TIMEOUT);

  it(`${AC[2]} on a machine whose decode worker can't decode AV1, the test AV1 tool doesn't qualify and the export is BLOCKED, naming the codec av1, and never delivered`, () => {
    needs(false);
    const { qualified, reply, dir } = av1Run(NATIVE.av1);
    expect(qualified['outcome'], `encode_qualify of ${NATIVE.av1} answers blocked where its delivery can't be decoded: ${show(qualified, 800)}`).toBe('blocked');
    expect(namesCodec(qualified, 'av1'), `the blocked qualification names the codec av1: ${show(qualified, 800)}`).toBe(true);
    expect(reply['outcome'], `the export is BLOCKED: ${show(reply, 800)}`).toBe('blocked');
    expect(namesCodec(reply, 'av1'), `the BLOCKED export names the codec av1: ${show(reply, 800)}`).toBe(true);
    expect(entriesIn(dir), 'the blocked export delivered nothing and left nothing beside the destination').toEqual([]);
  }, TIMEOUT);
});

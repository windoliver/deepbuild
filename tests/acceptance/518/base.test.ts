// AC1 #518.7ecf15cf: "With today's encoders registered as encode tools, the export guards' 60 s fixture film exported
// as H.264 with AAC gives the same frame hashes and PCM hashes as on the merge base, and its receipt's encoder names
// the tool; and a planted hand-off that drops the last frame's buffer before the encode job fails export.fidelity on
// the delivery, naming the last frame"
//
// The film is the export guards' 60 s fixture film (#157's `filmDoc`: 160 × 90 at 24 fps, 1,440 frames, bars that
// move a pixel a frame, a 48 kHz stereo tone), exported as H.264 with AAC through `deep-show run`'s `export`, once by
// the merge base's own `deep-show` (helpers.ts `useBase`: the pinned commit, built from this repository's history)
// and once by this build. Their receipts' `frame_hashes` and `pcm_hashes` must be equal, hash for hash. The receipt's
// `encoder {name, version, hardware}` must name a tool as the job API names one, name@version, and `handoff` must say
// how the frames reached it; that the tool is one the job kind `encode` lists is registered.test.ts's. The merge
// base is the wrong program for the encoder: its receipt reads "VideoToolbox H.264" at the OS's version, no tool.
// Planted: `handoff_drops_last_buffer` (README: Planted programs), which this build's export.fidelity must fail on
// the delivery's own bytes, naming frame 1,439, leaving nothing.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FILM60, FULL, H264_AAC, TIMEOUT, TOOL_ID, encoderOf, entriesIn, exportCall, film, filmRun, framesNamed, handoffOf, issueLines, issuesOf, none, receiptOf,
  useBase, useFileTemp, useShow, useTemp, type JsonObject, type Planted, type Receipt,
} from './helpers.ts';

const shows = useShow([FULL]);
const base = useBase();
const temp = useTemp();
const kept = useFileTemp('base');

/** The 60 s fixture film exported as H.264 with AAC by `bin`: the reply, and the folder it wrote into. */
function export60(bin: string, what: string, dirs: () => string, planted?: Planted): { reply: JsonObject; dir: string } {
  const evidence = dirs(); const dir = dirs();
  const [reply] = filmRun(bin, evidence, film(evidence, FILM60.seconds), [exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC })], what, planted ? { planted } : {});
  return { reply: reply!, dir };
}
/** This build's delivery of the film, made once for the file. */
let made: Receipt | undefined;
function delivered(): Receipt {
  made ??= receiptOf(export60(shows.bin(FULL), 'the 60 s fixture film', kept).reply, 'the 60 s fixture film');
  return made;
}
/** Where two hash lists first differ, as one failure line, or none. */
function sameHashes(now: string[], was: string[], what: string): string[] {
  if (now.length !== was.length) return [`${what}: ${now.length} here, ${was.length} on the merge base`];
  const k = now.findIndex((h, i) => h !== was[i]);
  return k < 0 ? [] : [`${what}: frame ${k}'s is ${now[k]!} here and ${was[k]!} on the merge base`];
}

describe(`${AC[1]} the fixture film's hashes are the merge base's, its receipt names the encode tool, and a dropped last buffer fails export.fidelity`, () => {
  it(`${AC[1]} the 60 s fixture film exported as H.264 with AAC gives the same 1,440 frame hashes and 1,440 PCM hashes as on the merge base`, () => {
    const now = delivered();
    const was = receiptOf(export60(base.bin(), 'the 60 s fixture film on the merge base', temp).reply, 'the merge base\'s delivery');
    expect([was.frame_hashes.length, was.pcm_hashes.length], 'the merge base\'s receipt holds a frame hash and a PCM hash for each of the 1,440 frames').toEqual([FILM60.frames, FILM60.frames]);
    none([...sameHashes(now.frame_hashes, was.frame_hashes, 'frame hashes'), ...sameHashes(now.pcm_hashes, was.pcm_hashes, 'PCM hashes')], 'the 60 s fixture film against the merge base');
  }, TIMEOUT);

  it(`${AC[1]} the receipt's encoder {name, version, hardware} names the encode tool, name@version, and its handoff says how the frames reached it`, () => {
    const r = delivered();
    const e = encoderOf(r.raw, 'the 60 s fixture film');
    expect(TOOL_ID.test(e.tool), `the receipt's encoder names a tool of the job kind encode as the job API names one, name@version: got ${JSON.stringify(e.tool)}`).toBe(true);
    handoffOf(r.raw, 'the 60 s fixture film');
    expect(r.frame_hashes.length, 'the receipt holds the film\'s 1,440 frame hashes').toBe(FILM60.frames);
  }, TIMEOUT);

  it(`${AC[1]} a planted hand-off that drops the last frame's buffer before the encode job fails export.fidelity on the delivery, naming frame 1,439, and leaves nothing`, () => {
    const { reply, dir } = export60(shows.bin(FULL), 'the 60 s fixture film', temp, 'handoff_drops_last_buffer');
    const said = issueLines(reply).join(' | ').slice(0, 1200);
    expect(reply['outcome'], `the delivery that lacks its last frame is not delivered: ${said}`).toBe('failed');
    expect(issuesOf(reply, 'export.fidelity').some((i) => framesNamed(i).includes(FILM60.last)), `an export.fidelity issue names the last frame, ${FILM60.last}: ${said}`).toBe(true);
    expect(entriesIn(dir), 'the failed export left nothing at the destination or beside it').toEqual([]);
  }, TIMEOUT);
});

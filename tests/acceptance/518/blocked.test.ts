// AC9 #518.40d2d493: "A request for a codec no qualified tool registers is BLOCKED with 0 frames drawn and 0 frames
// hashed, naming the codec; a file already at the destination keeps its sha256, and a tool that fails at open leaves
// that file unchanged and no temporary file behind"
//
// Through `deep-show run`'s `export`, in the shipped build. The codec no tool registers is `vp9`: the design names it
// as one today's encoders don't write, and the shipped set has no tool for it. The reply must be BLOCKED, name the
// codec, and count 0 frames drawn and 0 hashed (`frames_drawn`, `frames_hashed`); with `readback: true` a drawn
// frame would also be in the evidence store, which this suite counts itself. The destination already holds a file,
// whose SHA-256 must be what it was, with nothing beside it.
//
// The tool that fails at open is this suite's own (README: The suite's tools): the test plug-in registers
// `suite-fails-open@1.0.0` through `deep.registerJobTool`, a PNG sequence tool that answers its open with an error
// and exits 1. A PNG sequence's destination is a folder, so what is already there is an earlier sequence's two
// files; after the export, which must not be delivered, each keeps its SHA-256 and the destination's folder holds
// nothing else, no temporary file or folder.
//
// The criterion names no planted twin. The merge base refuses an unknown codec as `unknown_target` and counts no
// frames, so it fails the first test; this job's twin `export_clears_destination_first` (README: Planted programs)
// shows the destination's SHA-256 is read: under it the file is gone and the judge fails, naming it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, PNG_SEQ, SUITE, TIMEOUT, entriesIn, exportCall, failsNaming, film, filmRun, filesOfSize, filesUnder, int, namesCodec, none, pinned, sha256, show, suiteTool, toolId,
  useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const FRAME_BYTES = 160 * 90 * 4;
const VP9: JsonObject = { video: { codec: 'vp9' }, audio: { codec: 'aac' } };

/** What the destination's folder holds: each file's SHA-256, and every entry, files and folders. */
interface Held { files: [string, string][]; entries: string[] }
const held = (dir: string): Held => ({ files: filesUnder(dir), entries: entriesIn(dir) });
/** What the destination's folder holds against what it held: each failure starts with the entry's path. */
function destinationFailures(dir: string, before: Held): string[] {
  const after = new Map(filesUnder(dir));
  const f: string[] = [];
  for (const [path, hash] of before.files) {
    const now = after.get(path);
    if (now === undefined) f.push(`${path}: the file that was at the destination is gone`);
    else if (now !== hash) f.push(`${path}: the file that was at the destination has SHA-256 ${now}, not the ${hash} it had`);
  }
  // No temporary file, and no temporary folder either.
  for (const path of entriesIn(dir)) if (!before.entries.includes(path)) f.push(`${path}: the export left it behind in the destination's folder`);
  return f;
}
/** The 5 s fixture film asked for as VP9 over a file already at the destination. */
function blockedRun(planted?: Planted): { reply: JsonObject; dir: string; before: Held; drawn: number } {
  const evidence = temp(); const dir = temp(); const out = join(dir, 'film.mp4');
  writeFileSync(out, 'an earlier delivery, which a blocked export must not touch\n');
  const before = held(dir);
  const document = film(evidence, 5);
  const stored = filesOfSize(evidence, FRAME_BYTES);
  const [reply] = filmRun(shows.bin(FULL), evidence, document, [exportCall({ out, ...VP9, readback: true })], 'the 5 s fixture film asked for as VP9', planted ? { planted } : {});
  return { reply: reply!, dir, before, drawn: filesOfSize(evidence, FRAME_BYTES) - stored };
}

describe(`${AC[9]} an export with no qualified tool is BLOCKED before its first frame, and no failed or blocked export touches the destination`, () => {
  it(`${AC[9]} a request for vp9, which no qualified tool registers, is BLOCKED with 0 frames drawn and 0 frames hashed, naming the codec, and the file already at the destination keeps its sha256`, () => {
    const { reply, dir, before, drawn } = blockedRun();
    expect(before.entries, 'the destination held one file before the export').toEqual(['film.mp4']);
    expect(reply['outcome'], `the export is BLOCKED: ${show(reply, 800)}`).toBe('blocked');
    expect(namesCodec(reply, 'vp9'), `the BLOCKED export names the codec vp9: ${show(reply, 800)}`).toBe(true);
    expect(int(reply['frames_drawn'], 'the BLOCKED reply: frames_drawn'), 'no frame was drawn').toBe(0);
    expect(int(reply['frames_hashed'], 'the BLOCKED reply: frames_hashed'), 'no frame was hashed').toBe(0);
    expect(drawn, 'no frame was drawn: with readback asked for, a drawn frame would be in the evidence store').toBe(0);
    none(destinationFailures(dir, before), 'the destination after the blocked export');
  }, TIMEOUT);

  it(`${AC[9]} a tool that fails at open leaves the files already at the destination unchanged and no temporary file behind`, () => {
    const evidence = temp(); const dir = temp(); const out = join(dir, 'frames');
    mkdirSync(out);
    writeFileSync(join(out, '000000.png'), 'an earlier sequence\'s first frame\n');
    writeFileSync(join(out, '000001.png'), 'an earlier sequence\'s second frame\n');
    const before = held(dir);
    expect(before.files, 'the destination held the earlier sequence\'s two files').toEqual([
      [join('frames', '000000.png'), sha256('an earlier sequence\'s first frame\n')], [join('frames', '000001.png'), sha256('an earlier sequence\'s second frame\n')],
    ]);
    const tool = toolId(SUITE.failsOpen);
    const [reply] = filmRun(shows.bin(FULL), evidence, film(evidence, 5), [exportCall({ out, ...PNG_SEQ, ...pinned(tool) })], `the 5 s fixture film through ${tool}`, { tools: [suiteTool(temp(), SUITE.failsOpen)] });
    expect(['failed', 'stopped', 'blocked', 'refused'], `the export whose tool fails at open is not delivered: ${show(reply!, 800)}`).toContain(reply!['outcome']);
    none(destinationFailures(dir, before), 'the destination after the tool failed at open');
  }, TIMEOUT);

  it(`${AC[9]} a planted export that clears the destination before it starts loses the file that was there, and fails this test, naming the file`, () => {
    const { dir, before } = blockedRun('export_clears_destination_first');
    failsNaming(destinationFailures(dir, before), /^film\.mp4: the file that was at the destination (is gone|has SHA-256)/, 'the planted export (export_clears_destination_first)');
  }, TIMEOUT);
});

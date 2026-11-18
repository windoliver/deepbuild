// AC4 #518.65044f7b: "On the reference Mac, a test encode tool that hashes each frame it receives gets the receipt's
// frame hashes in order, by GPU surface and, with `input: memory`, by copy, and the receipts read `handoff: surface`
// and `handoff: copy`; a planted handoff that sends a slot before its hash and planes are done gives the tool a frame
// whose hash differs, and fails, naming the frame"
//
// Two tools hash what they are handed, with BLAKE3 over the frame's BGRA8 rows as they read them, write the frame to
// a PNG sequence, and say in their own report which hashes they got, in order (the receipt's `encoder.report.frames`):
//   by GPU surface: `test-frames@1.0.0`, a native test tool of the `full,test-encode-tools` build (`input: surface`);
//   by copy:        `suite-frames@1.0.0`, this suite's own tool (`input: memory`), a test plug-in that registers it
//                   through `deep.registerJobTool` and whose program checks its BLAKE3 against the published vectors.
// Each encodes the 5 s fixture film (120 frames) because the request names it and its brief pins it. The tool's
// hashes must be the receipt's `frame_hashes`, one for one, and the receipt's `handoff` must read `surface` and
// `copy`. Planted: `handoff_sends_before_hash` (README: Planted programs), under which the surface tool reads a slot
// the frame isn't in yet; the judge fails, naming the first frame whose hash differs.
//
// The criterion is the reference Mac's: off one, every hash that ran is still compared, and the test then reads
// INCONCLUSIVE, never a pass.
import { join } from 'node:path';
import { describe, it } from 'vitest';
import {
  AC, FULL, NATIVE, PNG_SEQ, SUITE, TIMEOUT, TOOLS, encoderOf, exportCall, failsNaming, film, filmRun, framesNamed, handoffOf, inconclusive, issueLines, issuesIn,
  none, pinned, receiptOf, referenceMacProblem, reportedFrames, suiteTool, toolId, useShow, useTemp, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL, TOOLS]);
const temp = useTemp();
const SECONDS = 5; const FRAMES = 120;

/**
 * The judge. A failure about a frame starts `frame <k>:`, k the first frame the tool was handed whose hash isn't the
 * receipt's (or the first frame export.fidelity names, when the changed frames kept the export from delivering); a
 * failure about the receipt's `handoff` starts `handoff:`.
 */
function handedFailures(reply: JsonObject, tool: string, want: 'surface' | 'copy'): string[] {
  if (reply['outcome'] !== 'exported') {
    const named = issuesIn(reply).flatMap(framesNamed);
    const said = issueLines(reply).join(' | ').slice(0, 800);
    return [named.length ? `frame ${Math.min(...named)}: the export wasn't delivered: ${said}` : `the export wasn't delivered: ${said}`];
  }
  const what = `the delivery by ${tool}`;
  const r = receiptOf(reply, what);
  const f: string[] = [];
  const e = encoderOf(r.raw, what);
  if (e.tool !== tool) f.push(`encoder: the receipt names ${e.tool}, not ${tool}, the tool the brief pins`);
  const got = reportedFrames(r.raw, what);
  if (r.frame_hashes.length !== FRAMES) f.push(`frame ${Math.min(r.frame_hashes.length, FRAMES)}: the receipt holds ${r.frame_hashes.length} frame hashes, not ${FRAMES}`);
  const k = r.frame_hashes.findIndex((h, i) => got[i] !== h);
  if (k >= 0) f.push(`frame ${k}: the tool was handed a frame whose BLAKE3 is ${got[k] ?? 'none (it was handed no such frame)'}, and the receipt's frame hash is ${r.frame_hashes[k]!}`);
  else if (got.length !== r.frame_hashes.length) f.push(`frame ${r.frame_hashes.length}: the tool was handed ${got.length} frames, and the receipt holds ${r.frame_hashes.length}`);
  const how = handoffOf(r.raw, what);
  if (how !== want) f.push(`handoff: the receipt reads ${how}, not ${want}`);
  return f;
}
/** The 5 s fixture film through the native surface tool. */
function bySurface(planted?: Planted): JsonObject {
  const evidence = temp(); const dir = temp();
  const [reply] = filmRun(shows.bin(TOOLS), evidence, film(evidence, SECONDS), [exportCall({ out: join(dir, 'frames'), ...PNG_SEQ, ...pinned(NATIVE.frames) })],
    `the 5 s fixture film through ${NATIVE.frames}`, planted ? { planted } : {});
  return reply!;
}
/** The 5 s fixture film through the suite's memory tool. */
function byCopy(): JsonObject {
  const evidence = temp(); const dir = temp(); const tools = [suiteTool(temp(), SUITE.frames)];
  const [reply] = filmRun(shows.bin(FULL), evidence, film(evidence, SECONDS), [exportCall({ out: join(dir, 'frames'), ...PNG_SEQ, ...pinned(toolId(SUITE.frames)) })],
    `the 5 s fixture film through ${toolId(SUITE.frames)}`, { tools });
  return reply!;
}
/** Off the reference Mac only the hashes are held; the receipt's `handoff` is the reference Mac's to read. */
async function judged(failures: string[], what: string): Promise<void> {
  const problem = await referenceMacProblem(false);
  none(problem ? failures.filter((f) => !f.startsWith('handoff:')) : failures, what);
  if (problem) inconclusive(`the criterion is judged on the reference Mac, so this reading doesn't count; ${problem}`);
}

describe(`${AC[4]} a tool is handed exactly the frames the receipt hashes, by GPU surface and by copy`, () => {
  it(`${AC[4]} on the reference Mac a test tool that takes GPU surfaces is handed the receipt's 120 frame hashes in order, and the receipt reads handoff: surface`, async () => {
    await judged(handedFailures(bySurface(), NATIVE.frames, 'surface'), 'the frames handed by GPU surface');
  }, TIMEOUT);

  it(`${AC[4]} on the reference Mac a test tool with input: memory is handed the receipt's 120 frame hashes in order, and the receipt reads handoff: copy`, async () => {
    await judged(handedFailures(byCopy(), toolId(SUITE.frames), 'copy'), 'the frames handed by copy');
  }, TIMEOUT);

  it(`${AC[4]} a planted handoff that sends a slot before its hash and planes are done gives the tool a frame whose hash differs, and fails, naming the frame`, async () => {
    const problem = await referenceMacProblem(false);
    if (problem) inconclusive(`the planted handoff is one of GPU surfaces, judged on the reference Mac, so it isn't run here: ${problem}`);
    failsNaming(handedFailures(bySurface('handoff_sends_before_hash'), NATIVE.frames, 'surface'), /^frame \d+: /, 'the planted handoff (handoff_sends_before_hash)');
  }, TIMEOUT);
});

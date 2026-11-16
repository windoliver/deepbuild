// AC5 #518.326be00d: "A planted tool that writes a red square into each slot before encoding it leaves the receipt's
// frame hashes as they were and delivers a file that fails export.fidelity, naming frame 0; the same tool writing
// into each slot only after its encoder lets the frame go changes neither the delivery nor any later frame, and the
// delivery passes"
// AC6 #518.a412bee0: "A planted tool that stops returning slots after frame 500 stops the export within 11 s, with an
// issue naming the frame that found no free slot, and leaves no file; a planted export that waits for a slot with no
// deadline is still running at 60 s and fails this test"
//
// A slot is a GPU surface the export shares with a tool, so the tools that write into one or keep one are native test
// tools of the `full,test-encode-tools` build (README: The native test tools): `test-frames@1.0.0` (the tool with no
// fault), `test-red-before@1.0.0`, `test-red-after@1.0.0` and `test-keeps-slots@1.0.0`, each a PNG sequence writer
// that takes GPU surfaces, registered with `frame_delay: 2`, so its ring has four slots. A PNG sequence's fidelity is
// exact, so one changed pixel fails it. Their legs are BLOCKED off macOS and where this machine's hand-off to a
// surface tool reads `copy`.
//
// AC5: the 5 s fixture film (120 frames) three times in one run. The clean tool's receipt gives the frame hashes. The
// tool that writes a 16 × 16 red square into each slot before it reads the slot must FAIL export.fidelity naming
// frame 0, the reply still holding the same frame hashes (`frame_hashes`: a FAIL by a delivery check comes after
// every frame is hashed), and deliver nothing. The tool that writes it only once its encoder has let the frame go,
// before it returns the slot, must be delivered with the same hashes, and this suite's own reading of the delivered
// PNGs must find every frame's BGRA8 bytes hash to its frame hash: no red in the delivery or in any later frame.
//
// AC6: the 30 s fixture film (720 frames). The window is frame_delay + 2 = 4 frames, whichever input a tool takes, so
// a tool that lets go of every frame up to 500 and of none after it takes frames 501 to 504 and frame 505 finds no
// free slot. Two tools do that: this suite's own `suite-keeps-frames@1.0.0` (`input: memory`, a test plug-in
// registered through `deep.registerJobTool`) and the native `test-keeps-slots@1.0.0` (`input: surface`). Each writes
// frame k's PNG as it takes frame k, so the run is watched from outside: the moment `000504.png` appears is when the
// tool took its last frame, and the export must have stopped, the process ended, within 11 s of it, with an issue
// naming frame 505 and nothing left. Planted: `export_waits_for_slot_forever` (README: Planted programs), which is
// still running 60 s after that moment; the test stops it, by its own PID, and fails.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, NATIVE, NATIVE_FRAME_DELAY, PNG_SEQ, SUITE, TIMEOUT, TOOLS, bgra, blake3, blocked, decodePng, entriesIn, exportCall, failsNaming, film, filmRun, filmScenario,
  framesNamed, handoffOf, hexes, inconclusive, issueLines, issuesIn, issuesOf, loadProblem, none, pinned, pngFrames, pngsUnder, receiptOf, suiteTool, toolId,
  useShow, useTemp, watchShow, type JsonObject, type Planted, type Watched,
} from './helpers.ts';

const shows = useShow([FULL, TOOLS]);
const temp = useTemp();

/** A slot is a GPU surface: the legs that need one are macOS's. */
function needsSurfaces(): void {
  if (process.platform !== 'darwin') blocked(`a slot is a GPU surface handed to the tool, which this suite reads on macOS, and this is ${process.platform}`);
}

describe(`${AC[5]} a tool that writes into a slot changes nothing the export keeps`, () => {
  it(`${AC[5]} a red square written into each slot before encoding leaves the frame hashes as they were and FAILs export.fidelity naming frame 0; written only after the encoder lets the frame go, the delivery passes and holds no red in any frame`, () => {
    needsSurfaces();
    const evidence = temp(); const dir = temp();
    const out = (name: string): string => join(dir, name, 'frames');
    const [clean, before, after] = filmRun(shows.bin(TOOLS), evidence, film(evidence, 5), [
      exportCall({ out: out('clean'), ...PNG_SEQ, ...pinned(NATIVE.frames) }),
      exportCall({ out: out('before'), ...PNG_SEQ, ...pinned(NATIVE.redBefore) }),
      exportCall({ out: out('after'), ...PNG_SEQ, ...pinned(NATIVE.redAfter) }),
    ], 'the 5 s fixture film through the clean tool, the tool that writes before encoding and the tool that writes after');
    const first = receiptOf(clean!, `the delivery by ${NATIVE.frames}`);
    if (handoffOf(first.raw, `the delivery by ${NATIVE.frames}`) !== 'surface') blocked(`the hand-off to ${NATIVE.frames}, a tool that takes GPU surfaces, read copy on this machine, so no tool here is handed a slot`);
    expect(first.frame_hashes.length, 'the clean delivery holds the film\'s 120 frame hashes').toBe(120);

    // Before encoding: the hashes were taken before the hand-off, and the delivery is from changed pixels.
    const said = issueLines(before!).join(' | ').slice(0, 1200);
    expect(before!['outcome'], `the delivery from changed pixels is not delivered: ${said}`).toBe('failed');
    const named = issuesOf(before!, 'export.fidelity').flatMap(framesNamed);
    expect(named.length > 0 && Math.min(...named), `export.fidelity names frame 0, the first frame with the red square: ${said}`).toBe(0);
    expect(hexes(before!['frame_hashes'], 'the failed reply: frame_hashes (the hashes taken before the hand-off)'), 'the tool\'s write left the frame hashes as they were').toEqual(first.frame_hashes);
    expect(entriesIn(join(dir, 'before')), 'the failed export left nothing at the destination or beside it').toEqual([]);

    // After the encoder lets the frame go: nothing the export keeps changes, and the slot is drawn over before its next use.
    const last = receiptOf(after!, `the delivery by ${NATIVE.redAfter}`);
    expect(last.frame_hashes, 'the frame hashes are as they were').toEqual(first.frame_hashes);
    const pngs = pngFrames(out('after'), `the delivery by ${NATIVE.redAfter}`);
    expect(pngs.length, 'the delivery holds the film\'s 120 frames').toBe(120);
    const changed = pngs.findIndex((file, k) => blake3(bgra(decodePng(file))) !== last.frame_hashes[k]);
    expect(changed, `every delivered frame's BGRA8 bytes hash to its frame hash, so no frame carries the red square${changed >= 0 ? `; frame ${changed} doesn't` : ''}`).toBe(-1);
  }, TIMEOUT);
});

// ---------------------------------------------------------------------------------------------------
// AC6

const KEPT_AFTER = SUITE.keeps.behaviour.after;                        // 500: the last frame the tool lets go of
const LAST_TAKEN = KEPT_AFTER + NATIVE_FRAME_DELAY + 2;                  // 504: the window's four frames are 501 to 504
const FOUND_NONE = LAST_TAKEN + 1;                                     // 505: the frame that finds no free slot
const WITHIN_MS = 11_000;
const STILL_RUNNING_MS = 60_000;

interface Stalled { watched: Watched; top: number; topAt: number | null; dir: string }
/** The 30 s fixture film through a tool that lets go of no frame after 500, watched from outside. */
async function stalledRun(bin: string, tool: string, tools: JsonObject[] | undefined, planted?: Planted): Promise<Stalled> {
  const evidence = temp(); const dir = temp();
  const sc = filmScenario(evidence, film(evidence, 30), [exportCall({ out: join(dir, 'frames'), ...PNG_SEQ, ...pinned(tool) })], { ...(planted ? { planted } : {}), ...(tools ? { tools } : {}) });
  let top = -1; let topAt: number | null = null;
  const watched = await watchShow(bin, sc, {
    everyMs: 100,
    tick: (ctl) => {
      const newest = Math.max(-1, ...pngsUnder(dir));
      if (newest > top) { top = newest; topAt = ctl.elapsedMs; }
      // Once the tool holds a frame it will never let go of, the export has its deadline to stop by.
      if (top > KEPT_AFTER && topAt !== null && ctl.elapsedMs - topAt > STILL_RUNNING_MS) ctl.stop(`still running ${STILL_RUNNING_MS / 1000} s after the tool took frame ${top}`);
    },
  });
  return { watched, top, topAt, dir };
}
/** The judge. Each failure starts `no free slot:`; `late` holds the one failure that is a clock reading. */
function stallFailures(s: Stalled, tool: string): { failures: string[]; late: string | null } {
  const at = 'no free slot';
  const w = s.watched;
  if (w.stopped) return { failures: [`${at}: the export was ${w.stopped}, and this test stopped it by its PID`], late: null };
  if (w.status !== 0 || !w.replies || w.replies.length !== 2) return { failures: [`${at}: deep-show run didn't answer the scenario (exit ${String(w.status)}): ${w.stdout.slice(0, 600)} ${w.stderr.slice(-600)}`], late: null };
  if (w.replies[0]!['outcome'] !== 'presented') return { failures: [`${at}: the document wasn't presented: ${JSON.stringify(w.replies[0]).slice(0, 600)}`], late: null };
  const reply = w.replies[1]!;
  const said = issueLines(reply).join(' | ').slice(0, 800);
  const f: string[] = [];
  if (reply['outcome'] === 'exported') return { failures: [`${at}: ${tool} lets go of no frame after ${KEPT_AFTER}, and the export was delivered`], late: null };
  if (reply['outcome'] !== 'stopped') f.push(`${at}: the export's outcome is ${JSON.stringify(reply['outcome'])}, not stopped: ${said}`);
  if (!issuesIn(reply).some((i) => framesNamed(i).includes(FOUND_NONE))) f.push(`${at}: no issue names frame ${FOUND_NONE}, the frame that found no free slot once frames ${KEPT_AFTER + 1} to ${LAST_TAKEN} held the ${NATIVE_FRAME_DELAY + 2}: ${said}`);
  if (s.top !== LAST_TAKEN) f.push(`${at}: the last frame the tool took is ${s.top}, not ${LAST_TAKEN}: frames read but not yet coded are frame_delay + 2 = ${NATIVE_FRAME_DELAY + 2}`);
  const left = entriesIn(s.dir);
  if (left.length) f.push(`${at}: the stopped export left ${left.slice(0, 6).join(', ')}${left.length > 6 ? ` and ${left.length - 6} more` : ''}`);
  let late: string | null = null;
  if (s.top === LAST_TAKEN && s.topAt !== null && w.ms - s.topAt > WITHIN_MS) late = `${at}: the export stopped ${((w.ms - s.topAt) / 1000).toFixed(1)} s after the tool took frame ${LAST_TAKEN}, not within ${WITHIN_MS / 1000} s`;
  return { failures: f, late };
}
/** A stop that came late on a loaded machine counts neither way. */
function judgeStall(s: Stalled, tool: string): void {
  const { failures, late } = stallFailures(s, tool);
  none(failures, `the export through ${tool}`);
  if (late === null) return;
  const load = loadProblem();
  if (load) inconclusive(`${late}; and ${load}, so the clock reading doesn't count`);
  expect.fail(late);
}

describe(`${AC[6]} a tool that returns no slot stops the export within its deadline, naming the frame, and nothing is left`, () => {
  it(`${AC[6]} a planted tool with input: memory that lets go of no frame after 500 stops the export within 11 s of taking frame 504, with an issue naming frame 505, and leaves no file`, async () => {
    const tool = toolId(SUITE.keeps);
    judgeStall(await stalledRun(shows.bin(FULL), tool, [suiteTool(temp(), SUITE.keeps)]), tool);
  }, TIMEOUT);

  it(`${AC[6]} a planted tool that takes GPU surfaces and returns no slot after frame 500 stops the export within 11 s of taking frame 504, with an issue naming frame 505, and leaves no file`, async () => {
    needsSurfaces();
    judgeStall(await stalledRun(shows.bin(TOOLS), NATIVE.keepsSlots, undefined), NATIVE.keepsSlots);
  }, TIMEOUT);

  it(`${AC[6]} a planted export that waits for a slot with no deadline is still running at 60 s and fails this test`, async () => {
    const tool = toolId(SUITE.keeps);
    const s = await stalledRun(shows.bin(FULL), tool, [suiteTool(temp(), SUITE.keeps)], 'export_waits_for_slot_forever');
    const { failures, late } = stallFailures(s, tool);
    failsNaming([...failures, ...(late ? [late] : [])], /^no free slot: the export was still running 60 s after the tool took frame 504\b/, 'the planted export (export_waits_for_slot_forever)');
  }, TIMEOUT);
});

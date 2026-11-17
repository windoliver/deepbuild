// AC12 #518.3e752f74: "With `input: memory`, the encode job's peak memory on the 60 s fixture film stays within 10% of
// a 6 s cut's at the same size, and frames read but not yet coded never pass `frame_delay` + 2"
//
// Two readings, both of exports whose receipt reads `handoff: copy`, in the shipped build.
//
// Frames read but not yet coded are counted by a tool this suite owns (README: The suite's tools): the test plug-in
// registers `suite-slow@1.0.0` through `deep.registerJobTool` with `input: memory` and `frame_delay: 3`. It takes
// every frame as soon as it comes, and from every 100th frame on it answers none until no frame has come for 400 ms,
// then answers all it holds. So whatever the export will hand over unanswered, it does, fifteen times over the 60 s
// fixture film, and the tool reports the most frames it held unanswered at once (`encoder.report.pending_max`). That
// number may not pass frame_delay + 2 = 5.
//
// The encode job's peak memory is read from outside on the first-party tool that takes its frames by copy on every
// machine, the PNG sequence writer: `ps` reads the resident memory of every process the run starts, ten times a
// second, and the encode job's are those that aren't decode workers (by the run's own `workers` call and by their
// command line). The 60 s fixture film (1,440 frames) and its first 6 s (`range`, 144 frames, the same 160 × 90) are
// each exported in a fresh run; the peak of the 60 s run may not be more than 10% over the 6 s cut's.
//
// The criterion names no planted twin; the wrong program is the one its issue describes, `encode` at the base, which
// reads every frame into memory first and submits with no bound. This job's twin `encode_reads_all_frames_first`
// (README: Planted programs) is that program, and both readings must fail on it.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { workersCall, workersOf } from '../498/decode/helpers.ts';
import {
  AC, FILM60, FULL, PNG_SEQ, SUITE, TIMEOUT, descendants, encoderOf, exportCall, failsNaming, film, filmRun, filmScenario, fl, handoffOf, int, issueLines, none,
  pinned, receiptOf, reportOf, suiteTool, toolId, useShow, useTemp, watchShow, watchedFilm, type JsonObject, type Planted,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const MOST = SUITE.slow.frame_delay + 2;
const MiB = 1024 * 1024;

/** The judge of the count. Each failure starts `frames read but not yet coded:`. */
function countFailures(planted?: Planted): string[] {
  const at = 'frames read but not yet coded';
  const evidence = temp(); const dir = temp(); const tool = toolId(SUITE.slow);
  const [reply] = filmRun(shows.bin(FULL), evidence, film(evidence, FILM60.seconds), [exportCall({ out: join(dir, 'frames'), ...PNG_SEQ, ...pinned(tool) })],
    `the 60 s fixture film through ${tool}`, { tools: [suiteTool(temp(), SUITE.slow)], ...(planted ? { planted } : {}) });
  if (reply!['outcome'] !== 'exported') return [`${at}: the export through ${tool} wasn't delivered: ${issueLines(reply!).join(' | ').slice(0, 800)}`];
  const what = `the delivery by ${tool}`;
  const r = receiptOf(reply!, what);
  const f: string[] = [];
  if (encoderOf(r.raw, what).tool !== tool) f.push(`${at}: the receipt's encoder is ${encoderOf(r.raw, what).tool}, not ${tool}, the tool the brief pins`);
  if (handoffOf(r.raw, what) !== 'copy') f.push(`${at}: the receipt reads handoff: ${handoffOf(r.raw, what)} for a tool whose input is memory, not copy`);
  if (r.frame_hashes.length !== FILM60.frames) f.push(`${at}: the receipt holds ${r.frame_hashes.length} frame hashes, not ${FILM60.frames}`);
  const report = reportOf(r.raw, what);
  const most = int(report['pending_max'], `${what}: receipt.encoder.report.pending_max`);
  const holds = int(report['holds'], `${what}: receipt.encoder.report.holds`);
  if (holds < 1 || most < 1) f.push(`${at}: the tool reports ${holds} holds and at most ${most} frames held, so it was handed no frame to hold`);
  if (most > MOST) f.push(`${at}: the tool held ${most} frames unanswered at once, over frame_delay + 2 = ${MOST}`);
  return f;
}

interface Peak { bytes: number; processes: string[]; frames: number; handoff: string }
/** One export of the fixture film as a PNG sequence by the first-party tool, watched from outside: the encode job's
 * peak resident memory. `seconds` cuts the film to its first seconds. */
async function peakOf(seconds: number | null, planted?: Planted): Promise<Peak> {
  const evidence = temp(); const dir = temp();
  const what = seconds === null ? 'the 60 s fixture film as a PNG sequence' : `the 60 s fixture film's first ${seconds} s as a PNG sequence`;
  const ask: JsonObject = { out: join(dir, 'frames'), ...PNG_SEQ, ...(seconds === null ? {} : { range: [0, fl(seconds)] }) };
  const sc = filmScenario(evidence, film(evidence, FILM60.seconds), [exportCall(ask), workersCall()], planted ? { planted } : {});
  const samples: Map<number, number>[] = []; const commands = new Map<number, string>();
  const w = await watchShow(shows.bin(FULL), sc, {
    everyMs: 100,
    tick: (ctl) => {
      const now = new Map<number, number>();
      for (const p of descendants(ctl.pid)) { now.set(p.pid, p.rss); commands.set(p.pid, p.command); }
      samples.push(now);
    },
  });
  const [reply, workers] = watchedFilm(w, 2, what);
  const r = receiptOf(reply!, what);
  const decoders = new Set(workersOf(workers!, `${what}: workers`).filter((x) => /decode/.test(x.role)).map((x) => x.pid));
  const ofEncode = (pid: number): boolean => !decoders.has(pid) && !/decode[-_]worker/.test(commands.get(pid) ?? '');
  let bytes = 0;
  for (const s of samples) { let sum = 0; for (const [pid, rss] of s) if (ofEncode(pid)) sum += rss; bytes = Math.max(bytes, sum); }
  const processes = [...commands.keys()].filter(ofEncode).map((pid) => `${pid} ${commands.get(pid)!.slice(0, 80)}`);
  return { bytes, processes, frames: r.frame_hashes.length, handoff: handoffOf(r.raw, what) };
}
/** The judge of the memory. Each failure starts `peak memory:`. */
async function memoryFailures(planted?: Planted): Promise<string[]> {
  const at = 'peak memory';
  const cut = await peakOf(6, planted);
  const whole = await peakOf(null, planted);
  console.log(`${AC[12]}${planted ? ` planted ${planted}:` : ''} the encode job's peak resident memory: ${(whole.bytes / MiB).toFixed(1)} MiB on the 60 s film, ${(cut.bytes / MiB).toFixed(1)} MiB on its 6 s cut`);
  const f: string[] = [];
  if (cut.frames !== 144 || whole.frames !== FILM60.frames) f.push(`${at}: the 6 s cut holds ${cut.frames} frames and the 60 s film ${whole.frames}, not 144 and ${FILM60.frames}`);
  for (const [name, p] of [['the 6 s cut', cut], ['the 60 s film', whole]] as const) {
    if (p.handoff !== 'copy') f.push(`${at}: ${name}'s receipt reads handoff: ${p.handoff}; the PNG sequence writer takes its frames by copy`);
    if (!p.processes.length || p.bytes <= 0) f.push(`${at}: ${name}: no process of the encode job was seen beside the run's own (a tool runs as its own process)`);
  }
  if (f.length) return f;
  if (whole.bytes > cut.bytes * 1.1) f.push(`${at}: the encode job's peak on the 60 s film is ${(whole.bytes / MiB).toFixed(1)} MiB, more than 10% over the 6 s cut's ${(cut.bytes / MiB).toFixed(1)} MiB (${whole.processes.join('; ')})`);
  return f;
}

describe(`${AC[12]} with input: memory the encode job holds a bounded number of frames, however long the film`, () => {
  it(`${AC[12]} a memory-input tool that answers no frame while it holds is never handed more than frame_delay + 2 = 5 frames unanswered over the 60 s fixture film`, () => {
    none(countFailures(), 'frames read but not yet coded');
  }, TIMEOUT);

  it(`${AC[12]} the encode job's peak memory on the 60 s fixture film as a PNG sequence stays within 10% of its 6 s cut's at the same size`, async () => {
    none(await memoryFailures(), 'the encode job\'s peak memory');
  }, TIMEOUT);

  it(`${AC[12]} a planted encode job that reads every frame before it codes the first hands the tool more than 5 frames unanswered, and fails, naming the count`, () => {
    failsNaming(countFailures('encode_reads_all_frames_first'), /^frames read but not yet coded: the tool held \d+ frames unanswered at once, over frame_delay \+ 2 = 5/, 'the planted encode job (encode_reads_all_frames_first)');
  }, TIMEOUT);

  it(`${AC[12]} the planted encode job's peak memory on the 60 s fixture film is more than 10% over its 6 s cut's, and fails, naming both`, async () => {
    const failures = await memoryFailures('encode_reads_all_frames_first');
    failsNaming(failures, /^peak memory: the encode job's peak on the 60 s film is [\d.]+ MiB, more than 10% over the 6 s cut's [\d.]+ MiB/, 'the planted encode job (encode_reads_all_frames_first)');
    expect(failures.length, 'the planted encode job fails on its memory alone').toBe(1);
  }, TIMEOUT);
});

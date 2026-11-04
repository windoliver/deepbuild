// #37 AC16, blind redraft (REDRAFT.md): budgets, on the reference Mac in the local preflight, compared with the merge
// base: a journey run's evidence stays under 20 MB (video at 720p and 15 fps); the runner adds under 10% to
// Playwright's own time.
//
// What each measured quantity is, as this redraft reads the issue and the design (REDRAFT.md, Readings):
//
// - "A journey run": one `runJourney` of the sample app's `checkout` journey (three steps: a goto, a click inside a
//   named container and a web-first expect; two end-state checks, a locator and a readback) on the working build,
//   in its own temporary checkout, against the stack env-local starts from it and tears down after. It must pass;
//   a failed run proves no budget.
// - "A journey run's evidence": every file the run put in the evidence store, whatever its slot: the video, the
//   trace, every screenshot, the saved script, the request recording and anything else stored for it. Each run gets
//   a fresh world, so the store holds that run's files and nothing else, read from disk at the layout the design
//   fixes (Evidence: "stored once at evidence/ab/cdef…", named by SHA-256). Their sizes summed, in bytes, stay under
//   20 MB = 20,000,000 bytes (decimal, as the perf lane's 10 MB peak is 10,000,000).
// - "Video at 720p and 15 fps": the run's video is 1280×720 (the fixed viewport, not shrunk to fit a budget) and its
//   frames come 1000/15 ms apart (the median gap between consecutive frames, within half a frame per second). A
//   runner can't meet 20 MB by recording a smaller or sparser video.
// - "Playwright's own time": `playwrightTime(run)`, the ms the run spent inside Playwright doing what the journey
//   itself needs: launching the browser, opening the context with its fixed defaults and its video, each step's
//   navigation, action and expect, and closing the context and browser (which finishes the video). The stack's
//   start, health wait and teardown are neither Playwright's time nor the runner's: they are env-local's, budgeted
//   by #331, and outside both sides here.
// - "The runner adds": `run.timing.total − playwrightTime(run)`: everything else the journey runner spends on the
//   run once the stack is ready and before its teardown: reading the journey file, the per-step records (route,
//   controls, page errors, animations, screenshots), end-state checks' boxes and readbacks, scrubbing, storing the
//   evidence by hash, saving the script and attributing the served tree. Screenshots or snapshots the runner asks
//   Playwright for beyond what the journey's own steps need are the runner's addition, not Playwright's own time.
//   Read as a share: (total − playwright) / playwright < 10%. The test checks the split against what it sees from
//   outside: 0 < playwright ≤ total ≤ the wall-clock time of the `runJourney` call.
// - The rule: the design's timing rule (How we know version 0 works, Every task carries its own budgets): five runs
//   after a warm-up, PASS when all five are within the limit, FAIL when all five are over it by more than the
//   margin (the larger of 5% and the five readings' spread, as a fraction of the limit), otherwise INCONCLUSIVE with
//   all five shown, which fails the test with that word, never a skip. The size limit holds on every run, the
//   warm-up included.
// - "On the reference Mac": only on one of the design's two reference Macs, on mains power, with Low Power Mode off
//   and the thermal state nominal. Anywhere else the test fails BLOCKED, naming why, before it runs anything:
//   nothing unrun passes, and a reading off the Mac decides nothing.
// - "Compared with the merge base" and "in the local preflight": the merge base has no journey runner, so this is
//   the perf lane's first measurement: a task in benchmarks/budgets.json whose reason names #37, valid against the
//   merge base's budgets (scripts/benchmark.mjs validateBudgets), so the scheduled budget window (parallel-proof.md,
//   12a) measures every later commit against its own merge base. Its command must run and exit 0.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkout, isWebm, journey, journeyPath, NODE, openWorld, REPO, runOptions, VIEWPORT } from '../helpers.ts';

const JOURNEY = 'checkout';
const EVIDENCE_LIMIT = 20_000_000;   // bytes
const OVERHEAD_LIMIT = 10;           // % of Playwright's own time
const FPS = 15;
const RUNS = 5;

// ---- The reference Mac (design, How we know version 0 works: The reference Macs), as #331's and #348's budgets read it.
const REFERENCE_MACS = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', gib: 36 },
  { model: 'Mac15,12', chip: 'Apple M3', gib: 16 },
];
const sh = (cmd: string, ...args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
/** Why this machine's numbers are a reading only, or null on a reference Mac in a fit state. */
function environmentProblem(): string | null {
  if (process.platform !== 'darwin') return `platform ${process.platform}`;
  let model: string, chip: string, gib: number, batt: string, power: string, therm: string;
  try {
    model = sh('sysctl', '-n', 'hw.model');
    chip = sh('sysctl', '-n', 'machdep.cpu.brand_string');
    gib = Math.round(Number(sh('sysctl', '-n', 'hw.memsize')) / 2 ** 30);
    batt = sh('pmset', '-g', 'batt');
    power = sh('pmset', '-g');
    therm = sh('pmset', '-g', 'therm');
  } catch (e) {
    return `cannot read the machine: ${(e as Error).message}`;
  }
  const fingerprint = `${model} / ${chip} / ${gib} GiB`;
  if (!REFERENCE_MACS.some((m) => m.model === model && m.chip === chip && m.gib === gib)) return `not a reference Mac: ${fingerprint}`;
  if (!/'AC Power'/.test(batt)) return `not on mains power: ${batt.split('\n')[0]}`;
  const lpm = /^\s*lowpowermode\s+(\d)/m.exec(power);
  if (!lpm) return 'Low Power Mode state unknown (no lowpowermode line in pmset -g)';
  if (lpm[1] !== '0') return 'Low Power Mode is on';
  const limited = [...therm.matchAll(/_Limit\s*=\s*(\d+)/g)].some((m) => Number(m[1]) < 100);
  if (limited || !/No thermal warning level/.test(therm)) return `thermal state not nominal: ${therm.replace(/\s+/g, ' ')}`;
  return null;
}
const gate = (): void => {
  const problem = environmentProblem();
  if (problem) throw Error(`BLOCKED: #37 AC16's budgets count only on a reference Mac in a fit state, in the local preflight; this machine can't give them: ${problem}`);
};

/** The design's timing rule on five readings against a limit; throws FAIL or INCONCLUSIVE with all five shown. */
function judge(name: string, readings: number[], limit: number): void {
  const margin = Math.max(0.05, (Math.max(...readings) - Math.min(...readings)) / limit);
  const shown = `${name}: ${readings.map((r) => r.toFixed(2)).join(', ')} against ${limit} (margin ${(margin * 100).toFixed(1)}% of the limit)`;
  console.log(shown);
  if (readings.every((r) => r <= limit)) return;
  expect(readings.every((r) => r > limit * (1 + margin)), `FAIL ${shown}`).toBe(false);
  throw Error(`INCONCLUSIVE ${shown}`);
}

// ---- The run's video: its frame size and its frames' times, read from the file itself (WebM or MP4).
interface VideoTrack { width: number; height: number; framesMs: number[] }

/** A WebM (Matroska) video track: PixelWidth, PixelHeight and every frame's time from the clusters' blocks. */
function webmTrack(bytes: Uint8Array): VideoTrack {
  const b = Buffer.from(bytes);
  const vint = (at: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } => {
    const first = b[at]!;
    let length = 1;
    while (length <= 8 && !(first & (0x80 >> (length - 1)))) length++;
    if (length > 8) throw Error(`bad EBML length at ${at}`);
    let value = keepMarker ? first : first & (0xff >> length);
    let allOnes = value === (0xff >> length);
    for (let i = 1; i < length; i++) { value = value * 256 + b[at + i]!; if (b[at + i] !== 0xff) allOnes = false; }
    return { value, length, unknown: !keepMarker && allOnes };
  };
  const uint = (at: number, size: number): number => { let v = 0; for (let i = 0; i < size; i++) v = v * 256 + b[at + i]!; return v; };
  // Segment, Info, Tracks, TrackEntry, Video, Cluster, BlockGroup: descended into, so an unknown size doesn't matter.
  const MASTERS = new Set([0x18538067, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0x1f43b675, 0xa0]);
  let scale = 1_000_000;   // ns per timecode tick (TimecodeScale's default)
  let cluster = 0;
  let entry: { number: number; type: number; width: number; height: number } | null = null;
  const entries: { number: number; type: number; width: number; height: number }[] = [];
  const blocks: { track: number; tick: number }[] = [];
  for (let at = 0; at < b.length;) {
    const id = vint(at, true); at += id.length;
    const size = vint(at, false); at += size.length;
    if (MASTERS.has(id.value)) {
      if (id.value === 0xae) entries.push(entry = { number: 0, type: 0, width: 0, height: 0 });
      continue;
    }
    if (size.unknown) throw Error(`unknown-size element 0x${id.value.toString(16)} at ${at}`);
    const data = at;
    at += size.value;
    if (id.value === 0x2ad7b1) scale = uint(data, size.value);
    else if (id.value === 0xe7) cluster = uint(data, size.value);
    else if (entry && id.value === 0xd7) entry.number = uint(data, size.value);
    else if (entry && id.value === 0x83) entry.type = uint(data, size.value);
    else if (entry && id.value === 0xb0) entry.width = uint(data, size.value);
    else if (entry && id.value === 0xba) entry.height = uint(data, size.value);
    else if (id.value === 0xa3 || id.value === 0xa1) {   // SimpleBlock, Block: track number, then a signed 16-bit time
      const track = vint(data, false);
      blocks.push({ track: track.value, tick: cluster + b.readInt16BE(data + track.length) });
    }
  }
  const video = entries.find((e) => e.type === 1);
  if (!video) throw Error('the WebM file has no video track');
  const framesMs = blocks.filter((x) => x.track === video.number).map((x) => (x.tick * scale) / 1e6).sort((x, y) => x - y);
  return { width: video.width, height: video.height, framesMs };
}

/** An MP4 video track: tkhd's width and height, and every sample's time from mdhd's timescale and stts. */
function mp4Track(bytes: Uint8Array): VideoTrack {
  const b = Buffer.from(bytes);
  const tracks: { width: number; height: number; handler: string; timescale: number; deltas: number[] }[] = [];
  const walk = (from: number, to: number): void => {
    for (let at = from; at + 8 <= to;) {
      let size = b.readUInt32BE(at);
      const type = b.toString('latin1', at + 4, at + 8);
      let head = 8;
      if (size === 1) { size = Number(b.readBigUInt64BE(at + 8)); head = 16; } else if (size === 0) size = to - at;
      const body = at + head, end = at + size;
      const track = tracks[tracks.length - 1];
      if (type === 'trak') { tracks.push({ width: 0, height: 0, handler: '', timescale: 0, deltas: [] }); walk(body, end); }
      else if (['moov', 'mdia', 'minf', 'stbl'].includes(type)) walk(body, end);
      else if (track && type === 'tkhd') { track.width = b.readUInt32BE(end - 8) / 65536; track.height = b.readUInt32BE(end - 4) / 65536; }
      else if (track && type === 'hdlr') track.handler = b.toString('latin1', body + 8, body + 12);
      else if (track && type === 'mdhd') track.timescale = b.readUInt32BE(body + (b[body] === 1 ? 20 : 12));
      else if (track && type === 'stts') {
        const count = b.readUInt32BE(body + 4);
        for (let i = 0; i < count; i++) { const n = b.readUInt32BE(body + 8 + i * 8); const d = b.readUInt32BE(body + 12 + i * 8); for (let k = 0; k < n; k++) track.deltas.push(d); }
      }
      at = end;
    }
  };
  walk(0, b.length);
  const video = tracks.find((t) => t.handler === 'vide');
  if (!video || !video.timescale) throw Error('the MP4 file has no video track with a timescale');
  const framesMs = [0];
  for (const d of video.deltas.slice(0, -1)) framesMs.push(framesMs[framesMs.length - 1]! + (d * 1000) / video.timescale);
  return { width: video.width, height: video.height, framesMs };
}

function videoTrack(bytes: Uint8Array): VideoTrack {
  if (isWebm(bytes)) return webmTrack(bytes);
  if (Buffer.from(bytes).toString('latin1', 4, 8) === 'ftyp') return mp4Track(bytes);
  throw Error('the run\'s video is neither WebM nor MP4');
}
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

// ---- One measured run.
interface Measured { evidenceBytes: number; files: number; playwrightMs: number; totalMs: number; wallMs: number; addedPct: number }

/** Every file in an evidence store's folder, by hash: <root>/ab/cdef… (design, Evidence). */
function storedFiles(root: string): { sha: string; size: number }[] {
  if (!existsSync(root)) return [];
  const files: { sha: string; size: number }[] = [];
  for (const dir of readdirSync(root)) {
    if (!/^[0-9a-f]{2}$/.test(dir) || !statSync(join(root, dir)).isDirectory()) continue;
    for (const name of readdirSync(join(root, dir))) if (/^[0-9a-f]{62}$/.test(name)) files.push({ sha: dir + name, size: statSync(join(root, dir, name)).size });
  }
  return files;
}

async function measuredRun(label: string): Promise<Measured> {
  const { runJourney, playwrightTime } = await journey();
  const w = await openWorld();   // a fresh store: what it holds after the run is the run's evidence
  try {
    const dir = checkout();
    const started = performance.now();
    const run = await runJourney(runOptions(w, dir, journeyPath(JOURNEY)));
    const wallMs = performance.now() - started;
    expect(run.outcome, `${label}: the ${JOURNEY} journey passes on the working build: ${JSON.stringify(run.failures)}`).toBe('passed');

    // The evidence: every file the store holds, each of the size the store records, and every file the run names among them.
    const files = storedFiles(join(w.dir, 'evidence'));
    const held = new Set(files.map((f) => f.sha));
    const named = [run.video, run.trace, run.script, run.recording, ...run.steps.map((s) => s.screenshot), ...run.endState.map((e) => e.screenshot), ...run.evidence]
      .filter((sha): sha is string => typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha));
    for (const sha of named) expect(held.has(sha), `${label}: ${sha}, which the run names, is in its evidence store`).toBe(true);
    for (const f of files) expect((await w.evidence.get(f.sha))?.size, `${label}: the store records ${f.sha}'s size as on disk`).toBe(f.size);
    const evidenceBytes = files.reduce((sum, f) => sum + f.size, 0);

    // The video: 720p and 15 fps.
    expect(run.video, `${label}: the run stored its video`).toMatch(/^[0-9a-f]{64}$/);
    const track = videoTrack(await w.evidence.read(run.video!));
    expect({ width: track.width, height: track.height }, `${label}: the video is 720p, the fixed viewport`).toEqual(VIEWPORT);
    expect(track.framesMs.length, `${label}: the video has more than a second of frames`).toBeGreaterThan(FPS);
    const gaps = track.framesMs.slice(1).map((t, i) => t - track.framesMs[i]!);
    const fps = 1000 / median(gaps);
    expect(Math.abs(fps - FPS), `${label}: the video runs at ${FPS} fps (median frame gap ${median(gaps).toFixed(1)} ms, ${fps.toFixed(2)} fps)`).toBeLessThanOrEqual(0.5);

    // The time split: Playwright's own time, inside the run's, inside the call's wall clock.
    const playwrightMs = playwrightTime(run);
    const totalMs = run.timing.total;
    expect(playwrightMs, `${label}: Playwright's own time is measured`).toBeGreaterThan(0);
    expect(playwrightMs, `${label}: Playwright's own time is part of the run's`).toBeLessThanOrEqual(totalMs);
    expect(totalMs, `${label}: the run's time is within the call's wall clock (${wallMs.toFixed(0)} ms)`).toBeLessThanOrEqual(wallMs);
    const addedPct = ((totalMs - playwrightMs) / playwrightMs) * 100;
    console.log(`${label}: evidence ${evidenceBytes} bytes in ${files.length} files; video ${track.width}×${track.height} at ${fps.toFixed(2)} fps; `
      + `Playwright ${playwrightMs.toFixed(0)} ms, run ${totalMs.toFixed(0)} ms, call ${wallMs.toFixed(0)} ms; the runner adds ${addedPct.toFixed(2)}%`);
    return { evidenceBytes, files: files.length, playwrightMs, totalMs, wallMs, addedPct };
  } finally {
    await w.close();
  }
}

type Task = { id: string; command: string[]; initialReason?: string };

describe('AC16 #37.2f7f3193 budgets on the reference Mac in the local preflight, compared with the merge base: a journey run\'s evidence under 20 MB (video at 720p and 15 fps); the runner adds under 10% to Playwright\'s own time', () => {
  it('AC16 the perf lane has a #37 first-measurement task for a journey run, valid against the merge base\'s budgets, whose command runs and exits 0', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: Task[] };
    const base = execFileSync('/usr/bin/git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('/usr/bin/git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    const tasks = current.tasks.filter((t) => /#37\b/.test(t.initialReason ?? ''));
    expect(tasks.length, 'benchmarks/budgets.json has a task whose first-measurement reason names issue #37').toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task.command[0], `${task.id} runs with node`).toBe('node');
      execFileSync(NODE, task.command.slice(1), { cwd: REPO, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024 });
    }
  }, 600_000);

  it(`AC16 on the reference Mac, every ${JOURNEY} journey run's evidence is under 20 MB with its video at 720p and 15 fps, and the runner adds under 10% to Playwright's own time (five runs after a warm-up, by the timing rule)`, async () => {
    gate();
    const runs = [await measuredRun('warm-up')];
    for (let i = 1; i <= RUNS; i++) runs.push(await measuredRun(`run ${i}`));
    for (const [i, r] of runs.entries())
      expect(r.evidenceBytes, `${i ? `run ${i}` : 'the warm-up run'}'s evidence (${r.files} files) is under ${EVIDENCE_LIMIT} bytes`).toBeLessThan(EVIDENCE_LIMIT);
    judge('AC16 the runner\'s addition (% of Playwright\'s own time)', runs.slice(1).map((r) => r.addedPct), OVERHEAD_LIMIT);
  }, 3_600_000);
});

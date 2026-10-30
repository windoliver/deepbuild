// AC5: with its panel host stopped by SIGSTOP for 10 s while a terminal's program writes 50 MB of numbered lines, the
// cell grid after resume shows every line once and in order, and the program's writes blocked during the pause; a planted
// stream that drops its oldest chunks loses lines and fails, naming the first missing line. Real processes throughout
// (`deep-show serve`, README: Two ways to run deep-show): the hub starts the panel host as a process of its own and the
// program on a real PTY; the test stops and continues the host by the PID the hub reports and reads the program's own
// progress file. At the base `deep-show` has no `serve`.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LINES_50MB, LINE_BYTES, SLOTS, alive, allRows, gridOf, installCall, lineText, numberedLineProblems, num, obj, openCall, openedOf, pad8, program, progressOf, readBytes,
  setupOf, signal, sleep, terminalPlugin, tmp, useShow, waitFor, withServe, type Serve,
} from './helpers.ts';

const show = useShow();
const LINES = LINES_50MB;
const PAUSE_MS = 10_000;
/** The most the stream may hold back for a stopped host: the stream's own buffer is at most 16 MiB (README: Streams). */
const BUFFER_CAP = 16 * 1024 * 1024;

interface Stats { sent: number; delivered: number; buffered: number; droppedBytes: number; droppedChunks: number }
async function statsOf(s: Serve, stream: string): Promise<Stats> {
  const r = await s.ok({ call: 'stream_stats', stream }, 'the stream\'s counters (answered by the hub while the host is stopped)', 30_000);
  const dropped = obj(r['dropped'], 'stream_stats: dropped');
  return { sent: num(r['sent'], 'sent'), delivered: num(r['delivered'], 'delivered'), buffered: num(r['buffered'], 'buffered'), droppedBytes: num(dropped['bytes'], 'dropped.bytes'), droppedChunks: num(dropped['chunks'], 'dropped.chunks') };
}

interface Played {
  before: number; paused: [number, number, number]; stats: Stats; statsAfter: Stats; rows: string[]; grid: ReturnType<typeof gridOf>;
  hostPid: number; hubPid: number; programPid: number; finished: boolean; programGone: boolean;
}

/** One run: the program starts, the host is stopped for 10 s, continued, and the grid is read once the program is done and the stream drained. */
async function play(bin: string, planted?: string): Promise<Played> {
  const dir = tmp('bp');
  mkdirSync(dir, { recursive: true });
  const progress = join(dir, 'progress'), done = join(dir, 'done');
  return withServe(bin, setupOf({ evidence: dir, panels: { term: SLOTS[0]! }, ...(planted ? { planted } : {}) }), async (s) => {
    await s.ok(installCall(0, 'terminals', terminalPlugin({ term: 'T1' })), 'the terminals plug-in installs');
    const opened = openedOf(await s.call(openCall(0, 'T1', { panel: 'term', cols: 120, rows: 36, history: LINES + 100, program: program(dir, 'writer', String(LINES), progress, done) }), 120_000), 'T1');
    expect(opened.host, 'a terminal in a panel is held by a panel host process the hub starts').not.toBeNull();
    expect(opened.program, 'and its program runs on a PTY of its own').not.toBeNull();
    const hostPid = opened.host!.pid, programPid = opened.program!.pid;
    s.known.add(hostPid); s.known.add(programPid);
    expect(hostPid, 'the panel host is a process of its own, not the hub').not.toBe(s.pid);
    expect(hostPid, 'and not the program').not.toBe(programPid);
    expect(alive(hostPid), 'the host is running').toBe(true);
    // The program is under way, then the host is stopped.
    const before = await waitFor(() => progressOf(progress), (n) => n >= 20_000, 120_000);
    expect(before, 'the program has written lines before the pause').toBeGreaterThanOrEqual(20_000);
    const t0 = Date.now();
    signal(hostPid, 'SIGSTOP');
    const at = async (ms: number): Promise<number> => { await sleep(Math.max(0, t0 + ms - Date.now())); return progressOf(progress); };
    const p1 = await at(2_000);
    const stats = await statsOf(s, opened.stream);
    const p2 = await at(6_000);
    const p3 = await at(PAUSE_MS - 100);
    await sleep(Math.max(0, t0 + PAUSE_MS - Date.now()));
    signal(hostPid, 'SIGCONT');
    // After resume: the program finishes and the stream drains into the grid.
    const finished = (await waitFor(() => readBytes(done).length, (n) => n > 0, 600_000)) > 0;
    const statsAfter = await waitFor(() => statsOf(s, opened.stream), (st) => st.buffered === 0 && st.delivered === st.sent, 600_000, 250);
    const gridReply = await s.ok({ call: 'cells', terminal: 'T1' }, 'the grid after resume', 120_000);
    const grid = gridOf(gridReply, 'the grid after resume');
    const rows = await allRows(s, 'T1', grid.history + grid.rows);
    const programGone = !(await waitFor(() => alive(programPid), (a) => !a, 30_000));
    return { before, paused: [p1, p2, p3], stats, statsAfter, rows, grid, hostPid, hubPid: s.pid, programPid, finished, programGone };
  });
}

/** What "the program's writes blocked during the pause" and "nothing was dropped" ask of a run. */
function pauseProblems(p: Played): string[] {
  const f: string[] = [];
  const [p1, p2, p3] = p.paused;
  if (!(p1 === p2 && p2 === p3)) f.push(`the program kept writing while the host was stopped: ${p1} → ${p2} → ${p3} lines written at 2 s, 6 s and 9.9 s of the pause`);
  if (p3 >= LINES) f.push(`the program wrote all ${LINES} lines (50 MB) during the pause, so nothing blocked it`);
  if (p.stats.droppedBytes > 0 || p.stats.droppedChunks > 0 || p.statsAfter.droppedBytes > 0) f.push(`the stream dropped ${p.statsAfter.droppedBytes} bytes in ${p.statsAfter.droppedChunks} chunks instead of applying backpressure`);
  if (p.stats.buffered > BUFFER_CAP) f.push(`the stream holds ${p.stats.buffered} bytes for the stopped host, over its ${BUFFER_CAP}-byte buffer`);
  return f;
}
/** "The cell grid after resume shows every line once and in order". */
function gridProblems(p: Played): { problems: string[]; firstMissing: number | null } {
  const r = numberedLineProblems(p.rows, LINES);
  const problems = [...r.problems];
  if (p.rows.length !== p.grid.history + p.grid.rows) problems.push(`the grid reports ${p.grid.history} history rows and ${p.grid.rows} rows, and ${p.rows.length} were read`);
  const tail = Array.from({ length: p.grid.rows - 1 }, (_, i) => lineText(LINES - (p.grid.rows - 2) + i));
  if (JSON.stringify(p.grid.text.slice(0, p.grid.rows - 1)) !== JSON.stringify(tail)) problems.push(`the screen does not show the last ${p.grid.rows - 1} lines`);
  if (!p.finished) problems.push('the program did not finish its 50 MB after the host resumed');
  return { problems, firstMissing: r.firstMissing };
}

describe('AC5 a stopped panel host: backpressure, every line once and in order', () => {
  it('AC5 the host stopped for 10 s while the program writes 50 MB of numbered lines: its writes block during the pause, nothing is dropped, and after resume the grid shows all lines once, in order', async () => {
    const p = await play(show());
    expect(p.hostPid, 'a host of its own').not.toBe(p.hubPid);
    expect(pauseProblems(p), 'the program blocked and the stream dropped nothing').toEqual([]);
    expect(p.statsAfter.sent, 'every byte the program wrote was delivered to the host').toBeGreaterThanOrEqual(LINES * LINE_BYTES);
    const g = gridProblems(p);
    expect(g.problems, 'the grid after resume').toEqual([]);
    expect(p.programGone, 'the program ran to its end').toBe(true);
  }, 1_800_000);

  it('AC5 a stream that drops its oldest chunks when the host is stopped does not block the program and loses lines: the check fails, naming the first missing line', async () => {
    const p = await play(show(), 'terminal_drops_oldest');
    const pause = pauseProblems(p);
    expect(pause.some((m) => /kept writing|nothing blocked it|dropped/.test(m)), `the planted terminal_drops_oldest does not block or drops: ${JSON.stringify(pause)}`).toBe(true);
    const g = gridProblems(p);
    expect(g.firstMissing, `the planted stream loses lines: ${JSON.stringify(g.problems.slice(0, 2))}`).not.toBeNull();
    expect(g.problems[0], 'and the failure names the first missing line').toMatch(/^line L\d{8} is missing/);
    expect(g.problems[0]!.includes(pad8(g.firstMissing!)), 'it is the first one that is missing').toBe(true);
  }, 1_800_000);
});

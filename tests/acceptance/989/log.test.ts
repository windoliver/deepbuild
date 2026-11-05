// AC3 and AC4: the host keeps a log capped at 8 MiB, as a ring, plus one checkpoint of the screen and its modes written
// each time the ring wraps; both are owner-only files in an owner-only folder. A program prints 204.8 MB of numbered
// lines; then the hub restarts, and its tab draws the checkpoint and replays only the bytes after it, so it shows the
// last screen within 500 ms. Closing the terminal removes its log and checkpoint. Real components throughout: the
// extension host (#348) on a real record, the supervisor (#236) in the platform sandbox, the host process it starts,
// and a real program on its pseudo-terminal; the files are read on disk.
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plant, TerminalTab } from '../../../packages/extension-host/src/index.ts';
import {
  LOG_CAP, act, filesUnder, installPiece, modeOf, notesIn, numberIn, numberOf, numberedLine, octal, openHost, openTerminal, openWorld, proc, program, quit,
  sleep, tabUntil, tempDir, terminalDir, waitFor,
} from './helpers.ts';

const COLS = 100;
const ROWS = 30;
/** 3,200,000 lines of 64 bytes: 204,800,000 bytes, at least 200 MB, and no whole number of 8 MB or 8 MiB rings. */
const BUSY = 3_200_000;
/** Enough past one ring that it has wrapped: 9,600,000 bytes. */
const PAST_ONE_RING = 150_000;

/** What the tab must show once `count` lines ended in a newline: the last ROWS - 1 lines, then the cursor's empty row. */
function lastScreen(count: number): string[] {
  return [...Array.from({ length: ROWS - 1 }, (_, i) => numberedLine(count - ROWS + 2 + i)), ''];
}
const atLastScreen = (count: number) => (t: TerminalTab): boolean => JSON.stringify(t.screen) === JSON.stringify(lastScreen(count)) && t.cursor.row === ROWS - 1 && t.cursor.col === 0;
const head = (t: TerminalTab): string => JSON.stringify(t.screen.filter((r) => r).slice(-2).map((r) => r.slice(0, 12)));

/** The scrollback, oldest first, must be numbered lines in order ending right above the screen's first line. */
function scrollbackProblems(scrollback: string[], above: number, what: string): string[] {
  for (let i = 0; i < scrollback.length; i++) {
    const want = above - (scrollback.length - 1 - i);
    if (want < 1 || numberOf(scrollback[i]!) !== want) {
      return [`${what}: its scrollback of ${scrollback.length} rows isn't the lines up to line ${above} in order: row ${i} reads ${JSON.stringify(scrollback[i]!.slice(0, 16))}, not line ${want}`];
    }
  }
  return [];
}

/** The terminal's log and checkpoint: the cap, the modes, one checkpoint, and nothing else on disk that grew with the output. */
function diskProblems(worldDir: string, folder: string): string[] {
  const problems: string[] = [];
  const log = join(folder, 'log');
  const checkpoint = join(folder, 'checkpoint');
  if (modeOf(folder) !== 0o700) problems.push(`the terminal's folder ${folder} is mode ${octal(modeOf(folder))}, not 0700`);
  for (const f of [log, checkpoint]) if (modeOf(f) !== 0o600) problems.push(`${f} is mode ${octal(modeOf(f))}, not 0600`);
  const inFolder = filesUnder(folder);
  const logSize = inFolder.find((f) => f.path === log)?.size ?? 0;
  const checkpointSize = inFolder.find((f) => f.path === checkpoint)?.size ?? 0;
  if (logSize > LOG_CAP) problems.push(`${log} holds ${logSize} bytes, over the ${LOG_CAP}-byte cap`);
  for (const f of inFolder) {
    if (f.path === log || f.path === checkpoint) continue;
    if (f.kind === 'file' && /checkpoint/.test(basename(f.path))) problems.push(`${f.path} is a second checkpoint (${f.size} bytes): the host keeps one`);
    else if (f.kind === 'file' && f.size > 64 * 1024) problems.push(`${f.path} holds ${f.size} bytes beside the log and the checkpoint`);
    if (f.kind === 'file' && f.mode !== 0o600) problems.push(`${f.path} is mode ${octal(f.mode)}, not 0600`);
  }
  // Everything this world and this process's HOME hold but the record: the log, one checkpoint, and little else.
  const all = [...filesUnder(worldDir), ...filesUnder(process.env.HOME!)].filter((f) => f.kind === 'file' && !/^ledger\.db/.test(basename(f.path)));
  const total = all.reduce((n, f) => n + f.size, 0);
  const allowed = Math.min(logSize, LOG_CAP) + checkpointSize + 1024 * 1024;
  if (total > allowed) {
    const big = [...all].sort((a, b) => b.size - a.size).slice(0, 3).map((f) => `${f.path} (${f.size} bytes)`).join(', ');
    problems.push(`the world's files hold ${total} bytes on disk, more than the log and one checkpoint (${allowed} bytes with 1 MiB to spare): ${big}`);
  }
  return problems;
}

/**
 * A terminal of 100x30 whose program prints BUSY numbered lines; once it's done and the tab shows the last line, the
 * files on disk are read; the hub restarts on the same files, and its tab is read until it shows the last screen.
 * Returns every problem it sees; throws when a step it needs can't run.
 */
async function busyProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const w1 = await openWorld();
  const h1 = await openHost(w1, { plant });
  const p = await installPiece(h1);
  const dir = tempDir('busy');
  const t = await openTerminal(h1, p, program(dir, 'numbered', String(BUSY)), dir, 'busy', COLS, ROWS);
  proc((await notesIn(dir, ['pid'])).pid!);
  const done = await waitFor(() => numberIn(join(dir, 'done')), (n) => n > 0, 600_000, 500);
  if (done !== BUSY) throw Error(`the busy program wrote ${numberIn(join(dir, 'progress'))} of its ${BUSY} lines in 600 s`);
  const live = await tabUntil(h1, t.terminal, atLastScreen(BUSY), 120_000, 100);
  if (!live.ok) problems.push(`the live tab of ${t.terminal} never showed the last screen (line ${BUSY - ROWS + 2} to line ${BUSY}, the cursor below): it shows ${head(live.tab)}`);
  await sleep(500);
  const folder = terminalDir(w1, t.terminal);
  const log = join(folder, 'log');
  for (const f of [log, join(folder, 'checkpoint')]) if (!existsSync(f)) problems.push(`the host left no ${basename(f)} at ${f} after ${BUSY * 64} bytes of output`);
  problems.push(...diskProblems(w1.dir, folder));

  // The hub restarts on the same files; the tab is read from the moment its extension host starts.
  await quit(h1, w1);
  const w2 = await openWorld(w1.dir);
  const t0 = Date.now();
  const h2 = await openHost(w2, { plant });
  const back = await tabUntil(h2, t.terminal, atLastScreen(BUSY), 30_000);
  const ms = back.at - t0;
  if (!back.ok) problems.push(`after the hub restarted, the tab of ${t.terminal} never showed the last screen within 30 s (from ${log}): it shows ${head(back.tab)}, cursor at row ${back.tab.cursor.row}`);
  else if (ms > 500) problems.push(`after the hub restarted, the tab of ${t.terminal} showed the last screen ${ms} ms after the hub's extension host started, over 500 ms (from ${log})`);
  problems.push(...scrollbackProblems(back.tab.scrollback, BUSY - ROWS + 1, `after the hub restarted, the tab of ${t.terminal}`));
  return problems;
}

/** A terminal whose program wrote past one ring, so its host wrote a log and a checkpoint; the piece closes it. */
async function closeProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const w = await openWorld();
  const h = await openHost(w, { plant });
  const p = await installPiece(h);
  const dir = tempDir('closing');
  const t = await openTerminal(h, p, program(dir, 'numbered', String(PAST_ONE_RING)), dir, 'closing', COLS, ROWS);
  proc((await notesIn(dir, ['pid'])).pid!);
  if (await waitFor(() => numberIn(join(dir, 'done')), (n) => n > 0, 120_000, 200) !== PAST_ONE_RING) throw Error(`the program wrote ${numberIn(join(dir, 'progress'))} of its ${PAST_ONE_RING} lines in 120 s`);
  const folder = terminalDir(w, t.terminal);
  const files = [join(folder, 'log'), join(folder, 'checkpoint')];
  const missing = await waitFor(() => files.filter((f) => !existsSync(f)), (m) => m.length === 0, 10_000);
  if (missing.length) throw Error(`the host of ${t.terminal} wrote no ${missing.join(' and no ')} though its program wrote ${PAST_ONE_RING * 64} bytes, past the ${LOG_CAP}-byte ring: there is nothing to see removed`);
  const out = await act(h, p, 'ext.hosted.close', { terminal: t.terminal });
  if (out.closed !== true) throw Error(`closing ${t.terminal} was refused: ${String(out.refused ?? JSON.stringify(out))}`);
  const left = files.filter((f) => existsSync(f));
  if (left.length) problems.push(`closing terminal ${t.terminal} left ${left.join(', ')} on disk`);
  const rest = filesUnder(folder).map((f) => f.path).filter((f) => !files.includes(f));
  if (rest.length) problems.push(`closing terminal ${t.terminal} left its folder holding ${rest.join(', ')}`);
  return problems;
}

describe('AC3 a busy terminal leaves at most an 8 MiB log and one checkpoint, and a restarted hub shows its last screen within 500 ms', () => {
  it('AC3 204.8 MB of numbered lines leave at most 8 MiB of log plus one checkpoint, both 0600 in a 0700 folder; after the hub restarts the tab shows the last screen and its scrollback in order within 500 ms', async () => {
    expect(await busyProblems()).toEqual([]);
  }, 1_200_000);

  it('AC3 (wrong program) replays-from-first-byte: a host that keeps every byte and replays from the first takes over 500 ms or exceeds the cap, and fails naming the file', async () => {
    const problems = (await busyProblems('replays-from-first-byte')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/\/log holds \d+ bytes, over the 8388608-byte cap|over 500 ms \(from \S+\/log\)/);
  }, 1_200_000);
});

describe('AC4 closing a terminal removes its log and checkpoint', () => {
  it('AC4 closing a terminal whose host wrote a log and a checkpoint removes both', async () => {
    expect(await closeProblems()).toEqual([]);
  }, 300_000);

  it('AC4 (wrong program) leaves-files-on-close: a host that leaves them fails, naming the files', async () => {
    const problems = (await closeProblems('leaves-files-on-close')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/closing terminal term:\S+ left \S+\/log, \S+\/checkpoint on disk/);
  }, 300_000);
});

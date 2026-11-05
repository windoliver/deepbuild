// AC7: the host states its protocol version when the hub connects, and the hub reattaches only a host whose version it
// speaks. A hub speaking the version before this build's (`terminalProtocol`, standing in for the last release) opens a
// terminal whose program prints numbered lines, past one ring and then one every 50 ms; the hub restarts at this
// build's version (TERMINAL_PROTOCOL). The older host keeps its program running: the same PID, its lines still
// advancing; the tab names both versions, shows the last screen read-only and keeps input off; the hub never stops the
// older host, never reads the session as ended, and never starts a second program on it. "The session" is the hosted
// terminal the tab shows (README, Readings). Real components throughout, as in the other files.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plant, TerminalTab } from '../../../packages/extension-host/src/index.ts';
import {
  YOU, host, installPiece, listed, loadAll, message, notesIn, numberIn, numberOf, openHost, openTerminal, openWorld, parentOf, proc, program, quit,
  readText, running, sleep, tabOf, tempDir, waitFor,
} from './helpers.ts';

const ROWS = 30;
const BURST = 150_000;
const has = (text: string, n: number): boolean => new RegExp(`(^|[^0-9])${n}([^0-9]|$)`).test(text);

async function olderHostProblems(plant?: Plant): Promise<string[]> {
  const { TERMINAL_PROTOCOL } = await host();
  if (!Number.isSafeInteger(TERMINAL_PROTOCOL) || TERMINAL_PROTOCOL < 1) throw Error(`the extension host exports no TERMINAL_PROTOCOL, the terminal host protocol version this build speaks: ${String(TERMINAL_PROTOCOL)}`);
  const OLD = TERMINAL_PROTOCOL - 1;
  const problems: string[] = [];
  const w1 = await openWorld();
  const h1 = await openHost(w1, { plant, terminalProtocol: OLD });
  const p = await installPiece(h1);
  const dir = tempDir('older');
  const t = await openTerminal(h1, p, program(dir, 'numbered', String(BURST), 'slow'), dir, 'older', 100, ROWS);
  const prog = proc((await notesIn(dir, ['pid'])).pid!);
  const hostProc = parentOf(prog.pid);
  if (await waitFor(() => numberIn(join(dir, 'done')), (n) => n > 0, 120_000, 200) !== BURST) throw Error(`the program wrote ${numberIn(join(dir, 'progress'))} of its first ${BURST} lines in 120 s`);
  await waitFor(() => numberIn(join(dir, 'progress')), (n) => n >= BURST + 10, 5000);
  const session = t.terminal;

  // The hub restarts at this build's version.
  await quit(h1, w1);
  const w2 = await openWorld(w1.dir);
  const h2 = await openHost(w2, { plant });
  const atStart = numberIn(join(dir, 'progress'));
  await loadAll(h2);

  let tab: TerminalTab | undefined;
  try {
    tab = await tabOf(h2, session);
  } catch (e) {
    problems.push(`the tab of session ${session} couldn't be read after the hub restarted: ${message(e)}`);
  }
  await sleep(1000);
  const later = numberIn(join(dir, 'progress'));
  if (!running(hostProc)) problems.push(`the hub stopped the older host (pid ${hostProc.pid}) of session ${session} when it restarted at protocol ${TERMINAL_PROTOCOL}`);
  if (!running(prog) || numberIn(join(dir, 'pid')) !== prog.pid) problems.push(`session ${session}'s program (pid ${prog.pid}) under the older host (pid ${hostProc.pid}) didn't keep running: running ${running(prog)}, its pid note reads ${numberIn(join(dir, 'pid'))}`);
  else if (later < atStart + 5) problems.push(`session ${session}'s lines stopped advancing under the older host (pid ${hostProc.pid}): line ${atStart} when the hub restarted, line ${later} 1 s later`);
  if (tab) {
    if (tab.ended) problems.push(`the tab reads session ${session} as ended and offers Resume while its program (pid ${prog.pid}) runs under the older host (pid ${hostProc.pid})`);
    const notice = tab.notice ?? '';
    if (!/older host/i.test(notice) || !has(notice, OLD) || !has(notice, TERMINAL_PROTOCOL)) problems.push(`the tab of session ${session} doesn't say it runs on an older host naming protocol ${OLD} and ${TERMINAL_PROTOCOL}: its notice reads ${JSON.stringify(tab.notice)}`);
    if (tab.input) problems.push(`the tab of session ${session} takes input, though it runs on the older host (pid ${hostProc.pid})`);
    const lines = tab.screen.filter((r) => r).map(numberOf);
    const consecutive = lines.every((n, i) => n !== null && (i === 0 || n === lines[i - 1]! + 1));
    if (lines.length < ROWS - 1 || !consecutive || (lines[lines.length - 1] ?? Infinity) > atStart) {
      problems.push(`the tab of session ${session} doesn't show the last screen: its rows aren't ${ROWS - 1} or more consecutive numbered lines up to line ${atStart}: ${JSON.stringify(tab.screen.filter((r) => r).slice(-2).map((r) => r.slice(0, 12)))}`);
    }
    const still = await tabOf(h2, session).catch(() => undefined);
    if (still && JSON.stringify(still.screen) !== JSON.stringify(tab.screen)) problems.push(`the tab of session ${session} isn't read-only: its screen changed in the second its program ran on (now ${JSON.stringify(still.screen.filter((r) => r).slice(-1).map((r) => r.slice(0, 12)))})`);
  }
  const typed = 'typed-into-older-host';
  let taken = true;
  try {
    await h2.rawInput(YOU, session, `${typed}\r`);
  } catch {
    taken = false;
  }
  await sleep(1000);
  if (taken) problems.push(`the hub took raw input for session ${session}, which runs on the older host (pid ${hostProc.pid}); input stays off`);
  if (readText(join(dir, 'typed')).includes(typed)) problems.push(`session ${session}'s program read input typed after the hub restarted, though it runs on the older host`);
  const tabs = await listed(h2, p);
  const ours = tabs.filter((x) => x.terminal === session);
  if (ours.length !== 1 || ours[0]!.pid !== prog.pid || tabs.length !== 1) problems.push(`after the hub restarted the piece lists ${JSON.stringify(tabs)}, not session ${session} alone with its program (pid ${prog.pid}): a second program, or the first lost`);
  return problems;
}

describe('AC7 a host of another protocol version keeps its program running, read-only, across a hub update', () => {
  it('AC7 restarting the hub at the newer version leaves the older host\'s program running (same PID, lines advancing); the tab names both versions, shows the last screen read-only and keeps input off', async () => {
    expect(await olderHostProblems()).toEqual([]);
  }, 300_000);

  it('AC7 (wrong program) stops-older-host: a hub that stops the older host fails, naming the host\'s PID and the session', async () => {
    const problems = (await olderHostProblems('stops-older-host')).join('\n');
    expect(problems, 'the planted hub must fail the same check').toMatch(/stopped the older host \(pid \d+\) of session term:\S+/);
  }, 300_000);

  it('AC7 (wrong program) older-host-reads-ended: a hub that reads the session as ended and offers Resume while its program runs fails, naming the host\'s PID and the session', async () => {
    const problems = (await olderHostProblems('older-host-reads-ended')).join('\n');
    expect(problems, 'the planted hub must fail the same check').toMatch(/reads session term:\S+ as ended and offers Resume while its program \(pid \d+\) runs under the older host \(pid \d+\)/);
  }, 300_000);
});

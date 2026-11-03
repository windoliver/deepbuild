// AC5 and AC6: input reaches a hosted terminal's host only over a connection from the hub's own process, checked by the
// peer's PID against the hub's lock, and the host never blocks its output on its input. A shell an agent in another
// session started (a real process of yours, outside the hub) opens the terminal's input wherever its folder offers one
// and writes `echo planted`: it's refused, the program reads nothing, and the record names the writer's process; the
// hub's own write of a focused-tab key goes through. A 4 MiB paste into a program that reads slowly arrives whole and
// in order, while the program's output keeps reaching the tab. This process holds the hub's lock, as the hub does
// (helpers.ts, openWorld). Real components throughout: the extension host (#348), the supervisor (#236) in the platform
// sandbox, the host process it starts, and real programs.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plant, TerminalTab } from '../../../packages/extension-host/src/index.ts';
import {
  YOU, agentShellWrites, holdsNumber, installPiece, message, notesIn, openHost, openTerminal, openWorld, proc, program, readText, sleep, tabOf, tabUntil,
  tempDir, terminalDir, waitFor,
} from './helpers.ts';

const PLANTED = 'echo planted';

/** A reader in a terminal; an agent's shell writes `echo planted` into the terminal's input; then the hub writes a key. */
async function agentProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const w = await openWorld();
  const h = await openHost(w, { plant });
  const p = await installPiece(h);
  const notes = tempDir('reader');
  const t = await openTerminal(h, p, program(notes, 'reader'), notes, 'reader', 80, 24);
  proc((await notesIn(notes, ['pid', 'ready'])).pid!);
  const log = (): string => readText(join(notes, 'log'));
  const before = Math.max(0, ...(await w.events()).map((e) => e.log_pos));

  const folder = terminalDir(w, t.terminal);
  const attempt = await agentShellWrites(folder, `${PLANTED}\r`);
  if (!attempt.results.length) throw Error(`the agent's shell (pid ${attempt.pid}) found no FIFO or socket in ${t.terminal}'s folder ${folder} to open: the host's input must be there (README) for the refusal to be tried`);
  await sleep(1500);
  if (log().includes(PLANTED)) {
    const through = attempt.results.filter((r) => r.wrote).map((r) => r.path).join(', ');
    problems.push(`terminal ${t.terminal}'s program read "${PLANTED}", written by the agent's shell (pid ${attempt.pid}) through ${through || 'its input'}`);
  }
  const named = await waitFor(
    async () => (await w.events()).filter((e) => e.log_pos > before && e.kind !== 'process.tracked' && JSON.stringify(e.data).includes(t.terminal) && holdsNumber(e.data, attempt.pid)),
    (v) => v.length > 0, 5000,
  );
  if (!named.length) problems.push(`the record names no refused writer: no event after the agent's attempt names terminal ${t.terminal} and the writer's process (pid ${attempt.pid})`);

  const key = 'focused-key-k7';
  await h.rawInput(YOU, t.terminal, key);
  if (!(await waitFor(log, (l) => l.includes(key), 5000)).includes(key)) problems.push(`the hub's own write of a focused-tab key never reached terminal ${t.terminal}'s program: its log reads ${JSON.stringify(log().slice(-80))}`);
  return problems;
}

/** 4 MiB of numbered paste lines: `P` and the line's number in 7 digits, a space, dashes, a newline; 64 bytes each. */
const PASTE_BYTES = 4 * 1024 * 1024;
const PASTE = Array.from({ length: PASTE_BYTES / 64 }, (_, i) => `${`P${String(i + 1).padStart(7, '0')} `.padEnd(63, '-')}\n`).join('');
/** The reader takes 1 MiB a second, so the paste takes about 4 s to drain. */
const RATE = 1024 * 1024;
const latestBeat = (t: TerminalTab): number => Math.max(0, ...t.screen.flatMap((r) => [...r.matchAll(/beat (\d+)/g)].map((m) => Number(m[1]))));

/** A slow reader printing a beat every 50 ms gets a 4 MiB paste from the app; the tab is watched while it drains. */
async function pasteProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const w = await openWorld();
  const h = await openHost(w, { plant });
  const p = await installPiece(h);
  const notes = tempDir('slow');
  const t = await openTerminal(h, p, program(notes, 'slow-reader', String(RATE)), notes, 'slow', 80, 24);
  proc((await notesIn(notes, ['pid', 'ready'])).pid!);
  const first = await tabUntil(h, t.terminal, (x) => latestBeat(x) >= 3, 10_000, 20);
  if (!first.ok) throw Error(`the tab of ${t.terminal} never showed the slow reader's beats before the paste: ${JSON.stringify(first.tab.screen.slice(0, 3))}`);
  const size = (): number => { try { return statSync(join(notes, 'log')).size; } catch { return 0; } };

  const samples: { at: number; beat: number }[] = [];
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      try { samples.push({ at: Date.now(), beat: latestBeat(await tabOf(h, t.terminal)) }); } catch { /* a read that failed shows nothing new */ }
      await sleep(20);
    }
  })();
  const t0 = Date.now();
  let threw: string | null = null;
  try {
    await h.rawInput(YOU, t.terminal, PASTE);
  } catch (e) {
    threw = message(e);
  }
  // The drain: until the program has read the whole paste, or nothing more came for 3 s.
  for (let last = -1, changed = Date.now(); ;) {
    const n = size();
    if (n !== last) { last = n; changed = Date.now(); }
    if (n >= PASTE_BYTES || Date.now() - changed > 3000 || Date.now() - t0 > 120_000) break;
    await sleep(50);
  }
  const drained = Date.now();
  watching = false;
  await watcher;

  const got = readFileSync(join(notes, 'log'));
  const sent = Buffer.from(PASTE);
  if (!got.equals(sent)) {
    let at = 0;
    while (at < got.length && at < sent.length && got[at] === sent[at]) at++;
    if (!got.length && threw) problems.push(`terminal ${t.terminal}'s program received none of the ${PASTE_BYTES}-byte paste: it was refused whole (${threw}), not taken whole`);
    else problems.push(`terminal ${t.terminal}'s program received ${got.length} of ${PASTE_BYTES} bytes of the paste${threw ? ` (the hub threw: ${threw})` : ''}: the paste stopped at byte ${at}`);
  } else if (threw) problems.push(`terminal ${t.terminal}'s paste arrived whole, yet the hub's write threw: ${threw}`);

  // The longest stretch of the drain in which the tab showed no new beat.
  let gap = 0;
  let gapFrom = t0;
  let stuck = 0;
  let lastAt = t0;
  let lastBeat = [...samples].reverse().find((s) => s.at <= t0)?.beat ?? latestBeat(first.tab);
  for (const s of samples.filter((x) => x.at > t0 && x.at <= drained)) {
    if (s.beat <= lastBeat) continue;
    if (s.at - lastAt > gap) { gap = s.at - lastAt; gapFrom = lastAt; stuck = lastBeat; }
    lastAt = s.at;
    lastBeat = s.beat;
  }
  if (drained - lastAt > gap) { gap = drained - lastAt; gapFrom = lastAt; stuck = lastBeat; }
  if (gap > 500) problems.push(`while the paste drained (${drained - t0} ms), terminal ${t.terminal}'s tab showed no new output for ${gap} ms, from ${gapFrom - t0} ms after the paste began, stuck at beat ${stuck}`);
  return problems;
}

describe('AC5 input reaches the host only from the hub\'s own process', () => {
  it('AC5 a shell an agent in another session started opens the terminal\'s input and writes "echo planted": it is refused, the program reads nothing, and the record names the writer\'s process; the hub\'s own write of a focused-tab key goes through', async () => {
    expect(await agentProblems()).toEqual([]);
  }, 120_000);

  it('AC5 (wrong program) input-through-fifo: a host that also reads a FIFO in the terminal\'s folder, as the base does, fails, naming the writer\'s process', async () => {
    const problems = (await agentProblems('input-through-fifo')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/program read "echo planted", written by the agent's shell \(pid \d+\)/);
  }, 120_000);
});

describe('AC6 the host never blocks its output on its input, and the hub sends input with backpressure', () => {
  it('AC6 a 4 MiB paste into a program that reads slowly arrives whole and in order, and while it drains the program\'s output keeps reaching the tab', async () => {
    expect(await pasteProblems()).toEqual([]);
  }, 180_000);

  it('AC6 (wrong program) input-blocks-output: a host whose input write blocks its output loop shows no output for the drain and fails', async () => {
    const problems = (await pasteProblems('input-blocks-output')).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/tab showed no new output for \d+ ms/);
  }, 180_000);

  it('AC6 (wrong program) hub-throws-when-full: a hub that throws when the pipe fills delivers part of the paste and fails, naming the byte where it stopped', async () => {
    const problems = (await pasteProblems('hub-throws-when-full')).join('\n');
    expect(problems, 'the planted hub must fail the same check').toMatch(/received \d+ of 4194304 bytes of the paste \(the hub threw: .*\): the paste stopped at byte \d+/);
  }, 180_000);
});

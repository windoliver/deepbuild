// AC1: the plug-in built from "Host my agents' terminals in tabs, and keep them running when I quit the app" installs
// with run-as-you and passes its own tests: its terminals keep running after the app quits, and its tabs show them
// again at the next launch; its copy whose manifest leaves out run-as-you is refused at its first command, naming the
// permission. Real components throughout: the extension host (#348) on a real record, the supervisor (#236) with
// Seatbelt, and real programs on the terminals the hub hosts. "The app quits" is read as the strongest case the hub
// side can show: the extension host, the supervisor and the record all close (README, Readings).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import {
  RUN_AS_YOU, YOU, host, installAndLoad, message, numberIn, openHost, openTerminal, openWorld, outputOf, pidsIn, pkg, proc, program, quit, refusalsNaming,
  relaunch, running, sleep, tabsOf, tempDir, trackedPids, waitFor, type Proc,
} from './helpers.ts';

const ID = 'test/agent-terminals';
const OPEN = 'ext.agent-terminals.open';
const ticks = (text: string): number[] => [...text.matchAll(/tick (\d+)/g)].map((m) => Number(m[1]));
/** The problems in a run of numbered ticks: each from 1, once, in order, up to at least `least`. */
function tickProblems(seen: number[], least: number, what: string): string[] {
  const out: string[] = [];
  const bad = seen.findIndex((t, i) => t !== i + 1);
  if (bad >= 0) out.push(`${what}: tick ${bad + 1} is ${seen[bad]} (lost or repeated output)`);
  if (seen.length < least) out.push(`${what}: ${seen.length} ticks, fewer than the ${least} its program had written`);
  return out;
}
async function ownTest(h: Awaited<ReturnType<typeof openHost>>, kind: string, checkout: string): Promise<string[]> {
  const r = await h.runCheck(kind, { kind, runner: 'package', inputs: [], depth: 'unit', oracle: 'code', contract: null }, { checkout, deadline: 30_000 });
  return r.outcome === 'passed' && r.testsRun > 0 ? [] : [`its own test ${kind} reads ${r.outcome} (${r.testsRun} run): ${r.failures.map((f) => f.message).join('; ')}`];
}

/**
 * Installs the plug-in (built by an agent), approves run-as-you once on the trusted path, loads it, runs its first
 * own test (a heartbeat terminal), opens a terminal of the suite's own (a counter), quits the app, watches both
 * terminals' programs while it's gone, launches again on the same files with no new approval, and reads what the
 * piece's tabs show. Returns every problem it sees; throws when a step it needs can't run (an install, the first
 * own test, the approved piece's first command, or its load at the next launch).
 */
async function quitScenario(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const work = tempDir('ac1');
  const notes = tempDir('counter');
  const w1 = await openWorld();
  const h1 = await openHost(w1, plant);
  const p = await installAndLoad(h1, await pkg('agent-terminals'), { approve: true });
  const hosts = await ownTest(h1, 'ext.agent-terminals.hosts', work);
  if (hosts.length) throw Error(`before the quit: ${hosts.join('; ')}`);
  const { opened, refused } = await openTerminal(h1, p, OPEN, program(notes, 'counter'), notes, 'counter');
  if (!opened) throw Error(`the approved plug-in's first command was refused: ${refused}`);
  const counterPid = (await pidsIn(notes, ['pid'])).pid!;
  if (counterPid !== opened.pid) problems.push(`the hub says the counter's program is pid ${opened.pid}, but the program is pid ${counterPid}`);
  const counter = proc(counterPid);
  const before = await tabsOf(h1, p);
  const heartbeat = before.find((t) => t.title === 'heartbeat');
  if (!heartbeat || !before.some((t) => t.terminal === opened.terminal)) throw Error(`before the quit its tabs show ${JSON.stringify(before)}, not the heartbeat and the counter`);
  const tracked = await waitFor(() => trackedPids(w1, [opened.run, heartbeat.run]), (v) => v.includes(counterPid) && v.includes(heartbeat.pid), 5000);
  for (const [name, pid] of [['counter', counterPid], ['heartbeat', heartbeat.pid]] as const) {
    if (!tracked.includes(pid)) problems.push(`the supervisor recorded no process.tracked for the ${name}'s program (pid ${pid}) under its run`);
  }
  const beat: Proc = proc(heartbeat.pid);
  await waitFor(() => numberIn(join(notes, 'progress')), (n) => n >= 10, 5000);

  // The app quits.
  await quit(h1, w1);
  const atQuit = numberIn(join(notes, 'progress'));
  await sleep(2000);
  if (!running(counter)) problems.push(`the counter terminal's program (pid ${counterPid}) stopped when the app quit`);
  if (!running(beat)) problems.push(`the heartbeat terminal's program (pid ${heartbeat.pid}) stopped when the app quit`);
  const gone = numberIn(join(notes, 'progress'));
  if (gone < atQuit + 20) problems.push(`the counter terminal stopped counting while the app was quit: ${atQuit} at the quit, ${gone} 2 s later`);

  // The next launch: the same files, no new approval.
  const { h: h2 } = await relaunch(w1, plant);
  const atLaunch = numberIn(join(notes, 'progress'));
  const after = await tabsOf(h2, p);
  for (const [name, t] of [['heartbeat', heartbeat], ['counter', { terminal: opened.terminal, pid: opened.pid }]] as const) {
    const tab = after.find((x) => x.terminal === t.terminal);
    if (!tab) problems.push(`at the next launch its tabs don't show the ${name} terminal (${t.terminal}): ${JSON.stringify(after)}`);
    else if (tab.pid !== t.pid) problems.push(`at the next launch the ${name} tab shows pid ${tab.pid}, not the program that kept running (pid ${t.pid})`);
  }
  if (after.length !== 2) problems.push(`at the next launch its tabs show ${after.length} terminals, not the 2 it had`);
  problems.push(...(await ownTest(h2, 'ext.agent-terminals.shows_again', work)));
  await waitFor(() => numberIn(join(notes, 'progress')), (n) => n >= atLaunch + 20, 5000);
  const written = numberIn(join(notes, 'progress'));
  problems.push(...tickProblems(ticks(await outputOf(h2, p, opened.terminal).catch((e) => `unreadable: ${message(e)}`)), written - 2, 'the counter tab at the next launch'));
  if (!running(counter)) problems.push(`the counter terminal's program (pid ${counterPid}) doesn't run after the next launch`);
  await h2.revoke(YOU, ID, RUN_AS_YOU).catch(() => undefined);
  return problems;
}

/** Each copy's manifest leaves out run_as_you; its first command must be refused naming it, and nothing may run. */
async function copyProblems(plant?: Plant): Promise<string[]> {
  const problems: string[] = [];
  const copies: { tag: string; words: string[]; grant?: { record: string[] } }[] = [
    { tag: 'without any access word', words: [] },
    { tag: 'with only the narrower words files, programs and record, and a record grant', words: ['files', 'programs', 'record'], grant: { record: ['session.start'] } },
  ];
  for (const copy of copies) {
    const w = await openWorld();
    const h = await openHost(w, plant);
    const notes = tempDir('copy');
    const dir = await pkg('agent-terminals', { manifest: { access: { words: copy.words } } });
    const p = await installAndLoad(h, dir, { approve: false, ...(copy.grant ? { grant: copy.grant } : {}) });
    // Your yes on the trusted path to a word its manifest never asked for grants nothing; the host may refuse it.
    await h.approve(YOU, p.id, RUN_AS_YOU).catch(() => undefined);
    const { opened, refused } = await openTerminal(h, p, OPEN, program(notes, 'counter'), notes, 'counter');
    await sleep(1000);
    if (opened || numberIn(join(notes, 'pid'))) problems.push(`the copy ${copy.tag} ran its first command (${JSON.stringify(opened ?? null)}, program pid ${numberIn(join(notes, 'pid')) || 'none'}): a narrower grant implied run-as-you`);
    else if (!String(refused).includes(RUN_AS_YOU)) problems.push(`the copy ${copy.tag} was refused without naming run_as_you: ${refused}`);
    if (!opened && !(await refusalsNaming(w, ID)).length) problems.push(`the copy ${copy.tag}: no capability.refused for deep.terminal.open naming run_as_you, written as ext:${ID}`);
  }
  return problems;
}

describe('AC1 the agent-terminals plug-in, built from one sentence, installs with run-as-you and keeps its terminals past the app', () => {
  it('AC1 it installs with run-as-you, passes conformance and its own tests; its terminals keep running after the app quits, and its tabs show them again at the next launch', async () => {
    expect(await quitScenario()).toEqual([]);
  }, 180_000);

  it('AC1 (wrong program) close-stops-every-host: a host that stops a piece\'s terminals when the app quits fails, naming the terminal that stopped', async () => {
    const problems = await quitScenario('close-stops-every-host');
    expect(problems.join('\n'), 'the planted host must fail the same check').toMatch(/counter terminal's program \(pid \d+\) stopped when the app quit/);
  }, 180_000);

  it('AC1 its copy whose manifest leaves out run-as-you (no words, or only narrower ones) installs and loads, and is refused at its first command naming run_as_you; nothing runs', async () => {
    const { EXTENSION_API } = await host();
    for (const method of ['deep.terminal.open', 'deep.terminal.list', 'deep.terminal.read']) {
      expect(EXTENSION_API.find((m) => m.method === method)?.needs, `the extension API schema lists ${method}, needing run_as_you`).toBe(RUN_AS_YOU);
    }
    expect(await copyProblems()).toEqual([]);
  }, 120_000);

  it('AC1 (wrong program) narrower-grant-implies-run-as-you: a host that lets files or programs stand in for run-as-you fails, naming the copy whose command ran', async () => {
    const problems = await copyProblems('narrower-grant-implies-run-as-you');
    expect(problems.join('\n'), 'the planted host must fail the same check').toMatch(/the copy with only the narrower words .* ran its first command/);
  }, 120_000);
});


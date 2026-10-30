// AC2: revoking run-as-you stops every process the piece started. The piece (the agent-terminals plug-in, approved on
// the trusted path) opens two terminals: one runs a process tree (the program, a child in its group, a grandchild that
// calls setsid, an orphan reparented to launchd, and a child that ignores SIGTERM, SIGHUP and SIGINT), the other a
// shell that ignores SIGHUP and SIGTERM with a background sleep. Every one of them notes its PID. The suite also starts
// the same tree itself, outside the piece: a decoy no revoke may touch. Your revoke on the trusted path resolves, and
// then every process the piece started is gone, the decoy all runs, and the piece's next command is refused naming
// run_as_you. The second test opens the terminals, quits the app and launches again before the revoke.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Plant } from '../../../packages/extension-host/src/index.ts';
import {
  RUN_AS_YOU, YOU, installAndLoad, numberIn, openHost, openTerminal, openWorld, pidsIn, pkg, proc, program, quit, relaunch, running, startDecoy,
  tempDir, type Proc,
} from './helpers.ts';

const ID = 'test/agent-terminals';
const OPEN = 'ext.agent-terminals.open';
const ROLES = ['program.pid', 'child.pid', 'setsid.pid', 'orphan.pid', 'stubborn.pid'];

async function revokeProblems(options: { plant?: Plant; relaunch?: boolean } = {}): Promise<string[]> {
  const problems: string[] = [];
  let w = await openWorld();
  let h = await openHost(w, options.plant);
  const p = await installAndLoad(h, await pkg('agent-terminals'), { approve: true });
  const treeDir = tempDir('tree');
  const shDir = tempDir('shell');
  const tree = await openTerminal(h, p, OPEN, program(treeDir, 'tree'), treeDir, 'tree');
  const shell = await openTerminal(h, p, OPEN, ['/bin/sh', '-c', `trap '' HUP TERM; echo $$ > '${shDir}/sh.pid'; sleep 600 & echo $! > '${shDir}/sleep.pid'; wait`], shDir, 'shell');
  if (!tree.opened || !shell.opened) throw Error(`the approved piece's commands were refused: ${tree.refused ?? ''} ${shell.refused ?? ''}`);
  const started: Record<string, Proc> = {};
  for (const [role, pid] of Object.entries(await pidsIn(treeDir, ROLES))) started[`the tree's ${role.replace('.pid', '')}`] = proc(pid);
  for (const [role, pid] of Object.entries(await pidsIn(shDir, ['sh.pid', 'sleep.pid']))) started[`the shell terminal's ${role.replace('.pid', '')}`] = proc(pid);
  const decoyDir = tempDir('decoy');
  const decoyArgv = program(decoyDir, 'tree');
  proc(startDecoy(decoyArgv));
  const decoy: Record<string, Proc> = {};
  for (const [role, pid] of Object.entries(await pidsIn(decoyDir, ROLES))) decoy[role.replace('.pid', '')] = proc(pid);
  for (const [what, p0] of Object.entries(started)) if (!running(p0)) throw Error(`${what} (pid ${p0.pid}) ended before the revoke`);

  if (options.relaunch) {
    await quit(h, w);
    ({ w, h } = await relaunch(w, options.plant));
    for (const [what, p0] of Object.entries(started)) if (!running(p0)) problems.push(`${what} (pid ${p0.pid}) stopped when the app quit, before any revoke`);
  }

  await h.revoke(YOU, ID, RUN_AS_YOU);
  for (const [what, p0] of Object.entries(started)) if (running(p0)) problems.push(`${what} (pid ${p0.pid}) still runs after the revoke`);
  for (const [role, p0] of Object.entries(decoy)) if (!running(p0)) problems.push(`the decoy's ${role} (pid ${p0.pid}), which the piece never started, was stopped by the revoke`);
  const later = tempDir('later');
  const again = await openTerminal(h, p, OPEN, program(later, 'counter'), later, 'after the revoke');
  if (again.opened || numberIn(join(later, 'pid'))) problems.push(`after the revoke the piece's next command still ran (${JSON.stringify(again.opened ?? null)})`);
  else if (!String(again.refused).includes(RUN_AS_YOU)) problems.push(`after the revoke the piece's next command was refused without naming run_as_you: ${again.refused}`);
  return problems;
}

describe('AC2 revoking run-as-you stops every process the piece started', () => {
  it('AC2 revoking stops both terminals\' programs and everything they started (a child, a setsid grandchild, an orphan, one that ignores SIGTERM, a shell\'s background job), leaves a decoy it never started running, and refuses its next command naming run_as_you', async () => {
    expect(await revokeProblems()).toEqual([]);
  }, 120_000);

  it('AC2 the same after the app quit and launched again: the terminals opened before the quit are still the piece\'s, and the revoke stops every process in them', async () => {
    expect(await revokeProblems({ relaunch: true })).toEqual([]);
  }, 180_000);

  it('AC2 (wrong program) revoke-keeps-running: a revoke that only refuses later commands fails, naming each process left running', async () => {
    const problems = await revokeProblems({ plant: 'revoke-keeps-running' });
    expect(problems.join('\n'), 'the planted host must fail the same check').toMatch(/the tree's program \(pid \d+\) still runs after the revoke/);
  }, 120_000);

  it('AC2 (wrong program) revoke-stops-programs-only: a revoke that stops each terminal\'s program but nothing it started fails, naming the setsid grandchild and the orphan', async () => {
    const problems = (await revokeProblems({ plant: 'revoke-stops-programs-only' })).join('\n');
    expect(problems, 'the planted host must fail the same check').toMatch(/the tree's setsid \(pid \d+\) still runs after the revoke/);
    expect(problems).toMatch(/the tree's orphan \(pid \d+\) still runs after the revoke/);
    expect(problems, 'the programs themselves did stop').not.toMatch(/the tree's program \(pid \d+\) still runs/);
  }, 120_000);
});

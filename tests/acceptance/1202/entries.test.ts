// AC1 #1202.3792a9e0: each Claude Code hook entry `deep setup` writes, the waiter included, runs deep-hook as a child of
// the process that runs the command, under dash and under `/bin/sh`.
//
// `deep setup` runs in a throwaway HOME with a hub answering and the service manager stubbed (README: Setup). The
// Claude Code stand-in (fixtures/claude.mjs) then runs every entry setup wrote as Claude Code does, `<shell> -c
// <command>` with the hook's JSON on stdin, once with dash named explicitly and once with `/bin/sh`.
//
// The first test reads who deep-hook's parent is (README: Reading deep-hook's parent). A hook entry's deep-hook is
// short-lived, so it is read from the request deep-hook itself sends, whose `pid` and `ppid` the hook protocol carries:
// the hub is stopped after setup, so each request lands in deep-hook's spool byte for byte. deep-hook is a child of the
// stand-in exactly when its `pid` is the `<shell> -c` process the stand-in started (the shell ran it in its own place)
// and its `ppid` is the stand-in. The waiter waits, so it is read off the process table while it runs.
//
// The second test is the issue's consequence, fast: a session's hooks run from one stand-in through `dash -c`, against a
// running hub, and every hook event after SessionStart must be recorded `verified: true`, as session.start is.

import { existsSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC1, allEvents, Claude, cleanup, dash, eventually, firedShown, HOOK_KINDS, isDeepHook, makeHome, newSession, payload, requireProc, setUp, sleep,
  spooled, startHub, stopHub, subtree, typedPrompt, type Ev, type Fired, type Home, type Line, type Proc,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** What the spool says about one synchronous entry's run: nothing when deep-hook ran as the stand-in's own child. */
function syncProblem(where: string, f: Fired, run: Fired['ran'][number], requests: Line[]): string | undefined {
  const mine = requests.find((r) => r.pid === run.shellPid);
  if (mine) return mine.ppid === f.standin ? undefined : `${where}: deep-hook ran as PID ${mine.pid}, the shell's own place, but sent ppid ${mine.ppid}, not the stand-in's ${f.standin}`;
  if (!requests.length) return `${where}: no request from deep-hook reached its spool (exit ${run.code}, stderr ${JSON.stringify(run.stderr.slice(0, 300))}), so nothing shows it ran`;
  const said = requests.map((r) => `pid ${r.pid}, ppid ${r.ppid}${r.ppid === run.shellPid ? ' (the shell that ran the command)' : ''}`).join('; ');
  return `${where}: deep-hook ran as a child of the shell the stand-in started (PID ${run.shellPid}), not of the process that runs the command (the stand-in, PID ${f.standin}): its request says ${said}`;
}

/** The waiter's deep-hook, read off the process table while it waits: nothing when it is the stand-in's own child. */
async function backgroundProblem(where: string, f: Fired, run: Fired['background'][number]): Promise<string | undefined> {
  let found: Proc | undefined;
  let seen: Proc[] = [];
  const deadline = Date.now() + 10_000;
  while (!found && Date.now() < deadline) {
    seen = subtree(run.shellPid);
    found = seen.find(isDeepHook);
    if (!found) await sleep(25);
  }
  if (!found) return `${where}: no deep-hook process ran under the shell the stand-in started (PID ${run.shellPid}) within 10 s; the processes there: ${JSON.stringify(seen)}`;
  if (found.ppid === f.standin) return undefined;
  const parent = seen.find((p) => p.pid === found!.ppid);
  return `${where}: deep-hook (PID ${found.pid}) is a child of PID ${found.ppid}${parent ? ` (${parent.exe})` : ''}, the shell that ran the command, not of the process that runs the command (the stand-in, PID ${f.standin})`;
}

/** Every entry setup wrote, run from one stand-in with `<shell> -c`; the problems, one per entry whose deep-hook isn't the stand-in's child. */
async function runAll(h: Home, shell: string, events: string[]): Promise<string[]> {
  const claude = Claude.start(h);
  const s = newSession(h);
  typedPrompt(s, 'List the files here.');
  const problems: string[] = [];
  try {
    for (const event of events) {
      const before = spooled(h).length;
      const f = await claude.hook(shell, event, payload(s, event));
      if (f.settingsError) throw Error(`BLOCKED: the stand-in couldn't read the settings: ${f.settingsError}`);
      if (!f.ran.length && !f.background.length) throw Error(`BLOCKED: the stand-in ran no entry for ${event}, though setup wrote one`);
      const requests = spooled(h).slice(before).filter((r) => r.event === event);
      for (const run of f.ran) {
        const problem = syncProblem(`${shell} -c ${event} entry ${JSON.stringify(run.command)}`, f, run, requests);
        if (problem) problems.push(problem);
      }
      for (const run of f.background) {
        const problem = await backgroundProblem(`${shell} -c ${event} background entry (the waiter) ${JSON.stringify(run.command)}`, f, run);
        if (problem) problems.push(problem);
      }
    }
  } finally {
    await claude.exit();
  }
  return problems;
}

describe(`${AC1} Each Claude Code hook entry deep setup writes, the waiter included, runs deep-hook as a child of the process that runs the command, under dash and under /bin/sh`, () => {
  it(`${AC1} every entry deep setup writes into Claude Code's user settings, the waiter under Stop and StopFailure included, run as Claude Code runs it with dash -c and with /bin/sh -c from one stand-in process, runs deep-hook as that process's own child`, async () => {
    requireProc();
    const shells = [dash(), '/bin/sh'];
    const h = await makeHome();
    const hub = await startHub(h);
    const entries = await setUp(h);
    // The hub stopped, so every hook's request is kept in deep-hook's spool, pid and ppid included.
    await stopHub(hub);
    expect(entries.filter((e) => e.background).map((e) => e.event), `${AC1} setup writes the waiter, a background entry, which this criterion includes: ${JSON.stringify(entries.map((e) => ({ event: e.event, ...e.hook })))}`).not.toEqual([]);
    const events = [...new Set(entries.map((e) => e.event))];

    // The control: bash, which execs a lone command, shows the reading sees a deep-hook that is the stand-in's child.
    if (existsSync('/bin/bash')) {
      const control = await runAll(h, '/bin/bash', ['SessionStart']);
      if (control.length) throw Error(`BLOCKED: under bash, which runs a lone command in its own place, the reading still finds deep-hook isn't the stand-in's child, so the harness can't tell: ${control.join('\n')}`);
    }

    const problems: string[] = [];
    for (const shell of shells) problems.push(...await runAll(h, shell, events));
    expect(problems, `${AC1} each entry's deep-hook must be a child of the process that runs the command (Claude Code, here the stand-in), under ${shells.join(' and ')}; these weren't`).toEqual([]);
  }, 600_000);

  it(`${AC1} (the record) a session's hooks run through dash -c from one stand-in process are each recorded verified: true, every event after SessionStart as well as session.start`, async () => {
    const sh = dash();
    const h = await makeHome();
    const hub = await startHub(h);
    await setUp(h);
    const claude = Claude.start(h);
    const s = newSession(h);
    const fired: [string, Fired][] = [];
    try {
      const fire = async (event: string) => { fired.push([event, await claude.hook(sh, event, payload(s, event))]); };
      await fire('SessionStart');
      typedPrompt(s, 'List the files here.');
      await fire('UserPromptSubmit');
      const id = `toolu_${s.id.replace(/-/g, '').slice(0, 24)}`;
      fired.push(['PreToolUse', await claude.hook(sh, 'PreToolUse', payload(s, 'PreToolUse', { tool_use_id: id }))]);
      fired.push(['PostToolUse', await claude.hook(sh, 'PostToolUse', payload(s, 'PostToolUse', { tool_use_id: id }))]);
      await fire('Stop');
      await fire('SessionEnd');
    } finally {
      await claude.exit();
    }
    const failed = fired.filter(([, f]) => f.ran.some((r) => r.code !== 0));
    expect(failed.map(([e, f]) => `${e}: ${firedShown(f)}`), 'every DeepBuild entry the stand-in ran exited 0').toEqual([]);

    const kinds = ['session.start', 'user.ask', 'tool.before', 'tool.after', 'agent.stop', 'session.end'];
    let mine: Ev[] = [];
    await eventually(async () => {
      mine = (await allEvents(hub)).filter((e) => HOOK_KINDS.has(e.kind) && (e.session === s.id || JSON.stringify(e.data ?? {}).includes(s.id)));
      return kinds.every((k) => mine.some((e) => e.kind === k));
    }, 30_000);
    const missing = kinds.filter((k) => !mine.some((e) => e.kind === k));
    expect(missing, `every hook of the session reached the record (a hook that missed the hub's 50 ms acknowledgement waits in the spool; rerun on a quieter machine); recorded: ${JSON.stringify(mine.map((e) => e.kind))}`).toEqual([]);
    expect(mine.find((e) => e.kind === 'session.start')?.verified, `session.start is verified against the stand-in it came from: ${JSON.stringify(mine.map((e) => ({ kind: e.kind, verified: e.verified })))}`).toBe(true);
    const unverified = mine.filter((e) => e.verified !== true).map((e) => `${e.kind}: verified ${String(e.verified)}`);
    expect(unverified, `${AC1} run through dash -c from one Claude Code process, every hook event after SessionStart is checked against that process as session.start was; these weren't`).toEqual([]);
  }, 600_000);
});

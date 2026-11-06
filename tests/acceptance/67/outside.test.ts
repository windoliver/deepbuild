// #67 AC8: an ask typed in a session outside any repo, such as "free 200 GB", opens a task in a workspace with a check,
// and a stop short of it is sent back. The session sits in a plain folder. The definition is the drafting job's,
// handed to the kernel, with the check and the touch it wrote for the new workspace (README). This Mac's free space is
// read through the shipped host source from a change log the test writes: 150 GB, then 240 GB once the agent freed it.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC8, ASSERTS, changed, CHECK, claimHandle, claimsOf, cleanup, decision, draft, git, handDrafts, hostLog, listed, locked, makeWorld, must, nodeCheck, replyText, req, Session, settle, startHub, taskOf, verdictsOf, type Ev,
} from './hub.ts';

afterAll(cleanup, 60_000);
const QUESTION = 'what is using my disk?';
const ASK = 'free 200 GB';
const made = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'workspace.created');

describe(`${AC8} an ask typed outside any repo opens a task in a workspace with a check, and a stop short of it is sent back`, () => {
  it(`${AC8} "free 200 GB" opens a task in a new workspace with no question, a stop at 150 GB is sent back naming its check, and a stop at 240 GB passes`, async () => {
    const w = makeWorld();
    const disk = hostLog(w, 'this-mac', { free_gb: 150 });
    handDrafts(w, [draft(ASK, [req('R1', '200 GB is free on this Mac', { check: CHECK('free-space'), asserts: [ASSERTS('free-space')], on_base: 'fails', reads: ['this-mac'] })], {
      files: nodeCheck('free-space', `state('this-mac').free_gb >= 200`), touches: [{ id: 'this-mac', source: 'host', log: disk }],
    })]);
    const hub = await startHub(w);
    const s = new Session(w, w.outside);
    await s.start();

    // A question outside any repo makes nothing.
    await s.typed(QUESTION);
    await s.stop('Caches, mostly.');
    let events = await settle(hub, (all) => all.some((e) => e.kind === 'agent.stop'));
    expect(taskOf(events, s, QUESTION), 'a question opens no task').toBeUndefined();
    expect(made(events), 'and no workspace').toEqual([]);

    await s.typed(ASK);
    events = await settle(hub, (all) => locked(all, taskOf(all, s, ASK)) !== undefined);
    const ref = taskOf(events, s, ASK);
    must(ref !== undefined, `the ask must open a task: ${listed(events.filter((e) => e.kind === 'user.ask'))}`);
    const opened = made(events);
    expect(opened.map((e) => e.data.task_ref), `one workspace for the task: ${listed(events.slice(-8))}`).toEqual([ref]);
    const folder = String(opened[0]!.data.folder);
    must(dirname(folder) === join(w.root, 'workspaces'), `it's kept under ~/.deepbuild/workspaces/: ${folder}`);
    expect(git(w, folder, ['rev-parse', '--show-toplevel']), 'as a git repo of its own').toBe(folder);
    expect(existsSync(join(folder, CHECK('free-space'))), 'holding the drafted check').toBe(true);
    const lock = locked(events, ref)!;
    expect(lock.project, 'the record\'s project id is the workspace\'s').toBe(opened[0]!.data.workspace);
    expect(lock.data.base_commit, 'the definition is fixed on the workspace\'s commit, the check in it').toBe(git(w, folder, ['rev-parse', 'HEAD']));
    expect(lock.data.requirements[0]?.check, 'with a check').toBe(CHECK('free-space'));
    expect(events.filter((e) => e.kind === 'ask.created'), 'a topic makes one with no question').toEqual([]);

    // The agent cleans up, gets to 150 GB and stops.
    await s.write(join(folder, 'notes/freed.md'), 'Cleared the caches: 150 GB free.\n');
    const short = await s.stop('I freed what I could.');
    events = await settle(hub, (all) => claimsOf(all, ref).length > 0 && verdictsOf(all, claimHandle(claimsOf(all, ref)[0]!)).length > 0, 60_000);
    const first = claimsOf(events, ref)[0];
    must(first !== undefined, `the stop must make a claim on the task: ${listed(events.slice(-8))}`);
    expect(verdictsOf(events, claimHandle(first)).at(-1)?.data.outcome, 'the check fails at 150 GB').toBe('FAIL');
    // On a rare race a send-back rides with the next stop instead of this one; it is sent back either way.
    const back = decision(short) === 'deny' ? short : await s.stop('I freed what I could.');
    expect(decision(back), `the stop short of it is sent back: ${replyText(back)}`).toBe('deny');
    must(/\bR1\b/.test(replyText(back)) && replyText(back).includes(CHECK('free-space')), `the send-back names the requirement and its check: ${replyText(back)}`);

    // It finds the rest.
    changed(disk, 'free_gb', 240);
    await s.write(join(folder, 'notes/freed.md'), 'Moved the old archives off: 240 GB free.\n');
    const done = await s.stop('240 GB free.');
    events = await settle(hub, (all) => claimsOf(all, ref).some((c) => verdictsOf(all, claimHandle(c)).some((v) => v.data.outcome === 'PASS')), 60_000);
    const passed = claimsOf(events, ref).flatMap((c) => verdictsOf(events, claimHandle(c))).find((v) => v.data.outcome === 'PASS');
    expect(passed, `the ask is met at 240 GB: ${listed(events.filter((e) => e.kind === 'verdict.made'))}`).toBeDefined();
    expect(decision(done), `and the stop goes through: ${replyText(done)}`).toBe('allow');
    expect(passed!.data.key.commit, 'its verdict pins to the workspace\'s commit').toBe(git(w, folder, ['rev-parse', 'HEAD']));
  }, 240_000);
});

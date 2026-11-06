// #67 AC1: a non-code task runs the same loop as code in a workspace: what done means, checks, asks and a receipt. And
// the issue's Proof: a weekly report run end to end in a workspace, with its history, a state-source diff and an undone
// change. One scenario on the real hub, read by each test: `deep workspace new`, a session in the folder, a definition
// locked, a stop short of it sent back, an ask you answer, a stop that passes, and `changes.read` for the receipt.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AC1, answer, ASSERTS, changed, CHECK, claimHandle, claimsOf, cleanup, control, decision, draft, fill, git, hostLog, listed, locked, makeWorld, must, newWorkspace, nodeCheck, replyText, req, Session,
  settle, shown, startHub, taskOf, verdictsOf, workspace, type Ev, type Hub, type Line, type Ran, type Session as Live, type Workspace, type World,
} from './hub.ts';

const ASK = 'write the weekly report';
const REPORT = 'reports/weekly.md';
const FIRST_LINE = '# This week\n';

let w: World, hub: Hub, ws: Workspace, s: Live, sales: string;
let ref: string | undefined, before: Ev[], short: Ran, reportCommit: string, base: string;
let held: { allowed: boolean }, again: { allowed: boolean }, asked: Ev | undefined, answered: Ran, done: Ran;
let events: Ev[];

beforeAll(async () => {
  w = makeWorld({ drafts: [draft(ASK, [req('R1', 'The report states the total the sales ledger holds', { check: CHECK('total'), asserts: [ASSERTS('total')], on_base: 'fails', reads: ['sales'] })])] });
  hub = await startHub(w);
  sales = hostLog(w, 'sales', { total: 1240 });
  ws = await newWorkspace(w, 'Weekly report');
  base = fill(w, ws, nodeCheck('total', `fs.existsSync('${REPORT}') && fs.readFileSync('${REPORT}', 'utf8').includes('Total: ' + state('sales').total)`), [{ id: 'sales', source: 'host', log: sales }, { id: 'files', source: 'git' }]);
  s = new Session(w, ws.folder);
  await s.start();
  await s.typed(ASK);
  before = await settle(hub, (all) => locked(all, taskOf(all, s, ASK)) !== undefined);
  ref = taskOf(before, s, ASK);

  // The agent's first go states the wrong total, and its stop is short of the definition.
  await s.write(join(ws.folder, REPORT), `${FIRST_LINE}Total: 1250\n`);
  short = await s.stop('The report is written.');
  await settle(hub, (all) => claimsOf(all, ref).length === 1 && verdictsOf(all, claimHandle(claimsOf(all, ref)[0]!)).length > 0, 60_000);

  // It wants a dependency for the script that makes the report: that waits on you, as it would in a repo.
  held = await s.bash('npm install csv-parse');
  const withAsk = await settle(hub, (all) => all.some((e) => e.kind === 'ask.created'));
  asked = withAsk.find((e) => e.kind === 'ask.created');
  answered = asked ? await answer(w, asked, 'approve') : { code: null, signal: null, stdout: '', stderr: 'no ask', ms: 0, timedOut: false, ended: 0 };
  again = await s.bash('npm install csv-parse');

  // It states the ledger's total and keeps the report in the workspace's history.
  await s.write(join(ws.folder, REPORT), `${FIRST_LINE}Total: 1240\n`);
  await s.bash(`git add -A && git commit -m "The weekly report"`, () => {
    git(w, ws.folder, ['add', '-A']);
    git(w, ws.folder, ['commit', '-q', '-m', 'The weekly report']);
    reportCommit = git(w, ws.folder, ['rev-parse', 'HEAD']);
  });
  done = await s.stop('The total now matches the ledger.');
  events = await settle(hub, (all) => claimsOf(all, ref).length >= 2 && verdictsOf(all, claimHandle(claimsOf(all, ref).at(-1)!)).some((v) => v.data.outcome !== undefined), 60_000);
}, 300_000);
afterAll(cleanup, 60_000);

describe(`${AC1} a non-code task runs the same loop as code in a workspace`, () => {
  it(`${AC1} what done means: the task opens in the workspace's project and its definition locks with its check`, () => {
    must(ws.folder.startsWith(join(w.root, 'workspaces')), `a workspace kept by DeepBuild is under ~/.deepbuild/workspaces/: ${ws.folder}`);
    must(ref !== undefined, `the prompt must open a task: ${listed(before.filter((e) => e.kind === 'user.ask'))}`);
    const lock = locked(before, ref)!;
    expect(lock, `the handed definition must lock: ${listed(before.slice(-8))}`).toBeDefined();
    expect(lock.project, 'the record\'s project id on the lock is the workspace\'s id').toBe(ws.id);
    expect(before.find((e) => e.kind === 'task.created' && e.data.task_ref === ref)?.project, 'the task is in the workspace\'s project').toBe(ws.id);
    expect(lock.data.base_commit, 'the definition is fixed on the workspace\'s commit').toBe(base);
    expect((lock.data.requirements as Line[])[0]?.check).toBe(CHECK('total'));
  });

  it(`${AC1} checks: the stop short of the definition is sent back naming R1 and its check, and the stop that meets it passes`, () => {
    expect(decision(short), `the wrong total is sent back: ${replyText(short)}`).toBe('deny');
    const reply = replyText(short);
    must(/\bR1\b/.test(reply) && reply.includes(CHECK('total')), `the send-back names the requirement and its check: ${reply}`);
    const [first, last] = [claimsOf(events, ref)[0]!, claimsOf(events, ref).at(-1)!];
    expect(verdictsOf(events, claimHandle(first)).at(-1)?.data.outcome, 'the first claim\'s verdict').toBe('FAIL');
    const verdict = verdictsOf(events, claimHandle(last)).at(-1);
    expect(verdict?.data.outcome, `the last claim's verdict: ${listed(verdictsOf(events, claimHandle(last)))}`).toBe('PASS');
    expect(decision(done), `the stop that meets the definition goes through: ${replyText(done)}`).toBe('allow');
    expect(verdict!.data.key.commit, 'the verdict pins to the workspace\'s commit').toBe(reportCommit);
    expect(verdict!.data.key.state_digests, 'and to the digest of the one touch its check reads').toHaveLength(1);
  });

  it(`${AC1} asks: a call that needs you waits in the workspace's project on your answer, and runs once you say yes`, () => {
    must(asked !== undefined, 'a call of a class your rules decide raises an ask in a workspace too: no ask.created');
    expect(asked.project, 'the ask is in the workspace\'s project').toBe(ws.id);
    expect(held.allowed, 'the call waits for your answer').toBe(false);
    expect(answered.code, shown(answered)).toBe(0);
    expect(again.allowed, 'once you said yes, the same call runs').toBe(true);
  });

  it(`${AC1} a receipt: changes.read for the claim shows the PASS, the check it ran and the file the task wrote`, async () => {
    const { change } = await control(hub, 'changes.read', { id: claimHandle(claimsOf(events, ref).at(-1)!) });
    must(change !== undefined, 'changes.read answers with the change');
    expect(String(change.line), 'the receipt\'s line').toContain('PASS');
    expect((change.checks as Line[]).map((c) => c.check), 'the checks it ran').toContain(CHECK('total'));
    must((change.produced.files as string[]).some((f) => f.endsWith(REPORT)), `what the task produced names the report: ${JSON.stringify(change.produced.files)}`);
  });
});

describe(`${AC1} the Proof: a weekly report run end to end in a workspace, with its history, a state-source diff and an undone change`, () => {
  it('the workspace holds its history, the ledger\'s change shows as a state-source diff, and reverting the report\'s commit undoes it', async () => {
    const log = git(w, ws.folder, ['log', '--format=%H']).split('\n');
    expect(log.slice(0, 2), 'the report\'s commit follows the set-up').toEqual([reportCommit, base]);

    changed(sales, 'total', 1300);
    const { diffs } = await workspace(w, 'diff', ws.id) as { diffs: { touch: string; item: string; was: unknown; now: unknown }[] };
    expect(diffs.filter((d) => d.touch === 'sales'), 'the state-source diff').toEqual([{ touch: 'sales', item: 'total', was: 1240, now: 1300 }]);

    expect(readFileSync(join(ws.folder, REPORT), 'utf8')).toContain('Total: 1240');
    const reverted = await workspace(w, 'revert', ws.id, reportCommit);
    expect(existsSync(join(ws.folder, REPORT)), 'the change is undone: the report\'s commit added the report').toBe(false);
    expect(git(w, ws.folder, ['rev-parse', 'HEAD']), 'the undo is itself a commit of the workspace').toBe(reverted.commit);
    expect(git(w, ws.folder, ['log', '--format=%H']).split('\n'), 'and the history keeps what it undid').toContain(reportCommit);
  }, 120_000);
});

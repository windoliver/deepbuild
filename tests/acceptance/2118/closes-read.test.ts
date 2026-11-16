// AC4: a Closes check that fails to run denies the pull request once, naming the cause (README).
//
// #322's world, on the real hub, deep-hook and record: a Claude Code session started from a work item, issue 7, by a
// prompt that also asks for the pull request ("Fix <link>, then create PR."), so opening one needs no further answer
// of yours and only the Closes rule stands between the call and its run. Its task is open with its handed definition
// locked. Then the record's read of that task's definition is made to reject:
// with the hub running, the `requirements` column of the record's `definitions` table is renamed in the hub's own
// ledger.db, as packages/hub/test/pr-after-lookup-error.test.ts breaks one read of the record, so the Closes rule's
// `SELECT requirements FROM definitions ...` fails inside SQLite. The test reads the same rows itself first, and what
// SQLite answers it is the cause. The agent then runs `gh pr create` with a body that says `Closes #7`. The call must
// be denied at PreToolUse, and what the agent reads must carry that cause. No forge is reached: a call let through
// would have no effect here. The column is put back before the hub stops.
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { allEvents, cleanup, decision, FLAG, Inconclusive, itemTask, lockedFor, makeWorld, replyText, Session, settle, shown, startHub, stopHub, verdict, type Hub, type World } from '../322/helpers.ts';
import { WORK_LINK, workDraft, workIssue } from '../322/work.ts';
import { loadReading, standInAgents, undecided } from './helpers.ts';

const AC4 = 'AC4 #2118.53305b98';
const ISSUE = 7;
const CLOSES = `gh pr create --title "Reject expired tokens" --body "Closes #${ISSUE}"`;
const HELD = 'requirements_held_2118';

afterEach(cleanup, 120_000);

/** The hub's own record, opened beside it for one statement; a busy record is waited for. */
function ledger(hub: Hub): DatabaseSync {
  const db = new DatabaseSync(join(hub.root, 'ledger.db'));
  db.exec('PRAGMA busy_timeout=60000');
  return db;
}
/** What SQLite answers a read of the task's definition, as the Closes rule reads it: its error's words, or null when it reads. */
function definitionRead(hub: Hub, task: string): string | null {
  const db = ledger(hub);
  try {
    db.prepare('SELECT requirements FROM definitions WHERE task_ref = ?').all(task);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    db.close();
  }
}
function rename(hub: Hub, from: string, to: string): void {
  const db = ledger(hub);
  try { db.exec(`ALTER TABLE definitions RENAME COLUMN ${from} TO ${to}`); } finally { db.close(); }
}

test(`${AC4} a session with an open task for issue ${ISSUE}, and a record whose read of the task's definition rejects: gh pr create with Closes #${ISSUE} is denied, naming the cause`, async (ctx) => verdict(ctx, async () => {
  const w = makeWorld({ drafts: [workDraft(ISSUE)], readings: [workIssue(ISSUE)] });
  const restorePath = standInAgents(w.tmp);
  try {
    const hub = await startHub(w);
    try { await scene(w, hub); } finally { await stopHub(hub); }
  } finally {
    restorePath();
  }
}), 600_000);

async function scene(w: World, hub: Hub): Promise<void> {
  const s = new Session(w);
  await s.start();
  await s.typed(`Fix ${WORK_LINK(ISSUE)}, then create PR.`);
  await s.read('src/auth.js');
  const events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 240_000);
  const task = itemTask(events, s);
  if (!task || !lockedFor(events, task).length) throw Error(`BLOCKED: ${AC4} the session started from ${WORK_LINK(ISSUE)} must open one task with its handed definition locked: ${task ?? 'no task'}`);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  if (definitionRead(hub, task) !== null) throw Error(`BLOCKED: ${AC4} the record must read ${task}'s definition before the test breaks that read: ${String(definitionRead(hub, task))}`);

  // Given: the record's read of the task's definition rejects.
  rename(hub, 'requirements', HELD);
  let call: Awaited<ReturnType<Session['call']>>;
  let cause: string | null;
  try {
    cause = definitionRead(hub, task);
    if (cause === null) throw Error(`BLOCKED: ${AC4} with the column renamed, a read of ${task}'s definition must reject: it still reads`);
    // When: the agent runs gh pr create with Closes #7.
    call = await s.call('Bash', { command: CLOSES, description: 'Open the pull request' });
  } finally {
    rename(hub, HELD, 'requirements');
  }

  const said = replyText(call.before);
  if (call.allowed && await undecided(() => allEvents(hub), call.id, call.before.stderr)) throw new Inconclusive(`${AC4} \`${CLOSES}\` was let through before the hub decided it (${shown(call.before)}); read at ${loadReading()}`);
  const seen = `the read of ${task}'s definition rejected with ${JSON.stringify(cause)}; deep-hook's reply to \`${CLOSES}\`: ${shown(call.before)}`;
  expect(decision(call.before), `${AC4} a Closes check that couldn't run denies the pull request: nothing shows the issue's requirements proven; ${seen}`).toBe('deny');
  expect(said, `${AC4} the denial names the cause, what the record's read rejected with; ${seen}`).toContain(cause);
}

// Helpers for #3534's acceptance tests. Written blind from issue #3534 (its opening paragraph, Scope, Fields and nine
// criteria, as the issue reads since #3553 took its 7-day targets), the design sections it links, AGENTS.md (Proof) and
// the base commit 5a81b58de, before any work on the issue existed. Nothing here imports the code under test:
// `node scripts/issue-time.mjs` runs in a scratch tree that holds a copy of this checkout's scripts/ and adapters/,
// with a HOME of the test's own, so the machine's transcripts, throttle log and load log are never read, and a
// stand-in `gh` first on PATH, so the forge is never reached. Every record is made up here: the transcripts' rows from
// the issue's Fields (and the row shapes this repository's own fixtures write), the throttle's log and load log from
// scripts/throttle.mjs's log() and sample(). What the issue leaves open is in the README.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CHECKOUT = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SEC = 1_000;
const MIN = 60 * SEC;
/** How long one run of the command is given: it reads a few small files, but the machine may be loaded. */
const RUN_MS = 120_000;
export const TEST = { timeout: 5 * RUN_MS };

/** The span that holds issues 7100, 7101 and 7102, read whole, and 7106, not read. No PR merges on its last day. */
export const SPAN = ['--since', '2025-03-10', '--until', '2025-03-14'];
/** The span that holds issue 7104 alone, whose session goes on past its merge. */
export const LATER = ['--since', '2025-03-16', '--until', '2025-03-19'];
/** The same days with no end named. */
export const OPEN_ENDED = ['--since', '2025-03-16'];

/** The app's conflict line (Scope): `Merge conflicts`, then `Resolve the merge conflicts before this can merge.` */
const CONFLICT_LINE = 'Merge conflicts\nResolve the merge conflicts before this can merge.';
const HOOK_TEXT = 'PreToolUse hook did not respond before its timeout of 600 s, so the call was not made.';
const REPO = 'windoliver/deepbuild';
const VERSION = '2.1.332';
const MODEL = 'claude-haiku-5-5';
const CAUSES = ['own', 'job', 'person', 'hook', 'unplaced'];
const KINDS = ['merge', 'prompt', 'conflict', 'plan', 'question', 'permission'];
export { CAUSES, KINDS };

const at = (day, hour, minute = 0) => Date.UTC(2025, 2, day, hour, minute);
const iso = (ms) => new Date(ms).toISOString();
/** A time as a message shows it: the day, hour and minute, UTC. */
export const clock = (ms) => iso(ms).slice(0, 16).replace('T', ' ');

// The forge's merged PRs, as the stand-in gh answers them, and one that is still open. `issue` is what the body names
// by its first Closes, Fixes, Resolves or Part of, reading from the body's start; a body that names none has null.
// Three bodies go on to name another issue with another of the four words, and one names one before, with no word.
// The issue that takes longest has the lowest number and merges first, so the three read are in order of their
// minutes neither by number nor by merge: a median taken from the middle of an unsorted list reads wrong.
const PRS = {
  A: { issue: 7101, pr: 7201, title: 'Count the lane notes by day', body: 'Closes #7101\n\nIt follows what Fixes #7190 began.', branch: 'issue-7101-lane-notes' },
  B: { issue: 7102, pr: 7202, title: 'Name the day a hook went quiet', body: 'After #7190, the count by day.\n\nFixes #7102, so that Closes #7191 can follow in a PR of its own.', branch: 'issue-7102-quiet-hook' },
  C: { issue: 7100, pr: 7200, title: 'Run the night table once', body: 'Resolves #7100', branch: 'issue-7100-night-table' },
  D: { issue: 7104, pr: 7204, title: 'Draw the chart\'s axes', body: 'Part of #7104: the axes are drawn, the bars are still open. Closes #7192 comes with the bars.', branch: 'issue-7104-chart-axes' },
  H: { issue: 7105, pr: 7205, title: 'Sort the notes', body: 'Closes #7105', branch: 'issue-7105-sorted-notes', merged: at(5, 12) },
  F: { issue: 7106, pr: 7206, title: 'Keep the table\'s header', body: 'Closes #7106', branch: 'issue-7106-table-header', merged: at(12, 9) },
  G: { issue: null, pr: 7207, title: 'Tidy the lane notes after the revert', body: 'No issue for this one: it tidies the notes that #7101 added.', branch: 'tidy-lane-notes', merged: at(11, 15) },
  R: { issue: null, pr: 7208, title: 'Revert "Count the lanes twice"', body: 'Reverts #7190, which counted each lane twice.', branch: 'revert-7190-count-twice', merged: at(13, 10) },
  O: { issue: 7109, pr: 7209, title: 'Draw the day chart', body: 'Closes #7109', branch: 'issue-7109-day-chart', open: true },
};
/** The fixture's numbers, for the tests' messages. */
export const NOT_READ = { issue: PRS.F.issue, pr: PRS.F.pr };
export const OUTSIDE = { before: PRS.H, after: PRS.D, noIssue: PRS.G, revert: PRS.R, open: PRS.O };
/** Issues a body names after its first of the four words, or with none of them: no PR's issue, for a message. */
export const NAMED_LATER = {
  7190: `PR #${PRS.A.pr}'s body names #7190 with a Fixes after its first of the four words, Closes #${PRS.A.issue}; PR #${PRS.B.pr}'s body has a bare #7190 before its Fixes #${PRS.B.issue}; and the revert's body says Reverts #7190, which is none of the four`,
  7191: `PR #${PRS.B.pr}'s body names #7191 with a Closes after its first of the four words, Fixes #${PRS.B.issue}`,
  7192: `PR #${PRS.D.pr}'s body names #7192 with a Closes after its first of the four words, Part of #${PRS.D.issue}`,
};

// The sessions' ids: a transcript is <id>.jsonl.
const ID = Object.fromEntries(['A', 'B1', 'B2', 'C', 'D', 'G', 'H', 'X', 'U'].map((name, k) => [name, `35340000-0000-4000-8000-0000000000${String(k + 11)}`]));

/**
 * One issue's sessions, planted row by row. Each step names the cause its time is expected under, so the expected
 * table is what the fixture says of itself, never a second reading of the rows: `think` is the agent's own time (or
 * `unplaced`), `call` runs a tool call from its `tool_use` row to its `tool_result` row, `wait` is the time after a
 * turn's end, and `merge` is the last row until the merge.
 */
class Planted {
  constructor(pr) {
    Object.assign(this, { pr, ms: Object.fromEntries([...CAUSES, ...KINDS, 'mergeOrPrompt'].map((name) => [name, 0])), asked: 0, first: null, merged: pr.merged ?? null, waits: [], files: [], n: 0 });
  }

  session(id, cwd, start) {
    const issue = this, rows = [];
    let t = start, parent = null, prompt = null, live = true;
    const serial = () => `${id.slice(-2)}${String(++issue.n).padStart(4, '0')}`;
    const row = (value, when = t, extra = {}) => {
      const uuid = `35340000-0000-4000-9000-${id.slice(-2)}${String(++issue.n).padStart(10, '0')}`;
      rows.push({ parentUuid: parent, isSidechain: false, ...value, uuid, timestamp: iso(when), userType: 'external', entrypoint: 'cli', cwd, sessionId: id, version: VERSION, gitBranch: issue.pr.branch, ...extra });
      if (!extra.isSidechain) parent = uuid;
      return uuid;
    };
    const assistant = (content, stop) => ({ type: 'assistant', message: { model: MODEL, id: `msg_3534${serial()}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 12 } } });
    const count = (cause, ms) => { if (live) issue.ms[cause] += ms; };
    issue.files.push({ id, cwd, rows });
    return {
      id,
      get t() { return t; },
      /** A person's prompt: a `user` row of text whose origin has the kind `human`. */
      prompt(text) {
        prompt = `35340000-0000-4000-a000-${id.slice(-2)}${String(++issue.n).padStart(10, '0')}`;
        row({ promptId: prompt, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
        if (live) { issue.first ??= t; issue.asked += 1; }
      },
      /** The agent's thinking: the time until its next row. Over 15 minutes it is `unplaced`. */
      think(ms, cause = 'own') { count(cause, ms); t += ms; },
      /** A tool call, `ms` from its `tool_use` row to its `tool_result` row; `shape` gives the result row its fields. */
      call(name, input, ms, cause, shape = {}) {
        const call = `toolu_3534${serial()}`;
        row(assistant([{ type: 'tool_use', id: call, name, input }], 'tool_use'));
        count(cause, ms);
        t += ms;
        const text = shape.hook ? HOOK_TEXT : shape.text ?? 'ok';
        row({
          promptId: prompt, type: 'user',
          message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: text, ...(shape.hook ? { is_error: true } : {}) }] },
          toolUseResult: shape.hook ? HOOK_TEXT : shape.result ?? { stdout: text, stderr: '', interrupted: false, isImage: false },
          ...(shape.permission ? { permissionDecision: shape.permission } : {}),
        });
        return call;
      },
      /** A turn's end: an `assistant` row whose `stop_reason` is `end_turn`. */
      end(text) { row(assistant([{ type: 'text', text }], 'end_turn')); },
      /** The time after a turn's end until the next row, under `cause`; `what` says which wait it is, for a message. */
      wait(ms, cause, what) {
        if (live) issue.waits.push({ from: t, to: t + ms, minutes: ms / MIN, cause, what });
        count(cause, ms);
        t += ms;
      },
      /** A job's notice: a `user` row whose origin has the kind `task-notification`, with the job's id in its <task-id>. */
      notice(job, call, summary) {
        prompt = `35340000-0000-4000-a000-${id.slice(-2)}${String(++issue.n).padStart(10, '0')}`;
        const text = `<task-notification>\n<task-id>${job}</task-id>\n<tool-use-id>${call}</tool-use-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`;
        row({ promptId: prompt, type: 'user', message: { role: 'user', content: text }, isMeta: true, promptSource: 'system', origin: { kind: 'task-notification', producer: 'session-task' }, turnOrigin: 'task_notification', queueSkipAttachments: true });
      },
      /** A PR link: a `pr-link` row's `prNumber`, written when the row before it is. */
      link(number = issue.pr.pr) {
        rows.push({ type: 'pr-link', sessionId: id, prNumber: number, prUrl: `https://github.com/${REPO}/pull/${number}`, prRepository: REPO, timestamp: iso(t) });
      },
      /** A helper's rows inside the wait that follows: `isSidechain` is true on each, so none is read. */
      sidechain() {
        const extra = { isSidechain: true, agentId: 'a3534sidechain01' };
        const call = `toolu_3534${serial()}`;
        let before = row({ type: 'user', message: { role: 'user', content: 'Look through the notes folder for stale entries.' }, origin: { kind: 'human' }, parentUuid: null }, t + 5 * MIN, extra);
        before = row({ ...assistant([{ type: 'tool_use', id: call, name: 'Bash', input: { command: 'ls notes' } }], 'tool_use'), parentUuid: before }, t + 6 * MIN, extra);
        before = row({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: 'lanes.md' }] }, toolUseResult: { stdout: 'lanes.md', stderr: '', interrupted: false, isImage: false }, parentUuid: before }, t + 9 * MIN, extra);
        row({ ...assistant([{ type: 'text', text: 'No stale entry.' }], 'end_turn'), parentUuid: before }, t + 10 * MIN, extra);
      },
      /** The session's last row until the merge, `ms` later: a person's wait, `merge`. */
      merge(ms) {
        if (live) issue.waits.push({ from: t, to: t + ms, minutes: ms / MIN, cause: 'merge', what: 'the last row of the session until the merge' });
        count('merge', ms);
        issue.merged = t + ms;
        live = false;
      },
      /**
       * A turn's end whose wait for the next prompt runs `whole` ms, with the merge `ms` into it. Only the part up to
       * the merge counts; the issue doesn't say whether that part is `merge` or `prompt`, so the two are expected
       * together. The rows that follow lie past the merge and count for nothing.
       */
      cut(ms, whole) {
        issue.waits.push({ from: t, to: t + whole, minutes: whole / MIN, cause: 'mergeOrPrompt', what: "a turn's end until a person's prompt that comes after the merge", counted: ms / MIN });
        count('mergeOrPrompt', ms);
        issue.merged = t + ms;
        live = false;
        t += whole;
      },
    };
  }

  /** The row the table should hold for this issue: whole minutes, by cause and by a person's six kinds. */
  expected() {
    const minutes = (cause) => Math.round(this.ms[cause] / MIN);
    const person = Object.fromEntries(KINDS.map((kind) => [kind, minutes(kind)]));
    const either = minutes('mergeOrPrompt');
    const causes = { own: minutes('own'), job: minutes('job'), person: KINDS.reduce((sum, kind) => sum + person[kind], 0) + either, hook: minutes('hook'), unplaced: minutes('unplaced') };
    return { issue: this.pr.issue, pr: this.pr.pr, first_prompt: this.first, merged: this.merged, minutes: (this.merged - this.first) / MIN, causes, person, either, prompts: this.asked - 1, waits: this.waits };
  }
}

/** Every transcript of the fixture, and what each issue's row should be. `tree` is the scratch repository. */
function sessions(tree) {
  const worktree = (name) => join(tree, 'worktrees', name);
  const bash = (command) => ({ command, description: command });
  const hookCalls = (s, count, ms, command) => { for (let k = 1; k <= count; k += 1) { s.think(MIN); s.call('Bash', bash(`${command} ${k}`), ms, 'hook', { hook: true }); } };
  const opened = (s, number) => { s.think(40 * SEC); s.call('Bash', bash('gh pr create --fill'), 20 * SEC, 'own', { text: `https://github.com/${REPO}/pull/${number}` }); s.link(); };

  // Issue 7101, found by its PR link, one session: a person's six kinds of wait, a call under a minute and calls over.
  const A = new Planted(PRS.A);
  const a = A.session(ID.A, worktree('issue-7101'), at(11, 8));
  a.prompt('Take issue 7101: count the lane notes by day, and open a PR when the table is right.');
  a.think(40 * SEC); a.call('Read', { file_path: 'notes/lanes.md' }, 20 * SEC, 'own', { text: 'lane notes' }); a.think(MIN);
  a.call('ExitPlanMode', { plan: 'Read the notes, count them by day, print the table.' }, 12 * MIN, 'plan', { text: 'User has approved your plan. You can now start coding.', result: { plan: 'Read the notes, count them by day, print the table.', isAgent: false } });
  a.think(MIN);
  const question = { question: 'Which day starts a week?', header: 'Week', options: [{ label: 'Monday', description: 'As the notes do' }, { label: 'Sunday', description: 'As the chart does' }], multiSelect: false };
  a.call('AskUserQuestion', { questions: [question] }, 9 * MIN, 'question', { text: 'User has answered your questions: "Which day starts a week?"="Monday".', result: { questions: [question], answers: { 'Which day starts a week?': 'Monday' } } });
  a.think(MIN);
  a.call('Bash', bash('node notes/count.mjs --write'), 6 * MIN, 'permission', { permission: { decision: 'accept', source: 'user_temporary' } });
  a.think(MIN);
  a.call('Bash', bash('node notes/check.mjs'), 3 * MIN, 'job', { permission: { decision: 'accept', source: 'config' } });
  a.think(30 * SEC); a.call('Bash', bash('node --test notes/'), 90 * SEC, 'job'); a.think(30 * SEC); a.call('Bash', bash('node --test notes/ --again'), 90 * SEC, 'job');
  opened(a, PRS.A.pr);
  a.think(MIN); a.end('The PR is open: the table counts the notes by day.');
  a.sidechain();
  a.wait(25 * MIN, 'prompt', "a turn's end until a person's prompt, with no job running");
  a.prompt("Please add the week's total under the table too.");
  a.think(3 * MIN); a.end('The total is under the table.');
  a.wait(30 * MIN, 'conflict', "a turn's end until the app's conflict line");
  a.prompt(CONFLICT_LINE);
  a.think(MIN); a.call('Bash', bash('git merge origin/main'), 5 * MIN, 'job'); a.think(MIN); a.end('The conflicts are resolved and pushed.');
  a.wait(15 * MIN, 'prompt', "a turn's end until a person's prompt that only talks of merge conflicts");
  a.prompt('Were there merge conflicts with main again? Rebase before this can merge next time.');
  a.think(MIN); a.end('Yes, in the notes file; it is rebased now.');
  a.merge(20 * MIN);

  // Issue 7102, a PR with two sessions that both hold its link: jobs, their notices, and 11 unanswered calls in a day.
  const B = new Planted(PRS.B);
  const b1 = B.session(ID.B1, worktree('issue-7102'), at(12, 13));
  b1.prompt('Take issue 7102: name each day a hook went quiet.');
  b1.think(MIN); b1.call('Bash', bash('npm run build'), 13 * MIN, 'job');
  b1.think(40 * SEC);
  const tests = b1.call('Bash', { ...bash('npm test'), run_in_background: true }, 20 * SEC, 'own', { text: 'Command running in background with ID: q7x2k9m41', result: { stdout: '', stderr: '', interrupted: false, isImage: false, backgroundTaskId: 'q7x2k9m41' } });
  b1.think(MIN); b1.end('The tests run in the background; I will read them when they end.');
  b1.wait(18 * MIN, 'job', "a turn's end until a background job's notice");
  b1.notice('q7x2k9m41', tests, 'Background command "npm test" completed (exit code 0)');
  b1.think(MIN); b1.end('The tests passed.');
  b1.wait(11 * MIN, 'prompt', "a turn's end until a person's prompt, after the session's one job had given its notice");
  b1.prompt('Good. Now check the count against the second log too.');
  b1.think(40 * SEC);
  const helper = b1.call('Agent', { description: 'Check the second log', prompt: 'Compare the day counts with the second log.', run_in_background: true }, 20 * SEC, 'own', { text: 'Async agent launched successfully. agentId: a51c07d2e9f3b6a84', result: { isAsync: true, status: 'async_launched', agentId: 'a51c07d2e9f3b6a84', description: 'Check the second log' } });
  b1.think(MIN); b1.end('A helper is checking the second log.');
  b1.wait(9 * MIN, 'job', "a turn's end until a person's prompt, while a job the session started still runs: its notice comes after the prompt");
  b1.prompt('While that runs: use the short day names in the table.');
  b1.think(2 * MIN); b1.end('The table uses the short names.');
  b1.wait(6 * MIN, 'job', "a turn's end until a background job's notice");
  b1.notice('a51c07d2e9f3b6a84', helper, 'Agent "Check the second log" completed');
  opened(b1, PRS.B.pr);
  hookCalls(b1, 6, 10 * MIN, 'node notes/days.mjs --day');
  b1.think(MIN); b1.end('Six calls got no answer from a hook; the day table is pushed.');
  // The second session starts a millisecond after the first one's last row, so no reading of the time between two
  // sessions of one PR, which the issue doesn't give, changes a minute.
  const b2 = B.session(ID.B2, worktree('issue-7102'), b1.t + 1);
  b2.prompt('Carry on with issue 7102 from the last session: the day table still needs its header.');
  b2.think(40 * SEC - 1); b2.call('Bash', bash(`gh pr view ${PRS.B.pr}`), 20 * SEC, 'own', { text: `https://github.com/${REPO}/pull/${PRS.B.pr}` }); b2.link();
  hookCalls(b2, 5, 10 * MIN, 'node notes/days.mjs --header');
  b2.think(MIN); b2.end('The header is in; five more calls got no answer from a hook.');
  b2.wait(14 * MIN, 'prompt', "a turn's end until a person's prompt, in a session that started no job");
  b2.prompt('Thanks. Is the PR ready to merge?');
  b2.think(MIN); b2.end('Yes: its checks are green.');
  b2.merge(10 * MIN);

  // Issue 7100, found only by its branch: it starts before the span, takes over 12 hours, thinks once for over 15
  // minutes and once for under, and has 10 unanswered calls in a day, which is not over 10. Its last prompt opens
  // with the conflict line's first two words and goes on in a person's own: it is a prompt like any other.
  const C = new Planted(PRS.C);
  const c = C.session(ID.C, tree, at(9, 20));
  c.prompt('Take issue 7100: run the night table once and leave the PR for the morning.');
  c.think(2 * MIN); c.call('Bash', bash('node notes/night.mjs'), 4 * MIN, 'job');
  c.think(45 * MIN, 'unplaced');
  c.call('Bash', bash('node notes/night.mjs --check'), 8 * MIN, 'job');
  c.think(14 * MIN); c.end('The night table ran once; the PR is open for the morning.');
  c.wait(660 * MIN, 'prompt', "a turn's end until a person's prompt, overnight");
  c.prompt("Morning. Print the table's ten rows once more, one call a row.");
  hookCalls(c, 10, 4 * MIN, 'node notes/night.mjs --row');
  c.think(MIN); c.end('Ten calls got no answer from a hook.');
  c.wait(10 * MIN, 'prompt', "a turn's end until a person's prompt that opens with the words Merge conflicts and goes on in its own");
  c.prompt('Merge conflicts are not the trouble here. Leave the rows, then: the table is enough.');
  c.think(MIN); c.end('Left as it is.');
  c.merge(15 * MIN);

  // Issue 7104, merged in the later span: its last turn's end waits two hours for the next prompt, and the merge
  // comes 35 minutes into that wait. The rows after the merge count for nothing.
  const D = new Planted(PRS.D);
  const d = D.session(ID.D, worktree('issue-7104'), at(17, 10));
  d.prompt("Take issue 7104: draw the chart's axes first.");
  d.think(MIN); d.call('Bash', bash('node notes/chart.mjs --axes'), 4 * MIN, 'job');
  opened(d, PRS.D.pr);
  d.think(MIN); d.end('The axes are drawn and the PR is open.');
  d.cut(35 * MIN, 120 * MIN);
  d.prompt('Merged, thanks. One more thing for the next PR: the bars.');
  d.think(2 * MIN); d.call('Bash', bash('node notes/chart.mjs --bars'), 6 * MIN, 'job'); d.think(MIN); d.end('Noted for the next PR.');

  // Sessions that belong to no row: a PR merged before every span, a PR whose body names no issue, a transcript on
  // issue 7101's branch that holds no PR link (the PR has one that does), and one of a PR the forge doesn't list.
  const H = new Planted(PRS.H);
  const h = H.session(ID.H, worktree('issue-7105'), at(5, 10));
  h.prompt('Take issue 7105: sort the notes.'); h.think(MIN); h.call('Bash', bash('node notes/sort.mjs'), 2 * MIN, 'job'); opened(h, PRS.H.pr); h.think(MIN); h.end('Sorted, and the PR is open.');
  const G = new Planted(PRS.G);
  const g = G.session(ID.G, worktree('tidy-lane-notes'), at(11, 14));
  g.prompt('Tidy the lane notes: no issue for it.'); opened(g, PRS.G.pr); g.think(MIN); g.end('Tidied, and the PR is open.');
  const X = new Planted({ ...PRS.A, pr: null });
  const x = X.session(ID.X, worktree('issue-7101-first-try'), at(10, 15));
  x.prompt('Look at issue 7101 and say what it needs.'); x.think(2 * MIN); x.end('It needs a table of the lane notes by day.');
  const U = new Planted({ issue: null, pr: 7299, branch: 'main' });
  const u = U.session(ID.U, tree, at(11, 16));
  u.prompt('What changed in the notes this week?'); u.think(MIN); u.call('Bash', bash('gh pr view 7299'), 2 * MIN, 'job'); u.link(7299); u.think(MIN); u.end('Three entries were added.');

  PRS.A.merged = A.merged; PRS.B.merged = B.merged; PRS.C.merged = C.merged; PRS.D.merged = D.merged;
  return { files: [A, B, C, D, H, G, X, U].flatMap((issue) => issue.files), rows: { A: A.expected(), B: B.expected(), C: C.expected(), D: D.expected() }, decoyFirstPrompt: X.first };
}

// The throttle's log (scripts/throttle.mjs, log()): in the span, 3 top-level build grants and 1 build timeout, 4
// top-level test grants and 1 test timeout, beside rows that are neither: nested grants, passes, turns, releases, a
// window, and the classes timed and bay-pair. Outside the span, rows of both classes that count for nothing.
function throttleLog() {
  const rows = [];
  let n = 0;
  const add = (when, entry) => rows.push({ at: iso(when), ...entry });
  const grant = (when, cls, kind, extra = {}) => { const id = `3534${String(++n).padStart(12, '0')}`; add(when, { event: 'granted', class: cls, grant: kind, id, pid: 4000 + n, index: 1, load: 21.4, cores: 18, wait: 30, ...extra }); add(when + 9 * MIN, { event: 'released', class: cls, id, pid: 4000 + n }); };
  const timeout = (when, cls) => add(when, { event: 'timeout', class: cls, id: `3534${String(++n).padStart(12, '0')}`, pid: 4000 + n, wait: 30 });
  for (const minute of [0, 20, 40]) grant(at(11, 9, minute), 'build', 'top-level');
  for (const minute of [5, 25]) grant(at(11, 9, minute), 'build', 'nested');
  timeout(at(11, 10, 30), 'build');
  for (const minute of [1, 11, 21, 31]) grant(at(11, 9, minute), 'test', 'top-level', { run: true, readings: { memory: 64 * 2 ** 30, load: 21.4, cores: 18 } });
  grant(at(11, 9, 41), 'test', 'nested', { run: true });
  timeout(at(11, 10, 31), 'test');
  grant(at(11, 11), 'timed', 'top-level');
  grant(at(11, 11, 20), 'bay-pair', 'top-level');
  timeout(at(11, 11, 40), 'timed');
  add(at(11, 9, 2), { event: 'passed', class: 'build', pid: 4901, through: 'test:3534000000000004' });
  add(at(11, 9, 3), { event: 'passed', class: 'test', pid: 4902, through: 'test:3534000000000004' });
  add(at(11, 9, 4), { event: 'turn', id: '3534turn00000001', run: '3534000000000004', pid: 4903 });
  add(at(11, 9, 6), { event: 'released', class: 'turn', id: '3534turn00000001', pid: 4903, run: '3534000000000004' });
  add(at(11, 12), { event: 'window-open', id: '3534window000001', pid: 4904 });
  add(at(11, 12, 30), { event: 'window-close', id: '3534window000001', pid: 4904 });
  for (const minute of [0, 10]) grant(at(5, 9, minute), 'build', 'top-level');
  for (const minute of [20, 30, 40]) timeout(at(5, 9, minute), 'build');
  grant(at(5, 10), 'test', 'top-level');
  grant(at(17, 9), 'build', 'top-level');
  for (const minute of [10, 20]) timeout(at(17, 9, minute), 'test');
  return rows.sort((one, two) => one.at.localeCompare(two.at));
}

// The load log (scripts/throttle.mjs, sample()): 20 samples in the span, a minute apart. A build grant is held in 10
// of them and a test grant in 4; 48 build requests and 10 test requests wait in them in all. In two more of them a
// timed and a bay-pair grant are held, and requests of those classes wait: neither is a build or a test. Samples
// outside the span, one of them failed, count for nothing.
function loadLog() {
  const share = (cpu) => ({ cpu, compile: 0, node: cpu, other: 0 });
  const sample = (when, held, waiting) => ({
    at: iso(when), load: 21.4, cores: 18,
    grants: held.map((cls, k) => ({ id: `3534held${String(k).padStart(8, '0')}`, class: cls, pid: 5000 + k, ...share(1.5) })),
    outside: share(2.25), top: [{ pid: 5100, command: 'node', cpu: 1.5 }], gpuUnread: 'no GPU reading on this machine',
    waiting: { build: 0, 'bay-pair': 0, test: 0, timed: 0, ...waiting }, idle: 14.25, busy: 3.75,
  });
  const rows = [];
  for (let k = 0; k < 20; k += 1) {
    const held = [...(k < 10 ? ['build'] : []), ...([2, 3, 12, 13].includes(k) ? ['test'] : []), ...(k === 15 ? ['timed'] : []), ...(k === 16 ? ['bay-pair'] : [])];
    rows.push(sample(at(11, 9, k), held, { ...(k < 12 ? { build: 4 } : {}), ...(k >= 5 && k < 15 ? { test: 1 } : {}), ...(k === 17 ? { timed: 2 } : {}), ...(k === 18 ? { 'bay-pair': 1 } : {}) }));
  }
  for (let k = 0; k < 10; k += 1) rows.push(sample(at(5, 9, k), ['build', 'test'], { build: 9, test: 3 }));
  rows.push({ at: iso(at(5, 9, 10)), load: 30.2, cores: 18, failed: 'ps listed no process' });
  for (let k = 0; k < 3; k += 1) rows.push(sample(at(17, 9, k), ['test'], { build: 1 }));
  return rows.sort((one, two) => one.at.localeCompare(two.at));
}
/** What the machine's lines should read over SPAN, from the two logs above. */
export const MACHINE = {
  build: { grants: 3, timeouts: 1, held: 10 / 20, waiting: 48 / 20, wait: 48 / (3 + 1) },
  test: { grants: 4, timeouts: 1, held: 4 / 20, waiting: 10 / 20, wait: 10 / (4 + 1) },
};

// scripts/known-failures.json of the scratch tree: five failures, two dated in SPAN and one in LATER, and three skips.
const failure = (name, issue, added) => [`tests/fixture-3534/${name}.test.ts › a planted failure named ${name}`, `fails since a made-up change (#${issue}, added ${added})`];
const KNOWN = {
  failures: Object.fromEntries([failure('before-one', 7150, '2025-02-20'), failure('before-two', 7151, '2025-03-07'), failure('in-one', 7152, '2025-03-11'), failure('in-two', 7153, '2025-03-12'), failure('later', 7154, '2025-03-17')]),
  lint: {}, lintIssues: {}, timing: [],
  skips: ['one', 'two', 'three'].map((name) => ({ id: `tests/fixture-3534/skip-${name}.test.ts › a planted skip named ${name}`, note: '', reason: 'a fixture of #3534', approval: 'a fixture' })),
};
/** What the quality counts should read over SPAN and over LATER. */
export const QUALITY = {
  span: { merged: 6, reverts: 1, failures: 5, failures_added: 2, skips: 3 },
  later: { merged: 1, reverts: 0, failures: 5, failures_added: 1, skips: 3 },
};

// The stand-in for gh. Every call goes to calls.jsonl. It answers the one call the issue names, `gh pr list`, from
// prs.json, as gh does: by --state (open unless given), by a `merged:` qualifier of --search, newest first, 30 unless
// --limit says otherwise, with the fields --json names (one the fixture doesn't hold reads null). Any other call
// exits 1, so it can't read as answered.
const GH = `import { appendFileSync, readFileSync } from 'node:fs';
const folder = new URL('.', import.meta.url);
const args = process.argv.slice(2);
appendFileSync(new URL('calls.jsonl', folder), JSON.stringify(args) + '\\n');
const refuse = (message) => { console.error('stand-in gh: ' + message); process.exit(1); };
const SHORT = { s: 'state', L: 'limit', S: 'search', R: 'repo', q: 'jq', B: 'base', H: 'head', A: 'author', l: 'label', t: 'template' };
const VALUED = new Set(['state', 'limit', 'search', 'repo', 'jq', 'base', 'head', 'author', 'label', 'template', 'json', 'app', 'assignee']);
const flags = {}, words = [];
for (let k = 0; k < args.length; k += 1) {
  const arg = args[k];
  if (!arg.startsWith('-')) { words.push(arg); continue; }
  const [name, inline] = arg.startsWith('--') ? arg.slice(2).split(/=(.*)/s) : [SHORT[arg.slice(1)] ?? arg.slice(1)];
  flags[name] = inline ?? (VALUED.has(name) ? args[k += 1] : true);
}
if (words[0] !== 'pr' || words[1] !== 'list') refuse('no answer to "gh ' + args.join(' ') + '": the fixture answers gh pr list alone');
if (!flags.json) refuse('gh pr list with no --json prints a table, which this stand-in does not draw');
if (flags.jq && flags.jq !== '.') refuse('this stand-in runs no --jq expression');
const day = (text, end) => Date.parse(/T/.test(text) ? text : text + (end ? 'T23:59:59.999Z' : 'T00:00:00.000Z'));
let from = -Infinity, to = Infinity;
for (const word of String(flags.search ?? '').split(/\\s+/)) {
  const value = /^merged:(.+)$/.exec(word)?.[1];
  if (!value) continue;
  if (value.includes('..')) { const [low, high] = value.split('..'); if (low !== '*') from = day(low, false); if (high !== '*') to = day(high, true); }
  else if (value.startsWith('>=')) from = day(value.slice(2), false);
  else if (value.startsWith('<=')) to = day(value.slice(2), true);
  else if (value.startsWith('>')) from = day(value.slice(1), true) + 1;
  else if (value.startsWith('<')) to = day(value.slice(1), false) - 1;
  else { from = day(value, false); to = day(value, true); }
}
const state = String(flags.state ?? 'open').toLowerCase();
const listed = JSON.parse(readFileSync(new URL('prs.json', folder), 'utf8'))
  .filter((pr) => state === 'all' || (state === 'merged' ? pr.state === 'MERGED' : state === 'closed' ? pr.state !== 'OPEN' : pr.state === 'OPEN'))
  .filter((pr) => (from === -Infinity && to === Infinity) || (pr.mergedAt && Date.parse(pr.mergedAt) >= from && Date.parse(pr.mergedAt) <= to))
  .sort((one, two) => two.number - one.number)
  .slice(0, Number(flags.limit ?? 30));
console.log(JSON.stringify(listed.map((pr) => Object.fromEntries(flags.json.split(',').map((field) => [field, pr[field] ?? null])))));
`;

const text = (rows) => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
const put = (path, content) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); };

let made;
/**
 * The fixture, made once for a test file's process: the scratch tree, the HOME, the transcripts, the stand-in gh and
 * the two logs, with the environment the command runs in. `cleanup` removes it.
 */
export function fixture() {
  if (made) return made;
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-3534-')));
  const [home, tree, bin, gh, temp] = ['home', 'tree', 'bin', 'gh', 'tmp'].map((name) => join(dir, name));
  for (const folder of [home, tree, bin, gh, temp]) mkdirSync(folder);
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), TMPDIR: temp,
    CLAUDE_CONFIG_DIR: join(home, '.claude'), DEEP_THROTTLE_TABLE: join(home, '.deepbuild', 'throttle'), GH_CONFIG_DIR: join(home, '.config', 'gh'),
    PATH: `${bin}${delimiter}${process.env.PATH}`, TZ: 'UTC', NO_COLOR: '1',
  };
  // No git, forge or proof-run setting of the caller's reaches the command: it reads the fixture alone.
  for (const name of Object.keys(env)) if (/^(?:GIT_|GITHUB_|GH_(?!CONFIG_DIR$))/.test(name) || ['DEEP_THROTTLE', 'DEEP_PERF_LOCK', 'NODE_TEST_CONTEXT', 'FORCE_COLOR', 'DEEP_THROTTLE_READINGS'].includes(name)) delete env[name];

  // The scratch tree: this checkout's scripts/ and adapters/, with known failures of the fixture's own. A script
  // finds its repository from its own path, so the copy reads the copy. It is a git repository, as a checkout is.
  cpSync(join(CHECKOUT, 'scripts'), join(tree, 'scripts'), { recursive: true });
  cpSync(join(CHECKOUT, 'adapters'), join(tree, 'adapters'), { recursive: true });
  put(join(tree, 'scripts/known-failures.json'), `${JSON.stringify(KNOWN, null, 2)}\n`);
  try {
    const git = (...args) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd: tree, env, stdio: 'pipe' });
    git('init', '-q', '-b', 'main');
    git('remote', 'add', 'origin', `https://github.com/${REPO}.git`);
    git('add', '-A');
    git('commit', '-qm', 'fixture');
  } catch {
    // Without git the tree is a plain folder: the command is named by its path, not by a repository.
  }

  const planted = sessions(tree);
  for (const { id, cwd, rows } of planted.files) put(join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`), text(rows));
  put(join(home, '.deepbuild', 'throttle', 'log'), text(throttleLog()));
  put(join(home, '.deepbuild', 'throttle', 'load.log'), text(loadLog()));

  // The forge writes a time to the second, with no fraction.
  const forgeTime = (ms) => iso(ms).replace('.000Z', 'Z');
  const forge = Object.values(PRS).map((pr) => ({
    number: pr.pr, title: pr.title, body: pr.body, headRefName: pr.branch, baseRefName: 'main', isDraft: false, url: `https://github.com/${REPO}/pull/${pr.pr}`,
    state: pr.open ? 'OPEN' : 'MERGED', mergedAt: pr.open ? null : forgeTime(pr.merged), closedAt: pr.open ? null : forgeTime(pr.merged), createdAt: forgeTime((pr.merged ?? at(13, 12)) - 3 * 60 * MIN),
  }));
  put(join(gh, 'prs.json'), JSON.stringify(forge));
  put(join(gh, 'gh.mjs'), GH);
  put(join(bin, 'gh'), `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(gh, 'gh.mjs'))} "$@"\n`);
  chmodSync(join(bin, 'gh'), 0o755);

  const rows = planted.rows;
  const read = [rows.A, rows.B, rows.C];
  const mean = (pick) => read.reduce((sum, row) => sum + pick(row), 0) / read.length;
  const total = {
    issues: read.length, mean: mean((row) => row.minutes), median: read.map((row) => row.minutes).sort((one, two) => one - two)[1], over_12h: read.filter((row) => row.minutes > 12 * 60).length / read.length,
    causes: Object.fromEntries(CAUSES.map((cause) => [cause, mean((row) => row.causes[cause])])), person: Object.fromEntries(KINDS.map((kind) => [kind, mean((row) => row.person[kind])])), prompts: mean((row) => row.prompts),
  };
  made = { dir, home, tree, gh, temp, env, rows, total, runs: new Map(), decoyFirstPrompt: planted.decoyFirstPrompt, hookDay: { day: '2025-03-12', hook_calls: 11, sessions: [ID.B1, ID.B2] }, quietDay: '2025-03-10', sessionIds: Object.values(ID) };
  // What the folders hold before the command has run once, for the test that it writes nothing.
  made.pristine = snapshot(made);
  return made;
}
export function cleanup() {
  if (made) rmSync(made.dir, { recursive: true, force: true });
}

const calls = (fx) => (existsSync(join(fx.gh, 'calls.jsonl')) ? readFileSync(join(fx.gh, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
const tail = (words, size) => (words.length > size ? `…${words.slice(-size)}` : words);

/** `node scripts/issue-time.mjs <args>` in the scratch tree: its exit, its output and the gh calls it made. */
export function issueTime(args, { fresh = false } = {}) {
  const fx = fixture(), key = args.join(' ');
  if (!fresh && fx.runs.has(key)) return fx.runs.get(key);
  const before = calls(fx).length;
  const result = spawnSync(process.execPath, ['scripts/issue-time.mjs', ...args], { cwd: fx.tree, env: fx.env, encoding: 'utf8', timeout: RUN_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 26 });
  const run = { command: `node scripts/issue-time.mjs ${key}`, status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '', gh: calls(fx).slice(before) };
  // A message names the scratch folder as <sandbox>, so it holds no path of this machine.
  run.said = `\`${run.command}\` exit ${run.status ?? `by ${run.signal} (given ${RUN_MS / 1000} s)`}\nstdout:\n${tail(run.stdout, 1_500)}\nstderr:\n${tail(run.stderr, 1_500)}`.split(fx.dir).join('<sandbox>');
  run.there = existsSync(join(fx.tree, 'scripts/issue-time.mjs'));
  fx.runs.set(key, run);
  return run;
}

/** A run of the command that started and ended by itself. Fails at an assertion when the script isn't there. */
export function started(run) {
  assert.ok(run.there, `scripts/issue-time.mjs does not exist in <checkout>, so the command the issue names has nothing to run\n${run.said}`);
  assert.ok(run.status !== null, `the command did not end by itself\n${run.said}`);
  return run;
}

/** The object `--json` prints over a span, with the run it came from. Fails at an assertion when there is none. */
export function reading(span) {
  const run = started(issueTime([...span, '--json']));
  let json;
  try { json = JSON.parse(run.stdout); } catch {}
  assert.ok(json && typeof json === 'object' && !Array.isArray(json), `with --json the command prints the table as one object, and this output is not one JSON object\n${run.said}`);
  const missing = ['since', 'until', 'issues', 'not_read', 'total', 'machine', 'quality', 'days'].filter((key) => !(key in json));
  assert.deepEqual(missing, [], `the object --json prints is { since, until, issues, not_read, total, machine, quality, days }, and this one has no ${missing.join(', ')}\n${run.said}`);
  return { json, run, said: run.said };
}

/** An issue or PR number, written as a number or as `#n`. */
export const numberOf = (value) => (typeof value === 'number' ? value : typeof value === 'string' && /^#?\d+$/.test(value.trim()) ? Number(value.trim().replace('#', '')) : NaN);
/** A time, written as an ISO string or as milliseconds; a string that names no zone is read as UTC, the run's TZ. */
export const instant = (value) => (typeof value === 'number' ? value : Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/.test(String(value)) ? String(value) : `${String(value).replace(' ', 'T')}Z`));
export const show = (value) => JSON.stringify(value);
export const plural = (count, word = 'minute') => `${count} ${word}${count === 1 ? '' : 's'}`;

/** A part of the object, which the Fields give as a list (`issues`, `not_read`, `days`) or as an object of its own. */
export function partOf(read, key) {
  const value = read.json[key], list = ['issues', 'not_read', 'days'].includes(key);
  assert.ok(list ? Array.isArray(value) : value && typeof value === 'object' && !Array.isArray(value), `\`${key}\` is ${list ? 'a list' : 'an object'} in the issue's Fields, and here it is ${show(value)}\n${read.said}`);
  return value;
}
/** The rows of `issues`. */
export const rowsOf = (read) => partOf(read, 'issues');

/** The one row of `issues` for an issue, with its `minutes`, `causes` and `person` in whole minutes. */
export function rowOf(read, want) {
  const found = rowsOf(read).filter((row) => numberOf(row?.issue) === want.issue);
  assert.equal(found.length, 1, `issue #${want.issue} (PR #${want.pr}, merged ${clock(want.merged)}) has ${found.length} rows in \`issues\`, not one; the rows are of ${show(rowsOf(read).map((row) => row?.issue))}\n${read.said}`);
  const [row] = found;
  const whole = (value) => Number.isInteger(value) && value >= 0;
  assert.ok(whole(row.minutes), `issue #${want.issue}: \`minutes\` is ${show(row.minutes)}, not a whole number of minutes\n${show(row)}`);
  for (const [field, names] of [['causes', CAUSES], ['person', KINDS]]) {
    const bad = names.filter((name) => !whole(row[field]?.[name]));
    assert.deepEqual(bad, [], `issue #${want.issue}: \`${field}\` gives whole minutes for ${names.join(', ')}, and ${bad.join(', ')} ${bad.length === 1 ? 'is' : 'are'} not: ${show(row[field])}`);
  }
  return row;
}

export const sum = (object) => Object.values(object).reduce((total, value) => total + value, 0);
/** A mean or a share, as near as a number printed to one decimal can be. */
export const near = (actual, expected) => typeof actual === 'number' && Math.abs(actual - expected) <= 0.051;

/** The waits of an issue's fixture that take `minutes`, for a message that names what a table left out. */
export const waitsOf = (want, minutes) => want.waits.filter((wait) => (wait.counted ?? wait.minutes) === minutes).map((wait) => `${wait.what}, ${clock(wait.from)} to ${clock(wait.to)}`);

/** Every file under the folders the command may not write, with its content's hash; git's own folder is left out. */
export function snapshot(fx) {
  const seen = {};
  const walk = (folder, name) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const path = join(folder, entry.name), label = `${name}/${entry.name}`;
      if (entry.isDirectory()) { seen[`${label}/`] = 'folder'; walk(path, label); } else if (entry.isFile()) seen[label] = createHash('sha256').update(readFileSync(path)).digest('hex');
      else seen[label] = 'other';
    }
  };
  walk(fx.tree, '<tree>');
  walk(fx.home, '~');
  walk(fx.temp, '<tmp>');
  return seen;
}

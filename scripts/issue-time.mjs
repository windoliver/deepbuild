// A reading of what an issue costs in elapsed time (#3534): for every issue whose PR merged in a span, the time from
// its session's first prompt to the merge, split by what it waited on. It writes nothing, and no verdict reads it.
//
//   node scripts/issue-time.mjs --since <YYYY-MM-DD> [--until <YYYY-MM-DD>] [--json]
//
// It reads records that exist, never what a session says of its own time: the forge's merged PRs through gh, Claude
// Code's transcripts where adapters/claude-code.facts.json says they are, and the throttle's log and load log under
// the home folder. A day is a UTC day, and a PR is in the span by the day it merged.
//
// Each minute has one cause. `own`: the agent's thinking, and a tool call that returns within a minute. `job`: a tool
// call that runs over a minute, and a turn's end until a background job's notice. `person`: a turn's end until a
// person's prompt, a plan's approval, a question's answer, a call a person permitted, and the last row until the
// merge. `hook`: a call whose result says a hook did not answer. `unplaced`: what the rows can't place, as thinking
// over 15 minutes, a call with no result, or a turn that ended and went on with neither a prompt nor a notice. No
// prompt is read for its words but the app's conflict line.
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const CAUSES = ['own', 'job', 'person', 'hook', 'unplaced'];
const PERSON = ['merge', 'prompt', 'conflict', 'plan', 'question', 'permission'];
// Where two sessions of one PR overlap, the minute is the busier one's: work before a wait, a named wait before none.
const RANK = ['own', 'job', 'hook', 'unplaced', 'permission', 'plan', 'question', 'conflict', 'prompt', 'merge'];
const MINUTE = 60_000, THINKING = 15 * MINUTE, DAY = 86_400_000;
const ISSUE = /\b(?:Closes|Fixes|Resolves|Part of)\s+#(\d+)/i;
const CONFLICT = /^\s*(?:[*-]\s*)?Merge conflicts\s+Resolve the merge conflicts before this can merge\./;
const HOOK = 'PreToolUse hook did not respond before its timeout';
const LIMIT = 5000;

class Blocked extends Error {}
const lines = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean) : []);
const rowsOf = (path) => lines(path).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
const textOf = (content) => (typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => (typeof part === 'string' ? part : part?.text ?? '')).join('\n') : '');
const mean = (numbers) => (numbers.length ? Math.round((10 * numbers.reduce((sum, n) => sum + n, 0)) / numbers.length) / 10 : null);

/**
 * Whole minutes for each name's milliseconds, rounded so that they sum to `total`, the whole of them unless one is
 * given: the largest remainders round up. Nothing is spread: minutes no name holds stay missing from the sum.
 */
function whole(ms, total = Math.round(Object.values(ms).reduce((sum, n) => sum + n, 0) / MINUTE)) {
  const exact = Object.entries(ms).map(([name, n]) => ({ name, minutes: Math.floor(n / MINUTE), rest: (n / MINUTE) % 1 }));
  let left = total - exact.reduce((sum, part) => sum + part.minutes, 0);
  for (const part of [...exact].sort((x, y) => y.rest - x.rest)) if (left-- > 0) part.minutes += 1;
  return Object.fromEntries(exact.map((part) => [part.name, part.minutes]));
}

/** The merged PRs, read from the forge once. */
function mergedPRs() {
  const gh = spawnSync('gh', ['pr', 'list', '--state', 'merged', '--limit', String(LIMIT), '--json', 'number,title,body,headRefName,mergedAt'], { cwd: root, encoding: 'utf8', maxBuffer: 2 ** 30 });
  if (gh.status !== 0) throw new Blocked(`could not read the merged PRs: ${(gh.error?.message ?? gh.stderr ?? '').trim().replaceAll('\n', ' ')}`);
  const prs = JSON.parse(gh.stdout);
  if (prs.length >= LIMIT) throw new Blocked(`gh listed ${prs.length} merged PRs, the most it was asked for, so some may be unread`);
  return prs;
}

/** Every transcript the facts file places, with the PR links and the branches its rows name. */
function transcripts() {
  const { home, path } = JSON.parse(readFileSync(join(root, 'adapters/claude-code.facts.json'), 'utf8')).transcripts;
  const folder = home.map((entry) => (entry.startsWith('~/') ? join(homedir(), entry.slice(2)) : process.env[entry])).find(Boolean);
  return globSync(path.replace(/\{[^}]*\}/g, '*'), { cwd: folder }).map((file) => {
    const text = readFileSync(join(folder, file), 'utf8');
    const links = text.split('\n').filter((line) => line.includes('"pr-link"')).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
    return {
      path: join(folder, file),
      session: basename(file, '.jsonl'),
      links: links.filter((row) => row.type === 'pr-link'),
      branches: new Set([...text.matchAll(/"gitBranch"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map(([, branch]) => JSON.parse(`"${branch}"`))),
    };
  });
}

/**
 * One session's minutes from its first prompt of a person on, as spans `{ from, to, cause }` in order, with its
 * person's prompts and the calls a hook left unanswered. A wait for a person carries its kind as the cause. A turn that
 * ended and never went on leaves no span: what follows it is the caller's to place.
 */
function timeline(path) {
  const rows = rowsOf(path).filter((row) => row.isSidechain !== true && Number.isFinite(Date.parse(row.timestamp))).map((row) => ({ ...row, at: Date.parse(row.timestamp) })).sort((a, b) => a.at - b.at);
  const parts = (row) => (Array.isArray(row.message?.content) ? row.message.content : []);
  const results = (row) => (row.type === 'user' ? parts(row).filter((part) => part?.type === 'tool_result') : []);
  const kindOf = (row) => (row.type === 'user' && !results(row).length ? row.origin?.kind : undefined);
  // When each background job started, and when each notice came with the jobs it names.
  const started = new Map(), notices = [];
  for (const row of rows) {
    const id = row.toolUseResult?.backgroundTaskId ?? row.toolUseResult?.agentId;
    if (results(row).length && id !== undefined) started.set(id, row.at);
    if (kindOf(row) === 'task-notification') notices.push({ at: row.at, ids: [...textOf(row.message?.content).matchAll(/<task-id>([^<]+)<\/task-id>/g)].map(([, job]) => job) });
  }
  // A job the session started before the turn ended, whose notice comes after the prompt, ran through the wait.
  const ranThrough = (ended, prompt) => notices.some((notice) => notice.at > prompt && notice.ids.some((job) => started.get(job) <= ended));
  const spans = [], prompts = [], hooks = [], open = new Map();
  let state = null, since = 0, ended = 0;
  const put = (to, cause) => {
    if (to > since) spans.push({ from: since, to, cause });
    since = Math.max(since, to);
  };
  // Thinking, a row at a time: a gap over 15 minutes is no one's.
  const think = (to) => put(to, to - since > THINKING ? 'unplaced' : 'own');
  for (const row of rows) {
    const kind = kindOf(row);
    if (kind === 'human') {
      const conflict = CONFLICT.test(textOf(row.message?.content));
      prompts.push({ at: row.at });
      if (state === 'ended') put(row.at, ranThrough(ended, row.at) ? 'job' : conflict ? 'conflict' : 'prompt');
      // A prompt that cuts in leaves its calls without a result: their minutes are no one's.
      else if (state === 'calling') put(row.at, 'unplaced');
      else if (state === null) since = row.at;
      if (state !== 'thinking') open.clear();
      state = 'thinking';
    } else if (state === null) {
      continue;
    } else if (kind === 'task-notification') {
      if (state === 'ended') {
        put(row.at, 'job');
        state = 'thinking';
      }
    } else if (results(row).length) {
      for (const result of results(row)) {
        const call = open.get(result.tool_use_id);
        if (!call) continue;
        const first = open.keys().next().value === result.tool_use_id;
        open.delete(result.tool_use_id);
        const unanswered = textOf(result.content).startsWith(HOOK);
        if (unanswered) hooks.push({ at: call.at });
        // Only the call that has waited longest holds the minutes: the others ran beside it.
        if (!first) continue;
        const permitted = String(row.permissionDecision?.source ?? '').startsWith('user');
        put(row.at, unanswered ? 'hook' : call.name === 'ExitPlanMode' ? 'plan' : call.name === 'AskUserQuestion' ? 'question' : permitted ? 'permission' : row.at - call.at > MINUTE ? 'job' : 'own');
        state = open.size ? 'calling' : 'thinking';
      }
    } else if (row.type === 'assistant') {
      // A turn that ended and went on with neither a prompt nor a notice: nothing says what it waited on.
      if (state === 'ended') put(row.at, 'unplaced');
      else if (state === 'thinking') think(row.at);
      for (const call of parts(row).filter((part) => part?.type === 'tool_use')) open.set(call.id, { name: call.name, at: row.at });
      if (open.size) state = 'calling';
      else if (row.message?.stop_reason === 'end_turn') [state, ended] = ['ended', row.at];
      else state = 'thinking';
    }
  }
  if (state === 'calling') put(rows.at(-1).at, 'unplaced');
  return { spans, prompts, hooks };
}

/** One PR's row from its sessions' timelines, cut at the merge, or why it can't be read. */
function issueRow(pr, issue, sessions) {
  const merged = Date.parse(pr.mergedAt);
  const lines = sessions.map((session) => ({ ...timeline(session.path), session: session.session }));
  const prompts = lines.flatMap((line) => line.prompts).filter((prompt) => prompt.at < merged).sort((a, b) => a.at - b.at);
  if (!prompts.length) return { unread: { issue, pr: pr.number, why: sessions.length ? 'its transcripts hold no prompt of a person before the merge' : 'no transcript holds its PR link or its head branch' } };
  const first = prompts[0].at, lastPrompt = prompts.at(-1).at;
  // A span is cut at the merge, and a wait for a prompt that the merge ends was a wait for the merge.
  const spans = lines.flatMap((line) => line.spans)
    .map((span) => ({ from: Math.max(span.from, first), to: Math.min(span.to, merged), cause: span.to > merged && ['prompt', 'conflict'].includes(span.cause) ? 'merge' : span.cause }))
    .filter((span) => span.to > span.from);
  const cuts = [...new Set([first, merged, lastPrompt, ...spans.flatMap((span) => [span.from, span.to])])].sort((a, b) => a - b);
  const ms = Object.fromEntries([...CAUSES.filter((cause) => cause !== 'person'), ...PERSON].map((name) => [name, 0]));
  for (let i = 0; i + 1 < cuts.length; i += 1) {
    const from = cuts[i], to = cuts[i + 1];
    const over = spans.filter((span) => span.from <= from && span.to >= to).map((span) => span.cause);
    // No session's minute: before the last prompt someone was waited on to prompt, after it the merge was.
    ms[RANK.find((cause) => over.includes(cause)) ?? (to <= lastPrompt ? 'prompt' : 'merge')] += to - from;
  }
  const causes = whole({ own: ms.own, job: ms.job, person: PERSON.reduce((sum, kind) => sum + ms[kind], 0), hook: ms.hook, unplaced: ms.unplaced });
  const hooks = lines.flatMap((line) => line.hooks.filter((call) => call.at >= first && call.at < merged).map((call) => ({ ...call, session: line.session })));
  return { row: { issue, pr: pr.number, first_prompt: new Date(first).toISOString(), merged: new Date(merged).toISOString(), minutes: Math.round((merged - first) / MINUTE), causes, person: whole(Object.fromEntries(PERSON.map((kind) => [kind, ms[kind]])), causes.person), prompts: prompts.length - 1 }, hooks };
}

/**
 * The machine's build and test lines over the span, from the throttle's log and load log. A request's wait is a minute
 * for each request waiting in each sample, over the span's grants and timeouts together, so it reads low where the
 * load log covers less of the span than the log does.
 */
function machine(from, to) {
  const folder = join(homedir(), '.deepbuild', 'throttle');
  const inSpan = (row) => Date.parse(row.at) >= from && Date.parse(row.at) < to;
  const events = rowsOf(join(folder, 'log')).filter(inSpan), samples = rowsOf(join(folder, 'load.log')).filter(inSpan);
  const tenth = (n) => Math.round(10 * n) / 10;
  return Object.fromEntries(['build', 'test'].map((cls) => {
    const grants = events.filter((row) => row.event === 'granted' && row.class === cls && row.grant === 'top-level');
    const timeouts = events.filter((row) => row.event === 'timeout' && row.class === cls);
    const waited = samples.reduce((sum, sample) => sum + (sample.waiting?.[cls] ?? 0), 0);
    const asked = grants.length + timeouts.length;
    const held = samples.filter((sample) => (sample.grants ?? []).some((grant) => grant.class === cls)).length;
    return [cls, { grants: grants.length, timeouts: timeouts.length, held: samples.length ? Math.round((1000 * held) / samples.length) / 1000 : null, waiting: samples.length ? tenth(waited / samples.length) : null, wait: samples.length && asked ? tenth(waited / asked) : null }];
  }));
}

function read(since, until) {
  const from = Date.parse(`${since}T00:00:00Z`), to = Date.parse(`${until}T00:00:00Z`) + DAY;
  const prs = mergedPRs().filter((pr) => Date.parse(pr.mergedAt) >= from && Date.parse(pr.mergedAt) < to).sort((a, b) => Date.parse(a.mergedAt) - Date.parse(b.mergedAt));
  // A link to another repository's PR of the same number is not this PR's.
  const own = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).stdout?.trim().match(/[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1].toLowerCase();
  const files = transcripts(), issues = [], unread = [], hooks = [];
  for (const pr of prs) {
    const issue = Number(pr.body?.match(ISSUE)?.[1]);
    if (!issue) continue;
    const linked = files.filter((file) => file.links.some((link) => link.prNumber === pr.number && (!own || !link.prRepository || link.prRepository.toLowerCase() === own)));
    const found = issueRow(pr, issue, linked.length ? linked : files.filter((file) => file.branches.has(pr.headRefName)));
    if (found.unread) unread.push(found.unread);
    else { issues.push(found.row); hooks.push(...found.hooks); }
  }
  const whole = issues.map((row) => row.minutes).sort((a, b) => a - b);
  const known = JSON.parse(readFileSync(join(root, 'scripts/known-failures.json'), 'utf8'));
  const added = Object.values(known.failures ?? {}).map((value) => String(value).match(/added (\d{4}-\d{2}-\d{2})\)\s*$/)?.[1]).filter((day) => day && day >= since && day <= until);
  const byDay = Map.groupBy(hooks, (call) => new Date(call.at).toISOString().slice(0, 10));
  return {
    since, until, issues, not_read: unread,
    total: {
      issues: issues.length, mean: mean(whole), median: whole.length ? (whole[Math.floor((whole.length - 1) / 2)] + whole[Math.ceil((whole.length - 1) / 2)]) / 2 : null,
      over_12h: issues.length ? Math.round((1000 * whole.filter((minutes) => minutes > 720).length) / issues.length) / 1000 : null,
      causes: Object.fromEntries(CAUSES.map((cause) => [cause, mean(issues.map((row) => row.causes[cause]))])),
      person: Object.fromEntries(PERSON.map((kind) => [kind, mean(issues.map((row) => row.person[kind]))])),
      prompts: mean(issues.map((row) => row.prompts)),
    },
    machine: machine(from, to),
    quality: { merged: prs.length, reverts: prs.filter((pr) => /^Revert/.test(pr.title ?? '')).length, failures: Object.keys(known.failures ?? {}).length, failures_added: added.length, skips: (known.skips ?? []).length },
    days: [...byDay].filter(([, calls]) => calls.length > 10).sort().map(([day, calls]) => ({ day, hook_calls: calls.length, sessions: [...new Set(calls.map((call) => call.session))].sort() })),
  };
}

function print(table) {
  const split = (causes, person) => `${CAUSES.map((cause) => `${cause} ${causes[cause]}`).join(', ')}; person: ${PERSON.map((kind) => `${kind} ${person[kind]}`).join(', ')}`;
  console.log(`issue time: PRs merged ${table.since} to ${table.until} (UTC days), ${table.issues.length} read, ${table.not_read.length} not read; minutes`);
  for (const row of table.issues) console.log(`#${row.issue} PR #${row.pr}: ${row.minutes} from ${row.first_prompt} to ${row.merged}; ${split(row.causes, row.person)}; prompts ${row.prompts}`);
  for (const row of table.not_read) console.log(`#${row.issue} PR #${row.pr}: not read, ${row.why}`);
  const { total } = table;
  if (total.issues) console.log(`total: ${total.issues} issues, mean ${total.mean}, median ${total.median}, ${Math.round(1000 * total.over_12h) / 10}% over 12 h; an issue: ${split(total.causes, total.person)}; prompts ${total.prompts}`);
  else console.log('total: no issue read, so no average');
  for (const [cls, line] of Object.entries(table.machine)) console.log(`machine ${cls}: ${line.grants} grants, ${line.timeouts} timed out${line.held === null ? ', no load sample in the span' : `, held in ${Math.round(1000 * line.held) / 10}% of samples, ${line.waiting} waiting on average${line.wait === null ? '' : `, ${line.wait} a request`}`}`);
  const { quality } = table;
  console.log(`quality: ${quality.merged} PRs merged, ${quality.reverts} of them a revert; known failures ${quality.failures}, ${quality.failures_added} added in the span, ${quality.skips} skips`);
  for (const day of table.days) console.log(`hook: ${day.day} had ${day.hook_calls} tool calls a hook left unanswered, in sessions ${day.sessions.join(', ')}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), day = /^\d{4}-\d{2}-\d{2}$/;
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  const since = value('--since'), until = value('--until') ?? new Date().toISOString().slice(0, 10);
  const known = args.every((arg, i) => ['--since', '--until', '--json'].includes(arg) || ['--since', '--until'].includes(args[i - 1]));
  if (!known || !day.test(since ?? '') || !day.test(until) || Number.isNaN(Date.parse(since)) || Number.isNaN(Date.parse(until)) || until < since) {
    console.log('BLOCKED issue time: usage: node scripts/issue-time.mjs --since <YYYY-MM-DD> [--until <YYYY-MM-DD>] [--json]');
    process.exitCode = 3;
  } else {
    try {
      const table = read(since, until);
      if (args.includes('--json')) console.log(JSON.stringify(table, null, 2));
      else print(table);
    } catch (error) {
      if (!(error instanceof Blocked)) throw error;
      console.log(`BLOCKED issue time: ${error.message}`);
      process.exitCode = 3;
    }
  }
}

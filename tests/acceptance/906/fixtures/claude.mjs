// #906's copy of tests/acceptance/27/fixtures/claude.mjs (itself #25's routes stand-in; same repo, same license), so a
// redraft of theirs never moves #906's tests (README: The Claude Code stand-in). One change, marked "#906" where it is:
// a synchronous hook entry that exits 0 with `hookSpecificOutput.additionalContext` has that context written into the
// transcript as a `hook_additional_context` attachment, as Claude Code records a hook's added context (and as
// tests/acceptance/25/fallbacks/fixtures/claude.mjs writes it). So the transcript holds what the agent was handed: a
// prompt's or a start's added context, a Stop's block reason ("Stop hook feedback"), a wake's prompt, and nothing
// from a reply deep-hook gave up on, since deep-hook printed nothing for it. Unchanged below this paragraph otherwise.
//
// A stand-in for Claude Code's side of the hook contract, the boundary these tests don't own (README: The Claude
// Code stand-in). Copied from tests/acceptance/18/install/fixtures/claude.mjs (same repo, same license) and extended
// with what Claude Code does with a hook's answer, as its facts (adapters/claude-code.facts.json) and the #80 spike
// record (spikes/80/decision.json and logs) show it: a Stop entry's block continues the turn with the reason as
// "Stop hook feedback"; an asyncRewake entry that exits 2 wakes an idle session with a turn whose UserPromptSubmit
// prompt is a task-notification carrying the entry's stderr; earlier asyncRewake entries keep running at a later
// Stop (the desktop app, #80). It decides nothing about DeepBuild and never edits the settings file. One process is
// one session's Claude Code, so every hook it runs, every Bash command it runs and its one `deep mcp` are its
// children, as they are a real session's.
//
//   node claude.mjs <deep CLI> <facts file>     one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
// Commands:
//   {op:'hook', event, payload, settings}  reads `settings` again now, picks the entries for `event` whose matcher
//       matches, and runs each command with `/bin/sh -c`, the payload on stdin, in the payload's cwd, all at once, each
//       in its own process group. A synchronous entry is waited for, and stopped at its `timeout` (seconds; else the
//       facts' hookTimeouts). An `async` or `asyncRewake` entry runs in the background with the same timeout; a later
//       hook never stops it. Answers {ran:[…], background:[…], blocked?}: each entry's command, exit code, signal,
//       stdout, stderr, start and end (epoch ms), and whether it was stopped at its timeout. For a Stop, `blocked` is
//       the reason a synchronous entry gave to continue the turn (exit 2 with stderr, or exit 0 with
//       {"decision":"block","reason":…}); Claude Code then writes "Stop hook feedback:\n<reason>" into the transcript
//       and the turn goes on. A UserPromptSubmit starts a turn; a Stop that isn't blocked ends it, and the session is idle.
//   {op:'background'}                     the background entries, each with its event, state and session.
//   {op:'expire', seconds}                Claude Code's timer for the background entries, moved on: each still
//                                         running whose timeout is at most `seconds` is stopped as Claude Code stops it.
//   {op:'configure', wake}                wake:false is a Claude Code that doesn't start a turn when an asyncRewake
//                                         entry exits 2 (the exit is still reported, marked dropped).
//   {op:'exec', command, cwd}             a command as the Bash tool runs it: `/bin/sh -c`, a child of this process.
//   {op:'mcp', line, timeoutMs}           one JSON-RPC line to this session's `deep mcp`, started on first use.
//   {op:'end'}                            the session ends: Claude Code stops its deep mcp and exits at once, and does
//                                         not stop its background entries (they are left to end on their own).
//   {op:'exit'}                           stops everything it started, then exits (the suite's cleanup).
//
// Unprompted lines (no `n`): {wake:{pid, session, code, at, stderr, dropped?, started?, prompt?, promptId?, fired?}},
// one per asyncRewake entry that exited 2: `at` is when it exited, `started` when its wake turn began (after the
// entry exited, at once if the session was idle, else once its running turn ended), `fired` that turn's
// UserPromptSubmit runs.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [, , CLI, FACTS] = process.argv;
const facts = JSON.parse(readFileSync(FACTS, 'utf8'));
const timeouts = facts.hookTimeouts;
const VERSION = facts.versions[facts.versions.length - 1];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
/** Every process group this session started, stopped when it exits through `exit`. */
const groups = new Set();
const background = [];
let mcp;
let settingsFile;
/** Whether a turn is running: a UserPromptSubmit starts one, a Stop that isn't blocked ends it. */
let busy = false;
let wakeOn = true;
const queued = [];

function stopGroup(pid) {
  try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, 1000).unref();
}
function quit() {
  for (const pid of groups) stopGroup(pid);
  if (mcp) try { mcp.child.kill('SIGKILL'); } catch { /* gone */ }
  setTimeout(() => process.exit(0), 50);
}
process.on('SIGTERM', quit);
process.on('SIGINT', quit);

/** One transcript entry, as Claude Code appends it to the session's transcript_path. */
function record(payload, entry) {
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: payload.session_id, cwd: payload.cwd, version: VERSION, userType: 'external', entrypoint: 'cli', ...entry };
  appendFileSync(payload.transcript_path, `${JSON.stringify(line)}\n`);
}

/** Whether a matcher group applies to this hook, as Claude Code reads `matcher`. */
function applies(group, event, payload) {
  const m = group?.matcher;
  if (m === undefined || m === null || m === '' || m === '*') return true;
  let subject;
  if (TOOL_EVENTS.has(event)) subject = payload.tool_name;
  else if (event === 'SessionStart') subject = payload.source;
  else if (event === 'Notification') subject = payload.notification_type;
  else return true;
  try { return new RegExp(`^(?:${m})$`).test(String(subject ?? '')); } catch { return m === subject; }
}

/** One command hook, run as Claude Code runs it; resolves when it exits or is stopped. */
function runEntry(entry, event, payload) {
  const seconds = typeof entry.timeout === 'number' ? entry.timeout : (timeouts.perHook?.[event] ?? timeouts.defaultMs) / 1000;
  const started = Date.now();
  const child = spawn('/bin/sh', ['-c', entry.command], { cwd: payload.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  groups.add(child.pid);
  const run = { command: entry.command, async: Boolean(entry.async || entry.asyncRewake), asyncRewake: Boolean(entry.asyncRewake), timeout: seconds, pid: child.pid, session: payload.session_id, started, ended: null, code: null, signal: null, stdout: '', stderr: '', timedOut: false, expired: false };
  child.stdout.setEncoding('utf8').on('data', (d) => (run.stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (run.stderr += d));
  child.stdout.on('error', () => undefined);
  child.stderr.on('error', () => undefined);
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify(payload));
  const timer = setTimeout(() => { run.timedOut = true; stopGroup(child.pid); }, seconds * 1000);
  run.done = new Promise((resolve) => child.on('close', (code, signal) => {
    clearTimeout(timer);
    groups.delete(child.pid);
    Object.assign(run, { code, signal, ended: Date.now() });
    // An asyncRewake entry that exits 2 wakes the session with its stderr (hooks reference; #80).
    if (run.asyncRewake && code === 2 && !run.timedOut && !run.expired) rewake(run, payload);
    resolve(run);
  }));
  run.stop = () => stopGroup(child.pid);
  return run;
}
const shown = ({ done: _d, stop: _s, ...run }) => run;

/** The reason a synchronous Stop entry gave to continue the turn, or undefined. */
function blockReason(run) {
  if (run.timedOut || run.signal) return undefined;
  if (run.code === 2) return run.stderr.replace(/\n+$/, '');
  if (run.code !== 0) return undefined;
  try {
    const reply = JSON.parse(run.stdout);
    return reply && reply.decision === 'block' ? String(reply.reason ?? '') : undefined;
  } catch {
    return undefined;
  }
}

async function hook({ event, payload, settings }) {
  settingsFile = settings;
  if (event === 'UserPromptSubmit') busy = true;
  let parsed = {};
  try { parsed = JSON.parse(readFileSync(settings, 'utf8')); } catch (error) { return { ran: [], background: [], settingsError: String(error) }; }
  const groupsFor = Array.isArray(parsed?.hooks?.[event]) ? parsed.hooks[event] : [];
  const seen = new Set();
  const entries = [];
  for (const group of groupsFor) {
    if (!applies(group, event, payload)) continue;
    for (const entry of Array.isArray(group?.hooks) ? group.hooks : []) {
      // Claude Code runs an identical command once per hook.
      if (entry?.type !== 'command' || typeof entry.command !== 'string' || seen.has(entry.command)) continue;
      seen.add(entry.command);
      entries.push(entry);
    }
  }
  const runs = entries.map((entry) => runEntry(entry, event, { ...payload, hook_event_name: event }));
  const sync = runs.filter((r) => !r.async);
  for (const r of runs.filter((r) => r.async)) background.push({ event, run: r });
  await Promise.all(sync.map((r) => r.done));
  // #906: what Claude Code writes for a hook's added context, before the turn goes on.
  for (const r of sync) {
    if (r.code !== 0 || r.timedOut || r.signal) continue;
    let context;
    try { context = JSON.parse(r.stdout)?.hookSpecificOutput?.additionalContext; } catch { context = undefined; }
    if (typeof context === 'string' && context) {
      record(payload, { type: 'attachment', ...(payload.prompt_id ? { promptId: payload.prompt_id } : {}), attachment: { type: 'hook_additional_context', content: [context], hookName: event, toolUseID: payload.tool_use_id ?? event, hookEvent: event } });
    }
  }
  const answer = { ran: sync.map(shown), background: runs.filter((r) => r.async).map(shown) };
  if (event === 'Stop') {
    const reasons = sync.map(blockReason).filter((r) => r !== undefined);
    if (reasons.length) {
      // The turn goes on with the reason (#80's desktop transcript: a user entry "Stop hook feedback:\n<reason>").
      answer.blocked = reasons.join('\n');
      record(payload, { type: 'user', ...(payload.prompt_id ? { promptId: payload.prompt_id } : {}), message: { role: 'user', content: `Stop hook feedback:\n${answer.blocked}` } });
      busy = true;
    } else {
      busy = false;
      setImmediate(drain);
    }
  }
  return answer;
}

/** An asyncRewake entry exited 2: a wake for its session, now if it is idle, else once its turn ends. */
function rewake(run, payload) {
  const wake = { pid: run.pid, session: payload.session_id, code: run.code, at: run.ended, stderr: run.stderr };
  if (!wakeOn) { out({ wake: { ...wake, dropped: true } }); return; }
  queued.push({ wake, payload });
  if (!busy) setImmediate(drain);
}
let draining = false;
async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (!busy && queued.length) {
      const { wake, payload } = queued.shift();
      busy = true;
      // #80 (Claude Code 2.1.303 and the desktop app): the wake's turn starts with a UserPromptSubmit whose prompt is
      // a task-notification carrying the waiter's stderr; the desktop transcript shows it enqueued, then as a user entry.
      const prompt = `<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\nStop hook blocking error from command "Stop": ${wake.stderr.replace(/\n+$/, '')}\n\n</system-reminder>`;
      const promptId = randomUUID();
      wake.started = Date.now();
      appendFileSync(payload.transcript_path, `${JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: new Date().toISOString(), sessionId: payload.session_id, content: prompt })}\n`);
      record(payload, { type: 'user', promptId, message: { role: 'user', content: prompt } });
      const base = { session_id: payload.session_id, transcript_path: payload.transcript_path, cwd: payload.cwd, permission_mode: payload.permission_mode ?? 'default', prompt_id: promptId, prompt };
      const fired = await hook({ event: 'UserPromptSubmit', payload: base, settings: settingsFile });
      out({ wake: { ...wake, prompt, promptId, fired } });
    }
  } finally {
    draining = false;
  }
}

function exec({ command, cwd }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('/bin/sh', ['-c', command], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr, started, ended: Date.now() }));
  });
}

function mcpCall(line, timeoutMs) {
  if (!mcp) {
    const child = spawn(process.execPath, [CLI, 'mcp'], { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    mcp = { child, lines: [], wakers: new Set(), stderr: '' };
    child.stderr.setEncoding('utf8').on('data', (d) => { mcp.stderr = (mcp.stderr + d).slice(-4000); });
    child.stdin.on('error', () => undefined);
    createInterface({ input: child.stdout }).on('line', (l) => { mcp.lines.push(l); for (const w of [...mcp.wakers]) w(); });
    child.on('close', () => { for (const w of [...mcp.wakers]) w(); });
  }
  if (line.id === undefined) {
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    return Promise.resolve({ reply: null, pid: mcp.child.pid });
  }
  return new Promise((resolve, reject) => {
    const from = mcp.lines.length;
    const finish = () => { clearTimeout(timer); mcp.wakers.delete(check); };
    const timer = setTimeout(() => { finish(); reject(Error(`deep mcp gave no reply to ${line.id} in ${timeoutMs} ms`)); }, timeoutMs);
    const check = () => {
      for (let i = from; i < mcp.lines.length; i++) {
        let json;
        try { json = JSON.parse(mcp.lines[i]); } catch { continue; }
        if (json.id === line.id && ('result' in json || 'error' in json)) { finish(); resolve({ reply: json, pid: mcp.child.pid }); return; }
      }
      if (mcp.child.exitCode !== null) { finish(); reject(Error(`deep mcp exited ${mcp.child.exitCode}: ${mcp.stderr}`)); }
    };
    mcp.wakers.add(check);
    mcp.child.stdin.write(`${JSON.stringify(line)}\n`);
    check();
  });
}

async function handle(command) {
  switch (command.op) {
    case 'hook': return hook(command);
    case 'background': return { background: background.map(({ event, run }) => ({ event, ...shown(run) })) };
    case 'expire': {
      const stopped = background.filter(({ run }) => run.ended === null && run.timeout <= command.seconds);
      for (const { run } of stopped) { run.expired = true; run.stop(); }
      await Promise.all(stopped.map(({ run }) => run.done));
      return { stopped: stopped.map(({ event, run }) => ({ event, ...shown(run) })) };
    }
    case 'configure': wakeOn = command.wake !== false; return {};
    case 'exec': return exec(command);
    case 'mcp': return mcpCall(command.line, command.timeoutMs ?? 120_000);
    case 'end': {
      if (mcp) try { mcp.child.kill('SIGTERM'); } catch { /* gone */ }
      setTimeout(() => process.exit(0), 50);
      return {};
    }
    case 'exit': quit(); return {};
    default: throw Error(`unknown op ${command.op}`);
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});
process.stdin.on('end', quit);

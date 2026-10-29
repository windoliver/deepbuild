// A stand-in for Claude Code's side of the hook contract, the boundary these tests don't own (README: The Claude
// Code stand-in). Copied from tests/acceptance/83/fixtures/claude.mjs and tests/acceptance/25/routes/fixtures/claude.mjs
// (same repo, same license) and joined: the hook log and the chat's `systemMessage` attachment (#83), the wake of an
// idle session when an asyncRewake entry exits 2 and the background entries' timer (#25), and, for #120, the one route
// the #80 spike found for a line while a call still runs: a SessionStart (or CwdChanged) reply's `watchPaths` are
// watched, and a change to one fires a FileChanged hook whose reply's `systemMessage` the terminal shows as a
// notification (spikes/80/decision.json, hooks/hook.mjs). It decides nothing about DeepBuild and never edits the
// settings file. One process is one session's Claude Code, so every hook it runs and its one `deep mcp` are its
// children, as they are a real session's.
//
//   node claude.mjs <deep CLI> <facts file> <hook log>     one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
// Commands:
//   {op:'hook', event, payload, settings}  reads `settings` again now, picks the entries for `event` whose matcher
//       matches, and runs each command with `/bin/sh -c`, the payload on stdin, in the payload's cwd, all at once, each
//       in its own process group. A synchronous entry is waited for, and stopped at its `timeout` (seconds; else the
//       facts' hookTimeouts). An `async` or `asyncRewake` entry runs in the background with the same timeout; a later
//       hook never stops it. Answers {ran:[…], background:[…], blocked?, shown?, model?, watch?}: each entry's command,
//       exit code, signal, stdout, stderr, start and end (epoch ms), and whether it was stopped at its timeout.
//       `blocked` is the reason a synchronous entry gave (exit 2 with stderr, or exit 0 with {"decision":"block",
//       "reason":…}): on a Stop the turn goes on with it ("Stop hook feedback:\n<reason>" in the transcript); on a
//       UserPromptSubmit the prompt never reaches the model and the reason is shown. `shown` is every `systemMessage`
//       the entries' replies carried, each saved as a hook_system_message attachment in the transcript (#80). `model`
//       is true when the hook started a model call: a UserPromptSubmit no entry blocked. `watch` is every path a
//       reply's `hookSpecificOutput.watchPaths` (or top-level `watchPaths`) named, now watched. A Stop that isn't
//       blocked ends the turn; the session is idle.
//   {op:'background'}                     the background entries, each with its event, state and session.
//   {op:'expire', seconds}                Claude Code's timer for the background entries, moved on: each still
//                                         running whose timeout is at most `seconds` is stopped as Claude Code stops it.
//   {op:'configure', wake}                wake:false is a Claude Code that doesn't start a turn when an asyncRewake
//                                         entry exits 2 (the exit is still reported, marked dropped).
//   {op:'watched'}                        the paths watched for FileChanged, from the replies that named them.
//   {op:'mcp', line, timeoutMs}           one JSON-RPC line to this session's `deep mcp`, started on first use.
//   {op:'end'}                            the session ends: Claude Code stops its deep mcp and exits at once, and does
//                                         not stop its background entries (they are left to end on their own).
//   {op:'exit'}                           stops everything it started, then exits (the suite's cleanup).
//
// Unprompted lines (no `n`):
//   {wake:{pid, session, code, at, stderr, dropped?, started?, prompt?, promptId?, fired?}}  one per asyncRewake entry
//       that exited 2: `at` is when it exited, `started` when its wake turn began (at once if the session was idle,
//       else once its running turn ended), `fired` that turn's UserPromptSubmit runs (#80: the wake's turn starts with
//       a UserPromptSubmit whose prompt is a task-notification carrying the entry's stderr).
//   {fileChanged:{path, at, fired}}  one per FileChanged hook fired for a watched path: `at` when the change was seen,
//       `fired` the hook's runs with their `shown` lines (the notification the terminal shows).
//
// The hook log (README: The hook log): one line per hook run, {at, agent:'claude-code', session, event, phase:'start'|
// 'reply', invocation, prompt?, reply?, exit?} and one {phase:'model', session, prompt} line whenever a prompt reaches
// the model.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, statSync, watchFile, unwatchFile } from 'node:fs';
import { createInterface } from 'node:readline';

const [, , CLI, FACTS, HOOK_LOG] = process.argv;
const facts = JSON.parse(readFileSync(FACTS, 'utf8'));
const timeouts = facts.hookTimeouts;
const VERSION = facts.versions[facts.versions.length - 1];
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const log = (line) => { if (HOOK_LOG) appendFileSync(HOOK_LOG, `${JSON.stringify({ at: Date.now(), agent: 'claude-code', ...line })}\n`); };
/** Every process group this session started, stopped when it exits through `exit`. */
const groups = new Set();
const background = [];
let mcp;
let settingsFile;
/** Whether a turn is running: a UserPromptSubmit the model got starts one, a Stop that isn't blocked ends it. */
let busy = false;
let wakeOn = true;
const queued = [];
/** The paths watched for FileChanged, each with the payload fields of the session that asked for the watch. */
const watched = new Map();
/** The last payload seen, so a FileChanged carries the session's fields and the running turn's prompt_id. */
let lastPayload;

function stopGroup(pid) {
  try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, 1000).unref();
}
function quit() {
  for (const pid of groups) stopGroup(pid);
  for (const path of watched.keys()) unwatchFile(path);
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
  else if (event === 'FileChanged') subject = payload.file_path;
  else return true;
  try { return new RegExp(`^(?:${m})$`).test(String(subject ?? '')); } catch { return m === subject; }
}

/** One command hook, run as Claude Code runs it; resolves when it exits or is stopped. */
function runEntry(entry, event, payload) {
  const seconds = typeof entry.timeout === 'number' ? entry.timeout : (timeouts.perHook?.[event] ?? timeouts.defaultMs) / 1000;
  const started = Date.now();
  const invocation = randomUUID();
  const child = spawn('/bin/sh', ['-c', entry.command], { cwd: payload.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  groups.add(child.pid);
  const run = { command: entry.command, async: Boolean(entry.async || entry.asyncRewake), asyncRewake: Boolean(entry.asyncRewake), timeout: seconds, pid: child.pid, invocation, session: payload.session_id, started, ended: null, code: null, signal: null, stdout: '', stderr: '', timedOut: false, expired: false };
  log({ session: payload.session_id, event, phase: 'start', invocation, command: entry.command, ...(payload.prompt !== undefined ? { prompt: payload.prompt } : {}) });
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
    log({ session: payload.session_id, event, phase: 'reply', invocation, exit: code, signal, ms: run.ended - started, reply: parsed(run.stdout) ?? run.stdout.slice(0, 2000), stderr: run.stderr.slice(0, 2000) });
    // An asyncRewake entry that exits 2 wakes the session with its stderr (hooks reference; #80).
    if (run.asyncRewake && code === 2 && !run.timedOut && !run.expired) rewake(run, payload);
    resolve(run);
  }));
  run.stop = () => stopGroup(child.pid);
  return run;
}
const shown = ({ done: _d, stop: _s, ...run }) => run;
function parsed(text) {
  try { const v = JSON.parse(text); return typeof v === 'object' && v !== null ? v : undefined; } catch { return undefined; }
}

/** The reason a synchronous entry gave to block (a Stop's turn goes on; a prompt never reaches the model), or undefined. */
function blockReason(run) {
  if (run.timedOut || run.signal) return undefined;
  if (run.code === 2) return run.stderr.replace(/\n+$/, '');
  if (run.code !== 0) return undefined;
  const reply = parsed(run.stdout);
  return reply && reply.decision === 'block' ? String(reply.reason ?? '') : undefined;
}
/** The systemMessage a reply carried, which the chat shows, or undefined. */
function systemMessage(run) {
  if (run.timedOut || run.signal || run.code !== 0) return undefined;
  const reply = parsed(run.stdout);
  return reply && typeof reply.systemMessage === 'string' ? reply.systemMessage : undefined;
}
/** The paths a reply asked Claude Code to watch (`hookSpecificOutput.watchPaths`, or `watchPaths`; spikes/80). */
function watchPathsOf(run) {
  if (run.timedOut || run.signal || run.code !== 0) return [];
  const reply = parsed(run.stdout);
  const paths = reply?.hookSpecificOutput?.watchPaths ?? reply?.watchPaths;
  return Array.isArray(paths) ? paths.filter((p) => typeof p === 'string' && p.length) : [];
}

/** Watches a path: a change to it fires FileChanged for the session, as Claude Code's terminal does (#80). */
function watch(path, payload) {
  if (watched.has(path)) return;
  const session = { session_id: payload.session_id, transcript_path: payload.transcript_path, cwd: payload.cwd, permission_mode: payload.permission_mode ?? 'default' };
  watched.set(path, session);
  let last = -1;
  try { const s = statSync(path); last = s.mtimeMs + s.size; } catch { last = -1; }
  watchFile(path, { persistent: true, interval: 100 }, (curr) => {
    const now = curr.nlink === 0 ? -1 : curr.mtimeMs + curr.size;
    if (now === last || curr.nlink === 0) return;
    last = now;
    const at = Date.now();
    const base = { ...session, ...(lastPayload?.prompt_id ? { prompt_id: lastPayload.prompt_id } : {}), hook_event_name: 'FileChanged', file_path: path, event: 'change' };
    hook({ event: 'FileChanged', payload: base, settings: settingsFile }).then((fired) => out({ fileChanged: { path, at, fired } }), (error) => out({ fileChanged: { path, at, failed: String(error) } }));
  });
}

async function hook({ event, payload, settings }) {
  settingsFile = settings;
  if (event !== 'FileChanged') lastPayload = payload;
  let parsedSettings = {};
  try { parsedSettings = JSON.parse(readFileSync(settings, 'utf8')); } catch (error) { return { ran: [], background: [], settingsError: String(error) }; }
  const groupsFor = Array.isArray(parsedSettings?.hooks?.[event]) ? parsedSettings.hooks[event] : [];
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
  const answer = { ran: sync.map(shown), background: runs.filter((r) => r.async).map(shown) };
  const messages = sync.map(systemMessage).filter((m) => m !== undefined);
  if (messages.length) {
    answer.shown = messages;
    // #80's desktop transcript: a hook's systemMessage is saved as a hook_system_message attachment.
    for (const content of messages) record(payload, { type: 'attachment', attachment: { type: 'hook_system_message', content } });
  }
  const paths = sync.flatMap(watchPathsOf);
  if (paths.length) {
    answer.watch = paths;
    for (const path of paths) watch(path, payload);
  }
  const reasons = sync.map(blockReason).filter((r) => r !== undefined);
  if (event === 'Stop') {
    if (reasons.length) {
      // The turn goes on with the reason (#80's desktop transcript: a user entry "Stop hook feedback:\n<reason>").
      answer.blocked = reasons.join('\n');
      record(payload, { type: 'user', ...(payload.prompt_id ? { promptId: payload.prompt_id } : {}), message: { role: 'user', content: `Stop hook feedback:\n${answer.blocked}` } });
      busy = true;
    } else {
      busy = false;
      setImmediate(drain);
    }
  } else if (event === 'UserPromptSubmit') {
    if (reasons.length) {
      // The prompt is not processed: it never reaches the model, and the reason is shown to the person.
      answer.blocked = reasons.join('\n');
      answer.model = false;
      record(payload, { type: 'attachment', attachment: { type: 'hook_blocked_prompt', content: answer.blocked } });
    } else {
      answer.model = true;
      busy = true;
      log({ session: payload.session_id, phase: 'model', prompt: payload.prompt ?? '' });
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
    case 'watched': return { watched: [...watched.keys()] };
    case 'busy': return { busy };
    case 'mcp': return mcpCall(command.line, command.timeoutMs ?? 120_000);
    case 'end': {
      if (mcp) try { mcp.child.kill('SIGTERM'); } catch { /* gone */ }
      for (const path of watched.keys()) unwatchFile(path);
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

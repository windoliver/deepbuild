// A stand-in for Claude Code's side of the hook contract, the boundary these tests don't own (README: The Claude
// Code stand-in). Copied from tests/acceptance/25/routes/fixtures/claude.mjs (same repo, same license) and extended
// with what #83 reads at Claude Code's side: the hook log it writes (one JSON line per hook run and per model call),
// a UserPromptSubmit entry's block, which keeps the prompt from the model and shows its reason (the hooks reference:
// "decision: block prevents the prompt from being processed, and the reason is shown to the user"), and a reply's
// `systemMessage`, which the chat shows and the desktop app saves as a hook_system_message attachment (#80). It decides
// nothing about DeepBuild and never edits the settings file. One process is one session's Claude Code, so every hook
// it runs and its one `deep mcp` are its children, as they are a real session's.
//
//   node claude.mjs <deep CLI> <facts file> <hook log>     one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
// Commands:
//   {op:'hook', event, payload, settings}  reads `settings` again now, picks the entries for `event` whose matcher
//       matches, and runs each command with `/bin/sh -c`, the payload on stdin, in the payload's cwd, all at once, each
//       in its own process group. A synchronous entry is waited for, and stopped at its `timeout` (seconds; else the
//       facts' hookTimeouts). An `async` or `asyncRewake` entry runs in the background with the same timeout; a later
//       hook never stops it. Answers {ran:[…], background:[…], blocked?, shown?, model?}: each entry's command, exit
//       code, signal, stdout, stderr, start and end (epoch ms), and whether it was stopped at its timeout. `blocked` is
//       the reason a synchronous entry gave (exit 2 with stderr, or exit 0 with {"decision":"block","reason":…}): on a
//       Stop the turn goes on with it ("Stop hook feedback:\n<reason>" in the transcript); on a UserPromptSubmit the
//       prompt never reaches the model and the reason is shown. `shown` is every `systemMessage` the entries' replies
//       carried, each saved as a hook_system_message attachment in the transcript. `model` is true when the hook
//       started a model call: a UserPromptSubmit no entry blocked. A Stop that isn't blocked ends the turn.
//   {op:'mcp', line, timeoutMs}           one JSON-RPC line to this session's `deep mcp`, started on first use.
//   {op:'end'}                            the session ends: Claude Code stops its deep mcp and exits at once.
//   {op:'exit'}                           stops everything it started, then exits (the suite's cleanup).
//
// The hook log (README: The hook log): one line per hook run, {at, agent:'claude-code', session, event, phase:'start'|
// 'reply', invocation, prompt?, reply?, exit?} and one {phase:'model', session, prompt} line whenever a prompt reaches
// the model. A status question answered from the record leaves no model line for its prompt.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
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
/** Whether a turn is running: a UserPromptSubmit the model got starts one, a Stop that isn't blocked ends it. */
let busy = false;

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
  const invocation = randomUUID();
  const child = spawn('/bin/sh', ['-c', entry.command], { cwd: payload.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  groups.add(child.pid);
  const run = { command: entry.command, async: Boolean(entry.async || entry.asyncRewake), asyncRewake: Boolean(entry.asyncRewake), timeout: seconds, pid: child.pid, invocation, session: payload.session_id, started, ended: null, code: null, signal: null, stdout: '', stderr: '', timedOut: false };
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

async function hook({ event, payload, settings }) {
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
  const reasons = sync.map(blockReason).filter((r) => r !== undefined);
  if (event === 'Stop') {
    if (reasons.length) {
      // The turn goes on with the reason (#80's desktop transcript: a user entry "Stop hook feedback:\n<reason>").
      answer.blocked = reasons.join('\n');
      record(payload, { type: 'user', ...(payload.prompt_id ? { promptId: payload.prompt_id } : {}), message: { role: 'user', content: `Stop hook feedback:\n${answer.blocked}` } });
      busy = true;
    } else busy = false;
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
    case 'busy': return { busy };
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

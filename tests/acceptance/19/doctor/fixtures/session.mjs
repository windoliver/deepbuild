// A stand-in for Claude Code's side of the hook contract, the boundary these tests don't own (README: Stand-ins).
// Copied unchanged in behavior from tests/acceptance/18/install/fixtures/claude.mjs (same repo, same license), so a
// redraft of that suite never moves these tests. It runs the command hooks of a settings file the way Claude Code does, and nothing else: it
// decides nothing, and it never edits the file. One process is one session's Claude Code, so every hook it runs,
// every Bash command it runs and its one `deep mcp` are its children, as they are a real session's.
//
//   node claude.mjs <deep CLI> <facts file>     one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
// Commands:
//   {op:'hook', event, payload, settings}  reads `settings` again now (Claude Code picks up a hook edit while it
//       runs), picks the entries for `event` whose matcher matches, and runs each command with `/bin/sh -c`, the
//       payload on stdin, in the payload's cwd, all at once. A synchronous entry is waited for, and stopped at its
//       `timeout` (seconds; else the facts' hookTimeouts). An `async` or `asyncRewake` entry runs in the background,
//       with the same timeout. Answers {ran:[…], background:[…]}: each entry's command, exit code, signal, stdout,
//       stderr, start and end (epoch ms), and whether it was stopped at its timeout.
//   {op:'background'}                     the background entries, each with its state.
//   {op:'expire', seconds}                Claude Code's timer for the background entries, moved on: each still
//                                         running whose timeout is at most `seconds` is stopped as Claude Code stops it.
//   {op:'exec', command, cwd}             a command as the Bash tool runs it: `/bin/sh -c`, a child of this process.
//   {op:'mcp', line, timeoutMs}           one JSON-RPC line to this session's `deep mcp`, started on first use.
//   {op:'exit'}
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [, , CLI, FACTS] = process.argv;
const timeouts = JSON.parse(readFileSync(FACTS, 'utf8')).hookTimeouts;
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
/** Every process group this session started, stopped when it exits. */
const groups = new Set();
const background = [];
let mcp;

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
  const run = { command: entry.command, async: Boolean(entry.async || entry.asyncRewake), asyncRewake: Boolean(entry.asyncRewake), timeout: seconds, pid: child.pid, started, ended: null, code: null, signal: null, stdout: '', stderr: '', timedOut: false, expired: false };
  child.stdout.setEncoding('utf8').on('data', (d) => (run.stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (run.stderr += d));
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify(payload));
  const timer = setTimeout(() => { run.timedOut = true; stopGroup(child.pid); }, seconds * 1000);
  run.done = new Promise((resolve) => child.on('close', (code, signal) => {
    clearTimeout(timer);
    groups.delete(child.pid);
    Object.assign(run, { code, signal, ended: Date.now() });
    resolve(run);
  }));
  run.stop = () => stopGroup(child.pid);
  return run;
}
const shown = ({ done: _d, stop: _s, ...run }) => run;

async function hook({ event, payload, settings }) {
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
  return { ran: sync.map(shown), background: runs.filter((r) => r.async).map(shown) };
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
    case 'exec': return exec(command);
    case 'mcp': return mcpCall(command.line, command.timeoutMs ?? 120_000);
    case 'exit': quit(); return {};
    default: throw Error(`unknown op ${command.op}`);
  }
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  handle(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});
process.stdin.on('end', quit);

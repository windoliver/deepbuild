// #327 AC2's blind redraft's copy of tests/acceptance/25/fallbacks/fixtures/claude.mjs (same repo, same license). One
// change, marked "lag" below: `configure({lag: ms})` writes the transcript entries a hook's reply becomes (a Stop hook's
// block reason, a hook's additionalContext) `ms` after the hook ends instead of at once. The design's Claude Code row
// says a session's `transcript_path` "can lag the live turn"; the lag holds open the moment between the hub's reply
// and the turn showing it, which is what AC2's "delivered and acknowledged" is judged across (README: Readings).
// Everything else is the #25 copy as it is.
//
// A stand-in for Claude Code's side of the hook contract, the boundary these tests don't own (README: The Claude
// Code stand-in). Copied from tests/acceptance/18/install/fixtures/claude.mjs (same repo, same license) and extended
// with what #25's fallbacks need from Claude Code, each modelled on its facts (adapters/claude-code.facts.json) and on
// what the #80 spike recorded (spikes/80/decision.json and its logs), never on what DeepBuild does:
//
// - A Stop hook that blocks (exit 2, or exit 0 with `decision: "block"`) continues the turn with its reason, which
//   Claude Code writes into the transcript as a user entry "Stop hook feedback:\n<reason>", and the next Stop says
//   `stop_hook_active: true` (the facts' continuation field). Claude Code caps consecutive stop-hook continuations at 8
//   (#80: "continued 8 send-backs in a row and overrode the 9th"; the count resets at a tool call): the block that
//   would be the 9th is overridden, the turn ends, and its reason never reaches the model or the transcript.
// - A background `asyncRewake` entry that exits 2 wakes the idle session (#80): Claude Code enqueues a
//   task-notification carrying the entry's stderr, writes it as the next user entry, and fires UserPromptSubmit with it
//   as the prompt; the Stop after it says `stop_hook_active: true`, as #80 recorded. One that exits 2 while a turn runs
//   is queued until the turn ends. In `wakes: false` mode (a desktop app that doesn't wake) the exit is only noted.
// - With `skip: ['asyncRewake']` this session's Claude Code runs no `asyncRewake` entry (the waiter's hook disabled for
//   the session).
// - A hook reply with `additionalContext` is written into the transcript as a hook_additional_context attachment.
//
// One process is one Claude Code process, so every hook it runs, every Bash command it runs and its one `deep mcp` are
// its children, as a real session's are; `/clear` and `/compact` change its session ID inside the same process. It
// decides nothing, and it never edits the settings file.
//
//   node claude.mjs <deep CLI> <facts file> [ignored args, such as --resume <id>, read by whoever looks at its argv]
//
// One JSON command per stdin line, one JSON answer per stdout line, by `n`:
//   {op:'configure', wakes?, skip?, cap?, entrypoint?, lag?}
//   {op:'hook', event, payload, settings}  runs the settings' entries for `event` as Claude Code does (see the #18 copy):
//       answers {ran, background, stop?} where `stop` (Stop only) is {blocked, reasons, continued, overridden, count}.
//   {op:'wakes'}                          every asyncRewake exit 2 so far: {at, stderr, woke, prompt, ran}.
//   {op:'background'} {op:'expire', seconds} {op:'exec', command, cwd} {op:'mcp', line, timeoutMs} {op:'exit'}
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
/** Every process group this session started, stopped when it exits. */
const groups = new Set();
const background = [];
let mcp;

/** How this Claude Code behaves: the cap is Claude Code's own, 8 unless set (#80). */
const config = { wakes: true, skip: [], cap: 8, entrypoint: 'cli', lag: 0 };
/** The turn as Claude Code keeps it: consecutive stop-hook blocks since the last tool call or typed prompt. */
const turn = { count: 0, continuing: false, idle: true, current: undefined };
const wakes = [];
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

/** A transcript entry as Claude Code writes it, into the current session's transcript. */
function write(entry, at = turn.current) {
  if (!at?.transcript_path) return;
  const line = { parentUuid: null, isSidechain: false, uuid: randomUUID(), timestamp: new Date().toISOString(), sessionId: at.session_id, cwd: at.cwd, version: VERSION, userType: 'external', entrypoint: config.entrypoint, ...entry };
  try { appendFileSync(at.transcript_path, `${JSON.stringify(line)}\n`); } catch { /* no transcript */ }
}
/** lag: an entry a hook's reply becomes, written `config.lag` ms after the hook ends (0: at once, as the #25 copy). */
function lagged(entry, at) {
  if (config.lag > 0) setTimeout(() => write(entry, at), config.lag);
  else write(entry, at);
}
const parsed = (text) => { try { const v = JSON.parse(text); return typeof v === 'object' && v !== null ? v : undefined; } catch { return undefined; } };

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

/** A background asyncRewake entry that exited 2 wakes the idle session with its stderr (#80). */
function rewoken(run) {
  const wake = { at: Date.now(), stderr: run.stderr, woke: false, prompt: null, ran: [] };
  wakes.push(wake);
  if (!config.wakes) return;
  if (turn.idle) void wakeNow(wake);
  else queued.push(wake);
}
async function wakeNow(wake) {
  const at = turn.current;
  if (!at || !at.settings) return;
  const content = `<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\nStop hook blocking error from command "Stop": ${wake.stderr.trim()}\n\n</system-reminder>`;
  const promptId = randomUUID();
  write({ type: 'queue-operation', operation: 'enqueue', content });
  write({ type: 'user', promptId, message: { role: 'user', content } });
  wake.woke = true;
  wake.prompt = content;
  // The turn a wake starts is a stop-hook continuation: the Stop after it says stop_hook_active (#80).
  turn.idle = false;
  turn.continuing = true;
  const { session_id, transcript_path, cwd, permission_mode } = at;
  const fired = await hook({ event: 'UserPromptSubmit', settings: at.settings, payload: { session_id, transcript_path, cwd, permission_mode: permission_mode ?? 'default', hook_event_name: 'UserPromptSubmit', prompt_id: promptId, prompt: content }, woken: true });
  wake.ran = [...fired.ran, ...fired.background];
}
function turnEnded() {
  turn.idle = true;
  turn.count = 0;
  turn.continuing = false;
  const next = queued.shift();
  if (next) void wakeNow(next);
}

/** What a Stop hook's synchronous entries say: each block's reason. */
function blocks(runs) {
  const reasons = [];
  for (const r of runs) {
    if (r.code === 2) { reasons.push(r.stderr.trim()); continue; }
    const reply = r.code === 0 ? parsed(r.stdout) : undefined;
    if (reply?.decision === 'block') reasons.push(String(reply.reason ?? ''));
  }
  return reasons;
}

async function hook({ event, payload, settings, woken = false }) {
  let file = {};
  try { file = JSON.parse(readFileSync(settings, 'utf8')); } catch (error) { return { ran: [], background: [], settingsError: String(error) }; }
  // The turn: a typed prompt starts one, a tool call resets the stop-hook count (#80), a session starts idle.
  if (event === 'SessionStart' || event === 'SessionEnd') { turn.idle = event === 'SessionStart'; turn.count = 0; turn.continuing = false; }
  if (event === 'UserPromptSubmit' && !woken) { turn.idle = false; turn.count = 0; turn.continuing = false; }
  if (event === 'PreToolUse') { turn.idle = false; turn.count = 0; }
  const body = { ...payload, hook_event_name: event };
  if (event === 'Stop' && body.stop_hook_active === undefined) body.stop_hook_active = turn.continuing;
  if (event !== 'SessionEnd') turn.current = { ...body, settings };
  const groupsFor = Array.isArray(file?.hooks?.[event]) ? file.hooks[event] : [];
  const seen = new Set();
  const entries = [];
  for (const group of groupsFor) {
    if (!applies(group, event, body)) continue;
    for (const entry of Array.isArray(group?.hooks) ? group.hooks : []) {
      // Claude Code runs an identical command once per hook.
      if (entry?.type !== 'command' || typeof entry.command !== 'string' || seen.has(entry.command)) continue;
      if (entry.asyncRewake && config.skip.includes('asyncRewake')) continue;
      seen.add(entry.command);
      entries.push(entry);
    }
  }
  const runs = entries.map((entry) => runEntry(entry, event, body));
  const sync = runs.filter((r) => !r.async);
  for (const r of runs.filter((r) => r.async)) {
    background.push({ event, run: r });
    if (r.asyncRewake) void r.done.then((done) => { if (done.code === 2 && !done.expired && !done.timedOut) rewoken(done); });
  }
  await Promise.all(sync.map((r) => r.done));
  // What Claude Code writes for a hook's added context.
  for (const r of sync) {
    const context = r.code === 0 ? parsed(r.stdout)?.hookSpecificOutput?.additionalContext : undefined;
    if (typeof context === 'string' && context) lagged({ type: 'attachment', attachment: { type: 'hook_additional_context', content: [context], hookName: event, toolUseID: body.tool_use_id ?? event, hookEvent: event } }, { ...body });
  }
  const answer = { ran: sync.map(shown), background: runs.filter((r) => r.async).map(shown), stopHookActive: body.stop_hook_active };
  if (event === 'Stop') {
    const reasons = blocks(sync);
    const stop = { blocked: reasons.length > 0, reasons, continued: false, overridden: false, count: turn.count };
    if (stop.blocked) {
      turn.count += 1;
      stop.count = turn.count;
      if (turn.count > config.cap) {
        // "A hook blocked the turn from ending 9 consecutive times — overriding and ending turn" (#80): the reason is lost.
        stop.overridden = true;
        turnEnded();
      } else {
        stop.continued = true;
        turn.continuing = true;
        lagged({ type: 'user', isMeta: true, promptId: body.prompt_id, message: { role: 'user', content: `Stop hook feedback:\n${reasons.join('\n')}` } }, { ...body });
      }
    } else {
      turnEnded();
    }
    answer.stop = stop;
  }
  return answer;
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
    case 'configure':
      for (const key of ['wakes', 'skip', 'cap', 'entrypoint', 'lag']) if (command[key] !== undefined) config[key] = command[key];
      return { config };
    case 'hook': return hook(command);
    case 'wakes': return { wakes };
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

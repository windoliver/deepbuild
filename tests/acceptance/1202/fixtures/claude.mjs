// A stand-in for Claude Code's side of the hook contract, the boundary these tests don't own (README: The Claude Code
// stand-in). It runs the command hooks of a settings file the way Claude Code does, and nothing else: it decides
// nothing and never edits a file. One process is one session's Claude Code, so every hook command it runs is its
// child, as a real session's are. Adapted from tests/acceptance/18/install/fixtures/claude.mjs (same repo, same
// license), with the shell named per hook, since the issue is about which shell `/bin/sh -c` turns out to be.
//
//   node claude.mjs     one JSON command per stdin line, one JSON answer per stdout line, by `n`
//
// Commands:
//   {op:'hook', shell, event, payload, settings}  reads `settings` now, picks the entries for `event` whose matcher
//       matches, and runs each command as `<shell> -c <command>`, the payload on stdin, in the payload's cwd, all at
//       once, each in a process group of its own. A synchronous entry is waited for, and stopped at its `timeout`
//       (seconds, else 60). An `async` or `asyncRewake` entry (the waiter) runs in the background until the session
//       exits or its timeout. Answers {standin, ran:[…], background:[…]}: this process's PID, and for each entry its
//       command, the PID of the `<shell> -c` process it started (shellPid), and, for a synchronous one, its exit code,
//       signal, stdout and stderr.
//   {op:'exit'}  stops every background entry's process group and exits.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'PermissionRequest']);
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const groups = new Set();

function stopGroup(pid) {
  try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
  setTimeout(() => { try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ } }, 1000).unref();
}
function quit() {
  for (const pid of groups) stopGroup(pid);
  setTimeout(() => process.exit(0), 1200);
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
  else return true;
  try { return new RegExp(`^(?:${m})$`).test(String(subject ?? '')); } catch { return m === subject; }
}

function runEntry(shell, entry, payload) {
  const seconds = typeof entry.timeout === 'number' ? entry.timeout : 60;
  const child = spawn(shell, ['-c', entry.command], { cwd: payload.cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  groups.add(child.pid);
  const run = { command: entry.command, shellPid: child.pid, code: null, signal: null, stdout: '', stderr: '', timedOut: false };
  child.stdout.setEncoding('utf8').on('data', (d) => (run.stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (run.stderr += d));
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify(payload));
  const timer = setTimeout(() => { run.timedOut = true; stopGroup(child.pid); }, seconds * 1000);
  run.done = new Promise((resolve) => child.on('close', (code, signal) => {
    clearTimeout(timer);
    groups.delete(child.pid);
    Object.assign(run, { code, signal });
    resolve();
  }));
  return run;
}
const shown = ({ done: _d, ...run }) => run;

async function hook({ shell, event, payload, settings }) {
  let parsed = {};
  try { parsed = JSON.parse(readFileSync(settings, 'utf8')); } catch (error) { return { standin: process.pid, ran: [], background: [], settingsError: String(error) }; }
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
  const runs = entries.map((entry) => ({ entry, run: runEntry(shell, entry, { ...payload, hook_event_name: event }) }));
  const sync = runs.filter(({ entry }) => !entry.async && !entry.asyncRewake).map(({ run }) => run);
  const background = runs.filter(({ entry }) => entry.async || entry.asyncRewake).map(({ run }) => run);
  await Promise.all(sync.map((r) => r.done));
  return { standin: process.pid, ran: sync.map(shown), background: background.map(shown) };
}

createInterface({ input: process.stdin }).on('line', (line) => {
  const command = JSON.parse(line);
  if (command.op === 'exit') { out({ n: command.n }); quit(); return; }
  if (command.op !== 'hook') { out({ n: command.n, failed: `unknown op ${command.op}` }); return; }
  hook(command).then((answer) => out({ n: command.n, ...answer }), (error) => out({ n: command.n, failed: String(error?.stack ?? error) }));
});
process.stdin.on('end', quit);

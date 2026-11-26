#!/usr/bin/env node
// Throwaway #3406 spike hook: not the real hook client and not the adapter. It writes one run's log and, where the
// run's plan says so, posts to the inbox of the session that started it. Nothing here is built to last.
//   node hook.mjs log [<run> <place>]   every hook event: a `start` line with the payload and what the hook was given
//   node hook.mjs act [<run> <place>]   an extra entry on Stop or PreToolUse: the run's next planned action
//   node hook.mjs post <run> <place> <id> <session> <invocation> <event>   the process an `outlived` action leaves behind
// The run folder and the place come from the command, or from SPIKE3406_RUN and SPIKE3406_PLACE in the session's
// environment. The token's value is never written: a line holds how many letters and digits it has and their SHA-256.
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, openSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const at0 = performance.timeOrigin + performance.now();

const [mode, runArg, placeArg, wanted, sessionArg, invocationArg, eventArg] = process.argv.slice(2);
const run = runArg ?? process.env.SPIKE3406_RUN, place = placeArg ?? process.env.SPIKE3406_PLACE;
const now = () => performance.timeOrigin + performance.now();
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const socket = process.env.CLAUDE_CODE_MESSAGING_SOCKET, token = process.env.CLAUDE_CODE_MESSAGING_TOKEN;
const letters = (token ?? '').replace(/[^A-Za-z0-9]/g, '');
const env = { socket: socket ?? null, tokenChars: letters.length, fingerprint: letters ? createHash('sha256').update(letters).digest('hex') : null };
const stdin = () => { const raw = readFileSync(0, 'utf8'); try { return JSON.parse(raw); } catch { return { unparsed: raw }; } };
const plan = () => JSON.parse(readFileSync(join(run, 'plan.json'), 'utf8'));
const claim = (id) => { try { closeSync(openSync(join(run, `claimed.${id}`), 'wx')); return true; } catch { return false; } };
const invocation = invocationArg ?? randomBytes(6).toString('hex');
let session = sessionArg, event = eventArg;
const write = (phase, more = {}) => appendFileSync(join(run, 'log.jsonl'), `${JSON.stringify({ at: now(), place, session, event, invocation, phase, ...more })}\n`);

// The agent's own argv, from the hook's parent upward, split on white space as ps prints it.
function agentArgv() {
  for (let pid = process.ppid, hops = 0; hops < 5 && pid > 1; hops++) {
    let row = '';
    try { row = execFileSync('ps', ['-o', 'ppid=,args=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return undefined; }
    const [ppid, ...rest] = row.split(/\s+/);
    if (/(^|\/)claude(\.exe)?$/.test(rest[0] ?? '')) return rest;
    pid = Number(ppid);
  }
  return undefined;
}

// One post: the auth line first when the action asks for it, then the user line. `at` is taken just before the
// connection; it stays open lingerMs more, so the line shows whether the inbox answered or closed it.
function send(action) {
  const line = { type: 'user', message: { role: 'user', content: action.text }, ...action.extra };
  const lines = [...(action.auth === 'wrong' ? [{ type: 'auth', token: '0'.repeat(32) }] : action.auth ? [{ type: 'auth', token }] : []), line];
  // A post that is neither of the two ways the issue names (no auth line from a process left behind, a wrong token,
  // another session's inbox) is a control, kept apart from the posts.
  const phase = action.control ? 'control' : 'post';
  const path = action.targetRun ? readFileSync(join(action.targetRun, 'log.jsonl'), 'utf8').trim().split('\n').map((entry) => JSON.parse(entry).env?.socket).findLast(Boolean) : socket;
  return new Promise((done) => {
    const sent = { id: action.id, way: action.way, auth: action.auth === true, nonce: action.nonce, wrote: false, reply: null, error: null, ppid: process.ppid, lingerMs: action.lingerMs ?? 3000, ...(action.control ? { control: action.control } : {}) };
    const at = now();
    const end = () => { appendFileSync(join(run, 'log.jsonl'), `${JSON.stringify({ at, place, session, event, invocation, phase, ...sent })}\n`); done(); };
    if (!path) { sent.error = 'no inbox address was given to the hook'; return end(); }
    if (action.auth === true && !token) { sent.error = 'no token was given to the hook'; return end(); }
    let reply = '';
    const client = connect(path);
    client.on('connect', () => client.write(lines.map((entry) => `${JSON.stringify(entry)}\n`).join(''), () => { sent.wrote = true; sent.wroteAt = now(); setTimeout(() => client.end(), sent.lingerMs); }));
    client.on('data', (chunk) => { reply += chunk; });
    client.on('error', (error) => { sent.error = error.code ?? String(error); });
    client.on('close', () => { sent.closedAt = now(); sent.reply = reply ? (token ? reply.split(token).join('<token>') : reply) : null; end(); });
  });
}

// Where the token's value is kept on disk: the files that hold it, read by a process that has it and named by path only.
function scan(payload) {
  const home = process.env.HOME, held = [], read = [];
  const files = (path) => { try { return statSync(path).isDirectory() ? readdirSync(path).map((name) => join(path, name)) : [path]; } catch { return []; } };
  for (const path of [join(home, '.claude', 'sessions'), payload.transcript_path, join(run, 'debug.log'), join(home, '.claude.json')].filter(Boolean).flatMap(files)) {
    try { if (statSync(path).isFile()) { read.push(path); if (token && readFileSync(path, 'utf8').includes(token)) held.push(path); } } catch {}
  }
  const tidy = (path) => path.split(home).join('~');
  write('scan', { tokenInEnv: token !== undefined, filesRead: read.length, placesRead: [...new Set(read.map((path) => tidy(join(path, '..'))))], filesHoldingToken: held.map(tidy) });
}

if (mode === 'log' || mode === 'act') {
  const payload = stdin();
  session = payload.session_id; event = payload.hook_event_name;
  const argv = mode === 'log' && ['SessionStart', 'Stop'].includes(event) && place !== 'desktop' ? agentArgv() : undefined;
  appendFileSync(join(run, 'log.jsonl'), `${JSON.stringify({ at: at0, place, session, event, invocation, phase: 'start', entry: mode, payload, env, ...(argv ? { agentArgv: argv } : {}) })}\n`);
  if (mode === 'log') {
    // No spike session may message a session outside the spike: a SendMessage goes only to the address its plan allows.
    if (event === 'PreToolUse' && payload.tool_name === 'SendMessage' && !plan().some((entry) => entry.allowTo && entry.allowTo === payload.tool_input?.to)) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'the spike allows a message only to its own target session' } }));
    // A wake whose words ride on the hook: the prompt a post of ours started gets the plan's words as this hook's context.
    const rider = event === 'UserPromptSubmit' && plan().find((entry) => entry.context && String(payload.prompt ?? '').includes(entry.nonce));
    if (rider) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: rider.context } }));
    if (event === 'PermissionRequest') process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } }));
  } else {
    const action = plan().find((entry) => entry.on === event && (!entry.command || String(payload.tool_input?.command ?? '').includes(entry.command)) && claim(entry.id));
    let stderr = '';
    if (action?.way === 'waiter') {
      await sleep(action.idleMs ?? 0);
      stderr = `${action.text}\n`;
      process.stderr.write(stderr);
      process.exitCode = 2;
    } else if (action?.way === 'scan') scan(payload);
    else if (action?.way === 'hook') for (const step of action.burst ?? [action]) { await sleep(step.idleMs ?? action.idleMs ?? 0); await send({ ...action, ...step }); }
    else if (action?.way === 'outlived') {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'post', run, place, action.id, session, invocation, event], { detached: true, stdio: 'ignore' });
      child.unref();
      write('spawned', { id: action.id, child: child.pid });
    }
    write('exit', { exit: process.exitCode ?? 0, stderr, ...(action?.way === 'waiter' ? { id: action.id, nonce: action.nonce } : {}) });
  }
} else if (mode === 'post') {
  const action = plan().find((entry) => entry.id === wanted);
  for (let waited = 0; process.ppid !== 1 && waited < 15_000; waited += 50) await sleep(50);
  await sleep(action.idleMs ?? 0);
  await send(action);
}

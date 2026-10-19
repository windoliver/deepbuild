// Throwaway #80 spike hook for Claude Code and Codex: not the real hook client, not the adapter.
// argv: <claude|codex> [main|waiter|status|async-line]
// What it does in a folder comes from that folder's .spike/control.json. Every call writes JSON
// lines to ~/deepbuild-spike80/logs/<surface>.jsonl in the shape tests/acceptance/80 reads,
// with the home folder written as ~ and the user name as "user".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const t0 = performance.now();
const HOME = os.homedir();
const USER = os.userInfo().username;
const ROOT = path.join(HOME, 'deepbuild-spike80');
const [agent = 'unknown', role = 'main'] = process.argv.slice(2);
const invocation = crypto.randomBytes(6).toString('hex');
const nonce = () => crypto.randomBytes(5).toString('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

let raw = '';
try { raw = fs.readFileSync(0, 'utf8'); } catch {}
let p = {};
try { p = JSON.parse(raw); } catch {}

const cwd = process.cwd();
const inRoot = cwd.startsWith(ROOT + path.sep);
const folder = inRoot ? cwd : path.join(ROOT, 'self');
const sp = path.join(folder, '.spike');
fs.mkdirSync(sp, { recursive: true });
fs.mkdirSync(path.join(ROOT, 'logs'), { recursive: true });
const ctl = readJson(path.join(sp, 'control.json'), {});

const surface = agent === 'claude'
  ? (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop' ? 'claude-desktop' : 'claude-terminal')
  : (path.basename(folder).startsWith('codex-desk') ? 'codex-desktop' : 'codex-cli');
const event = role === 'status' ? 'statusLine' : (p.hook_event_name || 'unknown');
const session = p.session_id || 'nosession';
const stPath = path.join(sp, `state-${session}.json`);
const st = readJson(stPath, { stops: 0, consecutive: 0, seen: [], ticks: 0, held: 0 });
const save = () => fs.writeFileSync(stPath, JSON.stringify(st));

const redact = (s) => s.split(HOME).join('~').replace(new RegExp(`(?<![\\w.-])${USER}(?![\\w-])`, 'gi'), 'user');
// Walk up from the hook's parent to the agent's own process, for its argv.
function agentArgv() {
  let pid = process.ppid;
  for (let i = 0; i < 5 && pid > 1; i++) {
    let args = '';
    try { args = execFileSync('ps', ['-o', 'ppid=,args=', '-p', String(pid)], { encoding: 'utf8' }).trim(); } catch { return null; }
    const [ppid, ...rest] = args.split(/\s+/);
    if (/(^|\/)(claude|codex)$/.test(rest[0] ?? '')) return rest;
    pid = Number(ppid);
  }
  return null;
}
const argv = surface === 'claude-terminal' ? agentArgv() : undefined;
const log = (phase, fields = {}) => fs.appendFileSync(path.join(ROOT, 'logs', `${surface}.jsonl`), redact(JSON.stringify({
  at: Date.now(), surface, session, event, invocation, phase, role, ...(argv ? { agentArgv: argv } : {}), ...fields })) + '\n');
const reply = (o, fields = {}) => { process.stdout.write(JSON.stringify(o) + '\n'); log('reply', { reply: o, ...fields }); };
const exit = (code = 0, fields = {}) => {
  // Time from this process's start (node's timeOrigin) to its exit: the hook's own overhead.
  log('exit', { exit: code, elapsedMs: +(Date.now() - performance.timeOrigin).toFixed(3), runMs: +(performance.now() - t0).toFixed(3), ...fields });
  process.exit(code);
};

// A waiter or status line this folder hasn't turned on leaves no lines, so it can't sit inside a run of stops.
if (role === 'waiter' && !ctl.waiter) process.exit(0);
if (role === 'status' && !ctl.statusLine) { process.stdout.write('spike80 status\n'); process.exit(0); }
log('start', { payload: p, entrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null });

// Messages the person typed that appeared in the transcript or rollout since the last hook.
function newAsks() {
  const file = p.transcript_path;
  if (!file || !fs.existsSync(file)) return [];
  const found = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    let text = null;
    if (e.type === 'queue-operation' && e.operation === 'enqueue' && typeof e.content === 'string' && !e.content.startsWith('<')) text = e.content;
    if (e.type === 'event_msg' && e.payload?.type === 'user_message') text = e.payload.message;
    if (!text || (st.prompts ?? []).includes(text)) continue;
    const key = crypto.createHash('sha256').update((e.timestamp || '') + text).digest('hex').slice(0, 12);
    if (st.seen.includes(key)) continue;
    st.seen.push(key);
    found.push(text);
  }
  return found;
}
// The typed nonce: the longest run of 8 or more letters and digits in the message.
const tokenOf = (text) => (text.match(/[A-Za-z0-9]{8,}/g) ?? []).sort((a, b) => b.length - a.length)[0];

if (role === 'status') {
  process.stdout.write('spike80 status\n');
  exit();
}

if (role === 'waiter') {
  // Claude Code asyncRewake waiter: exits 2 with the answer once .spike/answer.txt appears.
  const file = path.join(sp, 'answer.txt');
  const until = Date.now() + (ctl.waiter.seconds ?? 300) * 1000;
  let beat = Date.now();
  while (Date.now() < until) {
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim();
      fs.unlinkSync(file);
      const stderr = `DeepBuild spike answer, sent by the waiter: ${text}`;
      process.stderr.write(stderr + '\n');
      exit(2, { stderr, nonce: tokenOf(text) });
    }
    if (Date.now() - beat > 30000) { log('beat'); beat = Date.now(); }
    await sleep(100);
  }
  exit(0, { waiter: 'timeout' });
}

if (role === 'async-line') {
  // Codex background hook: after a delay, a warning line with a nonce, to see whether it shows while the call still runs.
  await sleep((ctl.asyncLineSeconds ?? 20) * 1000);
  const n = nonce();
  reply({ systemMessage: `DeepBuild spike: still running, async line ${n}` }, { nonce: n });
  exit();
}

// A prompt that arrives while a tool call is still open was typed mid-turn: it is an ask, seen at this hook.
if (event === 'UserPromptSubmit' && typeof p.prompt === 'string') {
  st.prompts = [...(st.prompts ?? []), p.prompt].slice(-50);
  if (st.openCall && !p.prompt.startsWith('<')) log('beat', { ask: { text: p.prompt }, nonce: tokenOf(p.prompt), midTurn: true });
}
if (event === 'PreToolUse') st.openCall = true;
if (['PostToolUse', 'PostToolUseFailure', 'Stop'].includes(event)) st.openCall = false;
const asks = ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit'].includes(event) ? newAsks() : [];
// Each ask gets a line of its own, so its nonce never stands in for a reply's.
if (asks.length) log('beat', { ask: { text: asks.join(' / ') }, nonce: tokenOf(asks.join(' ')) });

switch (event) {
  case 'SessionStart': {
    const tick = path.join(sp, 'ticker');
    fs.writeFileSync(tick, '0');
    save();
    if (agent === 'claude') reply({ hookSpecificOutput: { hookEventName: 'SessionStart', watchPaths: [tick] } });
    exit();
  }
  case 'CwdChanged': {
    // A session that started before the spike's hooks gets its watch list here instead.
    const tick = path.join(sp, 'ticker');
    if (!fs.existsSync(tick)) fs.writeFileSync(tick, '0');
    reply({ watchPaths: [tick] });
    exit();
  }
  case 'FileChanged': {
    st.ticks++; save();
    const n = nonce();
    reply({ systemMessage: `DeepBuild spike: still running (line ${st.ticks}, ${n})` }, { nonce: n });
    exit();
  }
  case 'PreToolUse':
  case 'PostToolUse': {
    if (event === 'PreToolUse') st.consecutive = 0;
    save();
    if (asks.length) {
      const o = { systemMessage: `DeepBuild spike: ask seen at ${event}: ${asks.join(' / ')}` };
      if (event === 'PostToolUse') o.hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: `The person typed while you worked: ${asks.join(' / ')}` };
      reply(o);
    }
    exit();
  }
  case 'UserPromptSubmit': {
    save();
    const file = path.join(sp, 'next-prompt.txt');
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim();
      fs.unlinkSync(file);
      reply({ systemMessage: `DeepBuild spike: delivered on your prompt: ${text}`,
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `DeepBuild spike, delivered on the next prompt: ${text}` } }, { nonce: tokenOf(text) });
    }
    exit();
  }
  case 'Stop': {
    st.stops++;
    const s = ctl.stop ?? { mode: 'pass' };
    const send = (checkMs, why) => {
      st.consecutive++; save();
      const n = nonce();
      const reason = `DeepBuild spike verdict: FAIL (${n}). ${why} Reply with exactly the code word ${n} and nothing else.`;
      reply({ decision: 'block', reason }, { nonce: n, checkMs: +checkMs.toFixed(3), consecutive: st.consecutive });
      exit();
    };
    if (s.mode === 'hold' && st.held < (s.times ?? 1)) {
      // A held stop: the "check" is a wait of holdSeconds, then the stop is sent back.
      st.held++; save();
      const c0 = performance.now();
      const until = Date.now() + s.holdSeconds * 1000;
      while (Date.now() < until) { await sleep(Math.min(60000, until - Date.now())); log('beat', { leftMs: until - Date.now() }); }
      send(performance.now() - c0, `DeepBuild spike: held ${s.holdSeconds} s, then sent back.`);
    }
    if (s.mode === 'check' && st.held < (s.times ?? 1)) {
      // A held stop whose check is a real command; the reply comes as soon as it ends.
      st.held++; save();
      const c0 = performance.now();
      try { execFileSync('/bin/sh', ['-c', s.command ?? 'true'], { stdio: 'ignore' }); } catch {}
      send(performance.now() - c0, `DeepBuild spike: check \`${s.command ?? 'true'}\` sent this stop back.`);
    }
    if (s.mode === 'block' && st.consecutive < (s.times ?? 1)) send(0, `DeepBuild spike send-back ${st.consecutive + 1} of ${s.times ?? 1}.`);
    save();
    const n = nonce();
    const line = `DeepBuild spike verdict: ${s.verdict ?? 'PASS'} (${n})`;
    // passAs "stopReason": the passing stop also ends with continue: false and the line as its stopReason.
    reply(s.passAs === 'stopReason' ? { continue: false, stopReason: line, systemMessage: line } : { systemMessage: line }, { nonce: n, consecutive: st.consecutive });
    exit();
  }
  default:
    if (agent === 'codex' && ['Stop', 'SubagentStop', 'Interrupt'].includes(event)) reply({});
    exit();
}

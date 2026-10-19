#!/usr/bin/env node
// A stand-in for the claude and codex binaries, for the #48 fast acceptance tests. The tests copy it
// into a temporary bin/ folder as `claude` and `codex`, beside a fake.json that sets its behavior,
// and point the harness at the copy. It speaks only what the real CLIs give a harness, nothing
// harness-specific, and everything it does is appended to calls.jsonl in its own folder.
//
// Claude Code: `--version`, `auth status`, `--settings` (a file or JSON) with SessionStart,
// UserPromptSubmit, Stop and SessionEnd command hooks, `async` and `asyncRewake` hooks, a status
// line command, `--session-id`, an interactive session that needs a terminal, and print mode
// (`-p`) with `--output-format text|json|stream-json`. Transcripts go where Claude Code puts them:
// $CLAUDE_CONFIG_DIR/projects/<cwd with every non-alphanumeric character as ->/<session>.jsonl.
// Each reply is one message on Haiku 4.5 written as one entry per content block, each entry
// repeating the message's usage, as Claude Code does: 10,000 input and 4,000 output tokens, $0.03
// at $1 and $5 per million, which the status line reports as cost.total_cost_usd.
//
// Codex: `--version`, `login status` and `codex exec` with `-s/--sandbox`, `--full-auto`,
// `--dangerously-bypass-approvals-and-sandbox`, `-C/--cd`, `--json` and `-o`, prompt on stdin.
// Its rollout goes where Codex puts it: $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<time>-<id>.jsonl,
// with token_count events whose input counts include cached input. Each reply is 10,000 input
// tokens (2,000 of them cached) and 4,000 output tokens, and carries no price, as on a plan.
//
// When CLAUDE_CONFIG_DIR or CODEX_HOME is unset, it writes into its own folder instead, never
// into your real home. fake.json keys: obey (default true: a Stop block or an asyncRewake exit 2
// continues the session, and a print-mode job tries to write every absolute path its prompt names
// inside its folder), ticks (null: spend a message every tickMs until stopped), tickMs, usage
// (false: report no usage and no cost anywhere), linger (leave two processes that ignore SIGTERM,
// SIGHUP and SIGINT), nonce and versions.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const self = fileURLToPath(import.meta.url);
const dir = dirname(self);
const name = basename(self);
const config = { obey: true, ticks: 0, tickMs: 200, usage: true, linger: false, ...JSON.parse(readFileSync(join(dir, 'fake.json'), 'utf8')) };
const args = process.argv.slice(2);
const log = (entry) => appendFileSync(join(dir, 'calls.jsonl'), `${JSON.stringify({ pid: process.pid, name, ...entry })}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const has = (...names) => names.some((flag) => args.includes(flag));
const flag = (...names) => {
  for (const option of names) {
    const index = args.indexOf(option);
    if (index >= 0) return args[index + 1];
    const joined = args.find((arg) => arg.startsWith(`${option}=`));
    if (joined) return joined.slice(option.length + 1);
  }
  return undefined;
};
const MODEL = name === 'codex' ? 'gpt-5.1-codex-mini' : 'claude-haiku-4-5';

// ---------------------------------------------------------------- shared

async function readStdin() {
  let text = '';
  if (!process.stdin.isTTY) for await (const chunk of process.stdin) text += chunk;
  return text;
}

function linger() {
  if (!config.linger) return;
  for (const [label, detached] of [['child', false], ['detached', true]])
    spawn(process.execPath, [self, '--linger', label], { detached, stdio: 'ignore' }).unref();
}

function started(sessionId, transcript, stdinBytes) {
  log({
    argv: args, sessionId, transcript, stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY),
    stdinBytes, cwd: process.cwd(), nested: 'CLAUDECODE' in process.env,
    homes: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR ?? null, CODEX_HOME: process.env.CODEX_HOME ?? null },
  });
}

// Absolute paths the prompt names inside the working folder: what a job is asked to write.
function targets(prompt) {
  const roots = [process.cwd(), realpathSync(process.cwd())].map((path) => `${path}/`);
  const found = (prompt.match(/\/[^\s'"`<>(){}[\],;]+/g) ?? []).map((path) => resolve(path.replace(/[.:]+$/, '')));
  return [...new Set(found.filter((path) => roots.some((root) => path.startsWith(root))))];
}

// Cumulative spend, logged after each message; `tokens.input` excludes cached input.
const spend = { messages: 0, input: 0, cached: 0, output: 0 };
const costUsd = () => Math.round(spend.messages * 3) / 100;
function logSpend(sessionId) {
  log({ spend: { sessionId, captured: config.usage, messages: spend.messages, tokens: { input: spend.input, cached: spend.cached, output: spend.output }, ...(name === 'claude' ? { costUsd: costUsd() } : {}) } });
}

// ---------------------------------------------------------------- Claude Code

function claudeSession() {
  const sessionId = flag('--session-id') ?? randomUUID();
  const cwd = process.cwd();
  const home = process.env.CLAUDE_CONFIG_DIR || join(dir, 'unset-claude-config-dir');
  const transcript = join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${sessionId}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  let settings = {};
  const value = flag('--settings');
  if (value) try { settings = JSON.parse(value.trim().startsWith('{') ? value : readFileSync(value, 'utf8')); } catch {}
  const session = { sessionId, cwd, transcript, settings, ended: false, continuations: 0, queue: Promise.resolve(), startedAt: Date.now() };
  session.write = (entry) => appendFileSync(transcript, `${JSON.stringify({ sessionId, cwd, version: config.versions.claude, timestamp: new Date().toISOString(), uuid: randomUUID(), ...entry })}\n`);
  session.enqueue = (work) => { session.queue = session.queue.then(work).catch(() => {}); };
  return session;
}

// One assistant message, written as one transcript entry per content block, each entry repeating
// the whole message's usage, as Claude Code writes them.
function claudeMessage(session, blocks) {
  spend.messages += 1;
  spend.input += 10_000;
  spend.output += 4_000;
  const usage = { input_tokens: 10_000, output_tokens: 4_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const id = `msg_fake_${randomUUID()}`;
  for (const block of blocks)
    session.write({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model: MODEL, content: [block], stop_reason: null, ...(config.usage ? { usage } : {}) } });
  logSpend(session.sessionId);
  statusLine(session);
}

const claudeReply = (session, text) => claudeMessage(session, [{ type: 'thinking', thinking: 'Considering the message.' }, { type: 'text', text }]);

function statusLine(session) {
  const command = session.settings.statusLine?.command;
  if (!command) return;
  const child = spawn('sh', ['-c', command], { cwd: session.cwd, stdio: ['pipe', 'ignore', 'ignore'] });
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({
    hook_event_name: 'Status', session_id: session.sessionId, transcript_path: session.transcript, cwd: session.cwd,
    model: { id: MODEL, display_name: 'Haiku 4.5' }, version: config.versions.claude, workspace: { current_dir: session.cwd, project_dir: session.cwd },
    ...(config.usage ? { cost: { total_cost_usd: costUsd(), total_duration_ms: Date.now() - session.startedAt, total_api_duration_ms: spend.messages * 1000, total_lines_added: 0, total_lines_removed: 0 } } : {}),
  }));
}

function hooksFor(session, event, source) {
  return (session.settings.hooks?.[event] ?? [])
    .filter((group) => event !== 'SessionStart' || !group.matcher || group.matcher === '*' || new RegExp(`^(?:${group.matcher})$`).test(source))
    .flatMap((group) => (group.hooks ?? []).filter((hook) => hook.type === 'command' && hook.command));
}

function runHook(session, hook, payload) {
  return new Promise((done) => {
    let stdout = '', stderr = '';
    const child = spawn('sh', ['-c', hook.command], { cwd: session.cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: session.cwd }, stdio: ['pipe', 'pipe', 'pipe'] });
    log({ hook: { pid: child.pid, event: payload.hook_event_name, command: hook.command, async: Boolean(hook.async || hook.asyncRewake) } });
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.stdin.on('error', () => {});
    const timer = setTimeout(() => child.kill('SIGKILL'), (hook.timeout ?? 600) * 1000);
    timer.unref();
    child.on('error', () => { clearTimeout(timer); done({ code: null, stdout, stderr }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    child.stdin.end(JSON.stringify(payload));
  });
}

// Runs an event's hooks: plain ones in turn, waited for; async ones in the background. An
// asyncRewake hook that exits 2 wakes the session with its stderr (or stdout).
async function fire(session, event, extra = {}) {
  const payload = { session_id: session.sessionId, transcript_path: session.transcript, cwd: session.cwd, permission_mode: 'default', hook_event_name: event, ...extra };
  const results = [];
  for (const hook of hooksFor(session, event, extra.source)) {
    if (hook.async || hook.asyncRewake) {
      runHook(session, hook, payload).then(({ code, stdout, stderr }) => {
        const words = stderr.trim() || stdout.trim();
        if (hook.asyncRewake && code === 2 && config.obey && !session.ended && words) session.enqueue(() => turn(session, words, 'wake'));
      });
    } else results.push(await runHook(session, hook, payload));
  }
  return results;
}

function blockReason(results) {
  for (const { code, stdout, stderr } of results) {
    if (code === 2) return stderr.trim() || 'Blocked by a Stop hook.';
    if (code === 0) try {
      const reply = JSON.parse(stdout.trim());
      if (reply?.decision === 'block') return String(reply.reason ?? '');
    } catch {}
  }
  return null;
}

const screen = (text) => { if (process.stdout.isTTY) process.stdout.write(`${text.replace(/\n/g, '\r\n')}\r\n`); };

// One turn: the words that start it, a reply that quotes them, then the Stop hooks. An obeying
// session continues on a block, up to Claude Code's cap of eight continuations in a row.
async function turn(session, words, kind) {
  if (session.ended) return;
  if (kind === 'prompt') {
    await fire(session, 'UserPromptSubmit', { prompt: words });
    session.write({ type: 'user', message: { role: 'user', content: words } });
  } else {
    session.write({ type: 'user', isMeta: true, message: { role: 'user', content: kind === 'stop' ? `Stop hook feedback:\n${words}` : words } });
  }
  const reply = `Understood: ${words}`;
  claudeReply(session, reply);
  screen(`● ${reply}`);
  const reason = blockReason(await fire(session, 'Stop', { stop_hook_active: kind === 'stop' }));
  if (reason !== null && config.obey && session.continuations < 8 && !session.ended) {
    session.continuations += 1;
    return turn(session, reason, 'stop');
  }
  session.continuations = 0;
  if (process.stdout.isTTY) process.stdout.write('> ');
}

async function end(session, reason) {
  if (session.ended) return;
  session.ended = true;
  await Promise.race([fire(session, 'SessionEnd', { reason }), sleep(5000)]);
  process.exit(0);
}

async function claudeInteractive() {
  const session = claudeSession();
  started(session.sessionId, session.transcript, 0);
  if (!process.stdin.isTTY) {
    // Claude Code's interface needs a terminal for its input.
    console.error('Error: Raw mode is not supported on the current process.stdin.');
    process.exit(1);
  }
  session.write({ type: 'system', content: `fake session ${config.nonce}` });
  process.on('SIGTERM', () => process.exit(143));
  process.on('SIGHUP', () => process.exit(129));
  await fire(session, 'SessionStart', { source: 'startup', model: MODEL });
  linger();
  process.stdin.setRawMode(true);
  process.stdin.setEncoding('utf8');
  process.stdout.write('\u001b[2J> ');
  let buffer = '', interrupted = 0;
  process.stdin.on('data', (chunk) => {
    for (const character of chunk.replace(/\u001b\[[0-9;?]*[~A-Za-z]/g, '')) {
      if (character === '\r' || character === '\n') {
        const line = buffer.trim();
        buffer = '';
        if (line === '/exit' || line === '/quit') return void end(session, 'prompt_input_exit');
        if (line) session.enqueue(() => turn(session, line, 'prompt'));
      } else if (character === '\u0003') {
        if (Date.now() - interrupted < 2000) return void end(session, 'other');
        interrupted = Date.now();
        buffer = '';
      } else if (character === '\u0004') {
        if (!buffer) return void end(session, 'other');
      } else if (character === '\u007f' || character === '\b') buffer = buffer.slice(0, -1);
      else if (character >= ' ' || character === '\t') buffer += character;
    }
  });
  process.stdin.on('end', () => void end(session, 'other'));
  process.stdin.on('error', () => {});
  if (config.ticks === null) {
    claudeReply(session, 'tick');
    setInterval(() => claudeReply(session, 'tick'), config.tickMs);
  }
}

function claudeMayWrite() {
  const mode = flag('--permission-mode');
  const allowed = flag('--allowedTools', '--allowed-tools') ?? '';
  return has('--dangerously-skip-permissions') || ['bypassPermissions', 'acceptEdits'].includes(mode) || /\b(?:Write|Edit|MultiEdit|Bash)\b/.test(allowed);
}

async function claudePrint() {
  const prompt = await readStdin();
  const session = claudeSession();
  started(session.sessionId, session.transcript, Buffer.byteLength(prompt));
  session.write({ type: 'system', content: `fake session ${config.nonce}` });
  await fire(session, 'SessionStart', { source: 'startup', model: MODEL });
  linger();
  session.write({ type: 'user', message: { role: 'user', content: prompt } });
  if (config.obey) for (const path of targets(prompt)) {
    const allowed = claudeMayWrite();
    const id = `toolu_fake_${randomUUID()}`;
    claudeMessage(session, [{ type: 'tool_use', id, name: 'Write', input: { file_path: path, content: 'probe' } }]);
    if (allowed) writeFileSync(path, 'written by the fake agent\n');
    session.write({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: !allowed, content: allowed ? `File created successfully at: ${path}` : `Claude requested permissions to write to ${path}, but you haven't granted it yet.` }] } });
    log({ write: { sessionId: session.sessionId, path, allowed } });
  }
  if (config.ticks === null) for (;;) { claudeReply(session, 'tick'); await sleep(config.tickMs); }
  claudeReply(session, 'Done.');
  const usage = config.usage ? { input_tokens: spend.input, output_tokens: spend.output, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } : undefined;
  const result = { type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: session.sessionId, num_turns: spend.messages, ...(config.usage ? { total_cost_usd: costUsd(), usage } : {}) };
  const format = flag('--output-format');
  if (format === 'json') console.log(JSON.stringify(result));
  else if (format === 'stream-json') {
    console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: session.sessionId, model: MODEL, cwd: session.cwd, tools: [] }));
    console.log(JSON.stringify(result));
  } else console.log('Done.');
  process.exit(0);
}

// ---------------------------------------------------------------- Codex

function codexSandbox() {
  if (has('--dangerously-bypass-approvals-and-sandbox', '--yolo')) return 'danger-full-access';
  if (has('--full-auto')) return 'workspace-write';
  const configured = args.map((arg, index) => (args[index - 1] === '-c' || args[index - 1] === '--config') ? arg : null).filter(Boolean)
    .map((pair) => pair.match(/^sandbox_mode\s*=\s*"?([\w-]+)"?$/)?.[1]).find(Boolean);
  return flag('-s', '--sandbox') ?? configured ?? 'read-only';
}

async function codexExec() {
  const cd = flag('-C', '--cd');
  if (cd) process.chdir(cd);
  const prompt = await readStdin();
  const threadId = randomUUID();
  const now = new Date();
  const day = now.toISOString().slice(0, 10).split('-');
  const home = process.env.CODEX_HOME || join(dir, 'unset-codex-home');
  const rollout = join(home, 'sessions', ...day, `rollout-${now.toISOString().slice(0, 19).replace(/:/g, '-')}-${threadId}.jsonl`);
  mkdirSync(dirname(rollout), { recursive: true });
  started(threadId, rollout, Buffer.byteLength(prompt));
  const record = (type, payload) => appendFileSync(rollout, `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`);
  const json = has('--json', '--experimental-json');
  const emit = (event) => { if (json) console.log(JSON.stringify(event)); };
  const sandbox = codexSandbox();
  const resetsAt = Math.floor(Date.now() / 1000) + 3600;
  const rateLimits = { primary: { used_percent: 12, window_minutes: 300, resets_at: resetsAt }, secondary: { used_percent: 31, window_minutes: 10080, resets_at: resetsAt + 86_400 }, plan_type: 'plus' };
  let last = '';

  record('session_meta', { id: threadId, timestamp: now.toISOString(), cwd: process.cwd(), originator: 'codex_exec', cli_version: config.versions.codex, source: 'exec', fake_nonce: config.nonce });
  record('turn_context', { cwd: process.cwd(), approval_policy: 'never', sandbox_policy: { mode: sandbox }, model: MODEL });
  // Codex logs a rate-limit snapshot with no token info before the first response.
  record('event_msg', { type: 'token_count', info: null, rate_limits: rateLimits });
  record('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] });
  emit({ type: 'thread.started', thread_id: threadId });
  emit({ type: 'turn.started' });
  linger();

  // Codex counts cached input inside input_tokens; spend.input keeps it apart.
  const reply = (text) => {
    spend.messages += 1;
    spend.input += 8_000;
    spend.cached += 2_000;
    spend.output += 4_000;
    last = text;
    record('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
    if (config.usage) record('event_msg', { type: 'token_count', rate_limits: rateLimits, info: {
      total_token_usage: { input_tokens: spend.input + spend.cached, cached_input_tokens: spend.cached, output_tokens: spend.output, reasoning_output_tokens: 0, total_tokens: spend.input + spend.cached + spend.output },
      last_token_usage: { input_tokens: 10_000, cached_input_tokens: 2_000, output_tokens: 4_000, reasoning_output_tokens: 0, total_tokens: 14_000 },
      model_context_window: 272_000,
    } });
    emit({ type: 'item.completed', item: { id: `item_${spend.messages}`, type: 'agent_message', text } });
    logSpend(threadId);
  };

  if (config.obey) for (const path of targets(prompt)) {
    const allowed = sandbox !== 'read-only';
    const callId = `call_${randomUUID()}`;
    const command = ['bash', '-lc', `printf probe > ${path}`];
    record('response_item', { type: 'function_call', name: 'shell', call_id: callId, arguments: JSON.stringify({ command, workdir: process.cwd() }) });
    if (allowed) writeFileSync(path, 'written by the fake agent\n');
    record('response_item', { type: 'function_call_output', call_id: callId, output: JSON.stringify({ output: allowed ? '' : `bash: ${path}: Operation not permitted`, metadata: { exit_code: allowed ? 0 : 1 } }) });
    emit({ type: 'item.completed', item: { id: callId, type: 'command_execution', command: command.join(' '), aggregated_output: allowed ? '' : `bash: ${path}: Operation not permitted`, exit_code: allowed ? 0 : 1, status: allowed ? 'completed' : 'failed' } });
    log({ write: { sessionId: threadId, path, allowed } });
  }

  if (config.ticks === null) for (;;) { reply('tick'); await sleep(config.tickMs); }
  reply('Done.');
  emit({ type: 'turn.completed', ...(config.usage ? { usage: { input_tokens: spend.input + spend.cached, cached_input_tokens: spend.cached, output_tokens: spend.output } } : {}) });
  const output = flag('-o', '--output-last-message');
  if (output) writeFileSync(output, last);
  if (!json) console.log(last);
  process.exit(0);
}

// ---------------------------------------------------------------- dispatch, last, so every
// declaration above is initialized before a session uses it

if (args[0] === '--linger') {
  // A process an agent left behind: it ignores polite signals, so only a SIGKILL ends it.
  for (const signal of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(signal, () => {});
  log({ linger: args[1] });
  setInterval(() => {}, 1000);
} else if (has('--version', '-v', '-V')) {
  console.log(name === 'codex' ? `codex-cli ${config.versions[name]}` : `${config.versions[name]} (Claude Code)`);
} else if (name === 'claude' && args[0] === 'auth') {
  console.log(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }));
} else if (name === 'codex' && args[0] === 'login') {
  console.log('Logged in using ChatGPT');
} else if (name === 'codex') {
  if (args.includes('exec')) await codexExec();
  else { console.error('fake codex: only `codex exec` is supported'); process.exit(2); }
} else if (has('-p', '--print')) {
  await claudePrint();
} else {
  await claudeInteractive();
}

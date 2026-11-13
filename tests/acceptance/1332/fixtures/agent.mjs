#!/usr/bin/env node
// The played agents of #1332's acceptance tests (README: What is real, what is played), installed by helpers.ts as
// `claude` and `codex` first on the test home's login PATH. They are the boundary this suite doesn't own: the agent and
// its model. They decide nothing about DeepBuild; each does what the agent does with what it is given, so the run is
// judged by its effects:
//
// - `--version` prints the newest version the shipped facts cover, as the agent prints it.
// - A session: argv as the agent reads it (flags skipped, the first plain word the prompt; `--model`, or Codex's `-m` or
//   `-c model=...`, names the model), the hooks of the agent's own config fired as its children with JSON on stdin
//   (Claude Code's `~/.claude/settings.json` merged with `--settings`; Codex's `$CODEX_HOME/hooks.json`), and one turn.
//   After the turn it waits, as the agent's terminal does, and fires SessionEnd (Claude Code) on SIGTERM or SIGHUP.
// - Which issue it works: the number in its worktree's branch (`deep/<n>-...`, #1330's name), else the first `#<n>` of
//   its prompt. What its turn does is the test's plan for that issue and launch (`__DIR__/plan.json`), standing for the
//   model: `work` (writes `src/i<n>.txt`, commits it, pushes its branch and opens a pull request that says
//   `Closes #<n>` with the session's own GH_TOKEN, then stops claiming done; a stop the gate holds is stopped again, up to
//   three times), `replaced` (stops with no tool call and nothing changed), `hang` (writes an uncommitted
//   `notes-<n>.txt`, then hangs inside a Bash call until it is killed), `gated` (waits for `__DIR__/go-<n>`, then
//   works), `taste` (asks a taste question through deep_ask on `deep mcp`, waits for the answer with deep_wait, then
//   works).
// - The model it reports: the flag's, else the plan's list for this agent on this issue, by how many times this agent
//   started on it.
//
// What it saw and did is written to __DIR__/log/<pid>.json after every step; every start is a line of
// __DIR__/launches.jsonl.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const AGENT = '__AGENT__';
const VERSION = '__VERSION__';
const DIR = '__DIR__';
const claude = AGENT === 'claude';
const argv = process.argv.slice(2);

if (argv.includes('--version') || argv.includes('-V') || (claude && argv.includes('-v'))) {
  process.stdout.write(claude ? `${VERSION} (Claude Code)\n` : `codex-cli ${VERSION}\n`);
  process.exit(0);
}

const plan = JSON.parse(readFileSync(join(DIR, 'plan.json'), 'utf8'));
const cwd = process.cwd();
const log = { pid: process.pid, ppid: process.ppid, agent: claude ? 'claude-code' : 'codex', argv, cwd, started: Date.now(), steps: [], done: false };
const save = () => {
  mkdirSync(join(DIR, 'log'), { recursive: true });
  writeFileSync(join(DIR, 'log', `${process.pid}.tmp`), JSON.stringify(log, null, 1));
  renameSync(join(DIR, 'log', `${process.pid}.tmp`), join(DIR, 'log', `${process.pid}.json`));
};
const step = (what, more = {}) => { log.steps.push({ what, at: Date.now(), ...more }); save(); };

// ---- argv.
const VALUE = new Set(claude
  ? ['--settings', '--permission-mode', '--model', '--setting-sources', '--mcp-config', '--append-system-prompt', '--system-prompt', '--add-dir', '--allowedTools',
    '--allowed-tools', '--disallowedTools', '--disallowed-tools', '--session-id', '--resume', '-r', '--output-format', '--input-format', '--fallback-model', '--agents',
    '--plugin-dir', '--max-turns', '--permission-prompt-tool', '--debug-file', '--name']
  : ['-c', '--config', '-s', '--sandbox', '-a', '--ask-for-approval', '-m', '--model', '-C', '--cd', '-p', '--profile', '-i', '--image', '--enable', '--disable']);
const flags = {};
let prompt;
const SUBCOMMANDS = claude ? ['mcp', 'config', 'auth', 'doctor', 'update', 'install', 'setup-token', 'plugin', 'migrate-installer'] : ['exec', 'e', 'login', 'logout', 'mcp', 'mcp-server', 'app-server', 'completion', 'sandbox', 'debug', 'apply', 'a', 'resume', 'cloud', 'features'];
const subcommand = SUBCOMMANDS.includes(argv[0] ?? '') ? argv[0] : undefined;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a.startsWith('--') && a.includes('=')) { const at = a.indexOf('='); (flags[a.slice(0, at)] ??= []).push(a.slice(at + 1)); continue; }
  if (VALUE.has(a)) { (flags[a] ??= []).push(argv[++i] ?? ''); continue; }
  if (a.startsWith('-')) { (flags[a] ??= []).push(true); continue; }
  if (prompt === undefined) prompt = a;
}
log.prompt = prompt ?? null;
if (subcommand || (claude && (flags['-p'] || flags['--print']))) {
  log.refused = subcommand ? `subcommand ${subcommand}` : 'print mode';
  log.done = true;
  save();
  process.stderr.write(`played ${AGENT}: ${log.refused} is not played here\n`);
  process.exit(1);
}

// ---- Which issue, which launch, what the turn does, which model.
const git = (...args) => { try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const issue = Number(/(?:^|\/)(\d+)(?:-|$)/.exec(branch)?.[1] ?? /#(\d+)\b/.exec(prompt ?? '')?.[1] ?? NaN);
log.branch = branch;
log.issue = Number.isSafeInteger(issue) ? issue : null;
const launchesFile = join(DIR, 'launches.jsonl');
const before = existsSync(launchesFile) ? readFileSync(launchesFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((l) => l.issue === log.issue) : [];
appendFileSync(launchesFile, `${JSON.stringify({ issue: log.issue, agent: log.agent, pid: process.pid, at: log.started })}\n`);
log.launch = before.length + 1;
const mine = plan.issues?.[String(log.issue)] ?? {};
const behaviors = mine.launches ?? ['work'];
log.behavior = behaviors[Math.min(before.length, behaviors.length - 1)];
const flagModel = claude ? flags['--model']?.at(-1) : flags['-m']?.at(-1) ?? flags['--model']?.at(-1)
  ?? (flags['-c'] ?? []).map((c) => /^model\s*=\s*"?([^"]+)"?$/.exec(String(c))?.[1]).filter(Boolean).at(-1);
const models = mine.models?.[log.agent] ?? [claude ? 'claude-haiku-5-5' : 'gpt-5.5-codex'];
const agentBefore = before.filter((l) => l.agent === log.agent).length;
log.model = typeof flagModel === 'string' && flagModel ? flagModel : models[Math.min(agentBefore, models.length - 1)];
// What the worktree held when this launch began: files no commit holds, and the notes an earlier launch left.
log.found = { status: git('status', '--porcelain', '--untracked-files=all'), notes: {} };
for (const f of existsSync(cwd) ? readdirSync(cwd) : []) if (/^notes-\d+\.txt$/.test(f)) log.found.notes[f] = readFileSync(join(cwd, f), 'utf8');
const session = randomUUID();
log.session = session;
save();

// ---- Hooks, from the agent's own config.
const readJson = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
const merge = (a, b) => {
  if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b)) out[k] = k in out ? merge(out[k], v) : v;
    return out;
  }
  return b;
};
const configDir = claude ? process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') : process.env.CODEX_HOME || join(homedir(), '.codex');
let settings = claude ? readJson(join(configDir, 'settings.json')) : readJson(join(configDir, 'hooks.json'));
if (claude) for (const s of flags['--settings'] ?? []) settings = merge(settings, String(s).trim().startsWith('{') ? (() => { try { return JSON.parse(String(s)); } catch { return {}; } })() : readJson(resolve(String(s))));
const mode = claude ? String((flags['--permission-mode'] ?? []).at(-1) ?? 'default') : 'default';
const turn = randomUUID();
const transcript = claude ? join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`) : null;
const env = { ...process.env, ...(claude ? { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli', CLAUDE_PROJECT_DIR: cwd } : { CODEX_THREAD_ID: session }) };
const said = (role, text) => {
  if (!transcript) return;
  mkdirSync(dirname(transcript), { recursive: true });
  appendFileSync(transcript, `${JSON.stringify({ type: role, message: { role, content: text }, uuid: randomUUID(), timestamp: new Date().toISOString(), cwd, sessionId: session, version: VERSION, userType: 'external', entrypoint: 'cli' })}\n`);
};
function sh(command, input, timeoutMs) {
  return new Promise((done) => {
    const child = spawn('/bin/sh', ['-c', command], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); done({ code: null, stdout, stderr: `${stderr}${e.message}` }); });
    child.on('close', (code) => { clearTimeout(timer); done({ code, stdout, stderr }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}
async function hook(event, fields = {}, tool) {
  const groups = Array.isArray(settings.hooks?.[event]) ? settings.hooks[event] : [];
  const base = { session_id: session, transcript_path: transcript, cwd, hook_event_name: event, permission_mode: mode };
  if (!claude) Object.assign(base, { model: log.model }, event === 'SessionStart' ? {} : { turn_id: turn });
  const results = [];
  for (const g of groups) {
    const m = typeof g?.matcher === 'string' ? g.matcher : '';
    if (tool && m && m !== '*' && !new RegExp(`^(?:${m})$`).test(tool)) continue;
    for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
      if (h?.type !== 'command' || typeof h.command !== 'string') continue;
      const r = await sh(h.command, JSON.stringify({ ...base, ...fields }), (Number(h.timeout) || 600) * 1000);
      results.push(r);
      step(`hook ${event}`, { code: r.code, stdout: r.stdout.slice(0, 2000), stderr: r.stderr.slice(0, 1000) });
    }
  }
  return results;
}
const held = (results) => results.some((r) => {
  if (r.code === 2) return true;
  try {
    const out = JSON.parse(r.stdout);
    const d = out?.hookSpecificOutput?.permissionDecision ?? out?.decision;
    return d === 'deny' || d === 'block' || d === 'ask';
  } catch { return false; }
});

/** One tool call, as the agent makes it: PreToolUse, the call unless it was denied, PostToolUse. */
async function tool(name, input, call) {
  const tool_use_id = claude ? `toolu_${randomBytes(10).toString('hex')}` : `call_${randomBytes(10).toString('hex')}`;
  const pre = await hook('PreToolUse', { tool_name: name, tool_input: input, tool_use_id }, name);
  if (held(pre)) { step(`denied ${name}`, { input }); return undefined; }
  const response = await call();
  await hook('PostToolUse', { tool_name: name, tool_input: input, tool_use_id, tool_response: response }, name);
  return response;
}
/** One Bash call: its exit code, or null when the call was denied. */
async function bash(command) {
  let code = null;
  await tool('Bash', claude ? { command, description: 'Run a command' } : { command }, async () => {
    const r = await sh(command, '', 120_000);
    code = r.code;
    step('bash', { command, code: r.code, stdout: r.stdout.slice(-2000), stderr: r.stderr.slice(-2000) });
    return claude ? { stdout: r.stdout, stderr: r.stderr, interrupted: false, isImage: false } : { output: `${r.stdout}${r.stderr}`, exit_code: r.code };
  });
  return code;
}
async function writeFile(path, content) {
  // Codex writes through its shell; every content here is one line.
  if (!claude) { const r = await bash(`printf '%s\\n' ${q(content.replace(/\n$/, ''))} > ${q(path)}`); step('wrote', { path, content }); return r; }
  return tool('Write', { file_path: join(cwd, path), content }, async () => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), content);
    step('wrote', { path, content });
    return { type: 'create', filePath: join(cwd, path), content };
  });
}

// ---- What a turn does.
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
async function stop(message) {
  said('assistant', message);
  for (let round = 1; round <= 3; round++) {
    log.stopAt = Date.now();
    step('stop', { round, message });
    const r = await hook('Stop', { stop_hook_active: round > 1, last_assistant_message: message });
    if (!held(r)) return;
    step('held at stop', { round });
  }
}
async function work() {
  const n = log.issue;
  await writeFile(`src/i${n}.txt`, `done ${n}\n`);
  log.worked = Date.now();
  step('worked');
  await bash(`git add src/i${n}.txt && git -c user.name=agent -c user.email=agent@example.invalid -c commit.gpgsign=false commit -q -m ${q(`Do #${n}`)}`);
  const token = process.env.GH_TOKEN ?? '';
  const head = git('rev-parse', '--abbrev-ref', 'HEAD');
  // The branch goes to the forge with the session's own credential; a push denied or failed leaves no pull request to open.
  const pushed = token && head && head !== 'HEAD' ? await bash(`git -c credential.helper= -c "http.extraHeader=Authorization: Bearer $GH_TOKEN" push -q origin ${q(`HEAD:refs/heads/${head}`)}`) : null;
  if (pushed === 0) {
    // An open pull request of this branch already says what it closes.
    let open = [];
    try { open = await (await fetch(`${plan.api}/repos/${plan.repo}/pulls?state=open&per_page=100`, { headers: { authorization: `Bearer ${token}` } })).json(); } catch { /* none read */ }
    if (!Array.isArray(open) || !open.some((p) => p?.head?.ref === head)) {
      const pr = JSON.stringify({ title: `Do #${n}`, head, base: 'main', body: `Closes #${n}` });
      await bash(`curl -sS -f -X POST -H "Authorization: Bearer $GH_TOKEN" -H 'Accept: application/vnd.github+json' -d ${q(pr)} ${q(`${plan.api}/repos/${plan.repo}/pulls`)}`);
    }
  } else step('no pull request', { why: !token ? 'the session holds no GH_TOKEN' : pushed === null ? 'the push was denied' : `the push failed (${pushed})` });
  await stop(`Done: #${n} is fixed on ${head}, and its pull request is open.`);
}
/** The MCP servers this agent started: they end with it. */
const servers = new Set();
/** `deep mcp` as the agent's MCP server, its child on stdio; started again if it ended. */
async function mcp() {
  let server;
  let id = 0;
  const waiting = new Map();
  const open = async () => {
    server = spawn(plan.node, [plan.cli, 'mcp'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
    servers.add(server);
    server.stdin.on('error', () => undefined);
    server.on('exit', () => { for (const done of waiting.values()) done({}); waiting.clear(); server = undefined; });
    createInterface({ input: server.stdout }).on('line', (raw) => {
      let line;
      try { line = JSON.parse(raw); } catch { return; }
      if (line.id !== undefined && waiting.has(line.id)) { waiting.get(line.id)(line); waiting.delete(line.id); }
    });
    await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: claude ? 'claude-code' : 'codex-mcp-client', version: VERSION } });
    server?.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  };
  const call = (method, params) => new Promise((done) => {
    if (!server) return done({});
    const n = ++id;
    waiting.set(n, done);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });
  await open();
  return {
    tool: async (name, args) => { if (!server) await open(); return (await call('tools/call', { name, arguments: args })).result; },
    close: () => server?.kill('SIGTERM'),
  };
}
async function taste() {
  const deep = await mcp();
  const name = claude ? 'mcp__deep__deep_ask' : 'deep_ask';
  const args = {
    kind: 'taste', question: 'Which label reads better on the pay button?', options: [{ id: 'pay', label: 'Pay' }, { id: 'buy', label: 'Buy now' }], recommended: 'pay',
    steps: null, where: null, why: null, check: null, thread: null, subject: { point: null, screen: 'checkout', element: 'pay-button' },
  };
  let reply = await tool(name, args, async () => { const r = await deep.tool('deep_ask', args); step('asked', { reply: r?.structuredContent ?? r }); return r; });
  let got = reply?.structuredContent;
  if (typeof got?.ask !== 'string') {
    // No ask was raised: the turn can't go on without the answer.
    deep.close();
    step('not asked', { reply: reply ?? null });
    return stop('I could not ask which label to use, so I changed nothing.');
  }
  while (got.status === 'waiting') {
    reply = await tool(claude ? 'mcp__deep__deep_wait' : 'deep_wait', { ask: got.ask }, async () => { const r = await deep.tool('deep_wait', { ask: got.ask }); step('waited', { reply: r?.structuredContent ?? r }); return r; });
    // A wait that answered nothing (a refusal, a hub restarting) is waited again.
    if (typeof reply?.structuredContent?.status === 'string') got = reply.structuredContent;
    else await new Promise((r) => setTimeout(r, 2000));
  }
  log.answered = Date.now();
  step('answered', { reply: got ?? reply ?? null });
  deep.close();
  await work();
}

// ---- The session.
setInterval(() => undefined, 60_000);
let ending = false;
async function end(signal) {
  if (ending) return;
  ending = true;
  log.signal = signal;
  log.ended = Date.now();
  save();
  for (const s of servers) s.kill('SIGTERM');
  if (claude) await Promise.race([hook('SessionEnd', { reason: 'other' }), new Promise((r) => setTimeout(r, 5000))]);
  save();
  process.exit(0);
}
for (const s of ['SIGTERM', 'SIGHUP', 'SIGINT']) process.on(s, () => void end(s));
process.stdin.on('data', () => undefined);
process.stdin.on('error', () => undefined);

said('user', prompt ?? '');
await hook('SessionStart', claude ? { source: 'startup', model: log.model } : { source: 'startup' });
await hook('UserPromptSubmit', { prompt: prompt ?? '' });
step('turn', { behavior: log.behavior });
if (log.behavior === 'replaced') await stop('I found nothing to change.');
else if (log.behavior === 'hang') {
  const notes = `notes for #${log.issue}: ${randomBytes(8).toString('hex')}\n`;
  await writeFile(`notes-${log.issue}.txt`, notes);
  log.notes = notes;
  // A Bash call that never returns: the turn is in the middle of it until the process is killed.
  await hook('PreToolUse', { tool_name: 'Bash', tool_input: claude ? { command: 'npm test', description: 'Run the tests' } : { command: 'npm test' }, tool_use_id: `toolu_${randomBytes(10).toString('hex')}` }, 'Bash');
  log.hanging = Date.now();
  step('hanging');
  await new Promise(() => undefined);
} else if (log.behavior === 'gated') {
  while (!existsSync(join(DIR, `go-${log.issue}`))) await new Promise((r) => setTimeout(r, 200));
  step('go');
  await work();
} else if (log.behavior === 'taste') await taste();
else await work();
log.done = true;
save();

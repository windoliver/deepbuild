// A stand-in for the real Claude Code CLI (a boundary this repo doesn't own) for the #1108 acceptance tests. The test
// copies it beside `scenario.json` and an interpreter into a folder on the agent's PATH, behind a `claude` wrapper. It
// does what Claude Code does with what it is handed, so a launcher is judged by what an agent could reach:
//
// - its config home is $CLAUDE_CONFIG_DIR, else $HOME/.claude; its global config is $CLAUDE_CONFIG_DIR/.claude.json,
//   else $HOME/.claude.json; its sign-in is ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN or the config home's
//   .credentials.json, and it talks to its model at $ANTHROPIC_BASE_URL (unset: it refuses, never calling a real API);
// - settings: --setting-sources (user, project, local by default) and every --settings; their `env`, permission rules,
//   `defaultMode` and PreToolUse/PostToolUse command hooks (deny, allow, exit 2, updatedInput), as Claude Code reads them;
// - MCP servers: every --mcp-config, plus (without --strict-mcp-config) the global config's user and local servers and,
//   when settings enable them, the folder's .mcp.json; stdio and streamable-HTTP servers, `${VAR}` expanded;
// - in print mode a tool runs only if a hook allows it, a rule allows it or the mode bypasses permissions;
// - Bash runs `bash -c` in its folder with its environment; an MCP tool is called on its server.
//
// The calls it makes come from scenario.json, by the task's words; the variant is told by the CLAUDE.md in its folder.
// It sends everything it saw to its model endpoint as a model request would carry it, which is how the test reads it.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';

const SCENARIO = JSON.parse(readFileSync(new URL('./scenario.json', import.meta.url), 'utf8'));
const argv = process.argv.slice(2);
const cwd = process.cwd();
const env = { ...process.env };
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const say = (line) => { process.stdout.write(`${JSON.stringify(line)}\n`); transcript(line); };
const finish = (ok, text) => {
  process.stdout.write(`${JSON.stringify(ok
    ? { type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 100, output_tokens: 20 } }
    : { type: 'result', subtype: 'error_during_execution', is_error: true, result: text })}\n`);
  process.exit(ok ? 0 : 1);
};

// ---- Flags, as Claude Code takes them.
const flags = { mcp: [], strict: false, sources: null, settings: [], mode: null, allowed: [], disallowed: [], model: 'claude' };
const many = (i) => { const out = []; while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out.push(argv[++i]); return [out, i]; };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--mcp-config') { let v; [v, i] = many(i); flags.mcp.push(...v); }
  else if (a.startsWith('--mcp-config=')) flags.mcp.push(a.slice('--mcp-config='.length));
  else if (a === '--strict-mcp-config') flags.strict = true;
  else if (a === '--setting-sources') flags.sources = String(argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--settings') flags.settings.push(argv[++i]);
  else if (a === '--permission-mode') flags.mode = argv[++i];
  else if (a === '--dangerously-skip-permissions') flags.mode = 'bypassPermissions';
  else if (a === '--model') flags.model = argv[++i];
  else if (a === '--allowedTools' || a === '--allowed-tools') { let v; [v, i] = many(i); flags.allowed.push(...v.flatMap((s) => s.split(/[\s,]+/)).filter(Boolean)); }
  else if (a === '--disallowedTools' || a === '--disallowed-tools') { let v; [v, i] = many(i); flags.disallowed.push(...v.flatMap((s) => s.split(/[\s,]+/)).filter(Boolean)); }
}
const prompt = readFileSync(0, 'utf8').trim();
const script = SCENARIO.scripts[prompt];
// Anything but a scripted task (the launcher's plan-window probe) is answered at once and observes nothing.
if (!script) finish(true, 'ok');

const configDir = env.CLAUDE_CONFIG_DIR || join(env.HOME || '/nonexistent', '.claude');
const globalFile = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(env.HOME || '/nonexistent', '.claude.json');
const session = randomBytes(8).toString('hex');
const transcriptPath = join(configDir, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${session}.jsonl`);
function transcript(line) {
  try { mkdirSync(dirname(transcriptPath), { recursive: true }); appendFileSync(transcriptPath, `${JSON.stringify(line)}\n`); } catch { /* unwritable: the run goes on */ }
}
const readJson = (path) => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };
const jsonish = (v) => (String(v).trim().startsWith('{') ? JSON.parse(v) : JSON.parse(readFileSync(v, 'utf8')));

// ---- Settings.
const loaded = [];
for (const source of flags.sources ?? ['user', 'project', 'local']) {
  const path = source === 'user' ? join(configDir, 'settings.json') : source === 'project' ? join(cwd, '.claude', 'settings.json') : source === 'local' ? join(cwd, '.claude', 'settings.local.json') : undefined;
  const json = path && readJson(path);
  if (isObj(json)) loaded.push({ source, path, json });
}
for (const v of flags.settings) {
  try { loaded.push({ source: 'flag', path: String(v).trim().startsWith('{') ? null : v, json: jsonish(v) }); } catch { finish(false, `Error: invalid --settings ${v}`); }
}
const allow = [...flags.allowed];
const deny = [...flags.disallowed];
const hooks = { PreToolUse: [], PostToolUse: [] };
let defaultMode = null;
let disableHooks = false;
let projectServers = false;
for (const { json } of loaded) {
  if (isObj(json.env)) Object.assign(env, json.env);
  if (isObj(json.permissions)) {
    if (Array.isArray(json.permissions.allow)) allow.push(...json.permissions.allow);
    if (Array.isArray(json.permissions.deny)) deny.push(...json.permissions.deny);
    if (typeof json.permissions.defaultMode === 'string') defaultMode = json.permissions.defaultMode;
  }
  if (isObj(json.hooks)) for (const ev of Object.keys(hooks)) if (Array.isArray(json.hooks[ev])) hooks[ev].push(...json.hooks[ev]);
  if (json.disableAllHooks === true) disableHooks = true;
  if (json.enableAllProjectMcpServers === true) projectServers = true;
}
const mode = flags.mode ?? defaultMode ?? 'default';

// ---- MCP servers.
const expand = (v) => (typeof v === 'string' ? v.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_, k, d) => env[k] ?? d ?? '')
  : Array.isArray(v) ? v.map(expand) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(x)])) : v);
const servers = {};
if (!flags.strict) {
  const global = readJson(globalFile);
  if (isObj(global?.mcpServers)) Object.assign(servers, global.mcpServers);
  const project = projectServers ? readJson(join(cwd, '.mcp.json')) : undefined;
  if (isObj(project?.mcpServers)) Object.assign(servers, project.mcpServers);
  const local = isObj(global?.projects) && isObj(global.projects[cwd]) ? global.projects[cwd].mcpServers : undefined;
  if (isObj(local)) Object.assign(servers, local);
}
for (const v of flags.mcp) {
  let json;
  try { json = jsonish(v); } catch { finish(false, `Error: invalid MCP configuration ${v}`); }
  if (isObj(json?.mcpServers)) Object.assign(servers, json.mcpServers);
}
for (const k of Object.keys(servers)) servers[k] = expand(servers[k]);

// ---- The sign-in and the model endpoint.
const creds = readJson(join(configDir, '.credentials.json'));
const signIn = env.ANTHROPIC_API_KEY ? { 'x-api-key': env.ANTHROPIC_API_KEY }
  : env.CLAUDE_CODE_OAUTH_TOKEN ? { authorization: `Bearer ${env.CLAUDE_CODE_OAUTH_TOKEN}` }
  : typeof creds?.claudeAiOauth?.accessToken === 'string' ? { authorization: `Bearer ${creds.claudeAiOauth.accessToken}` } : undefined;
if (!signIn) finish(false, 'Not logged in · Please run /login');
if (!env.ANTHROPIC_BASE_URL) finish(false, 'no model endpoint: ANTHROPIC_BASE_URL is unset, and this stand-in never calls a real API');

// ---- Tools.
function ruleMatches(rule, tool, input) {
  if (rule === tool) return true;
  if (/^mcp__[^_]+(?:__\*)?$/.test(rule)) return tool.startsWith(`${rule.replace(/__\*$/, '')}__`);
  const m = /^Bash\((.*)\)$/s.exec(rule);
  if (!m || tool !== 'Bash') return false;
  const command = String(input?.command ?? '');
  const spec = m[1];
  if (spec.endsWith(':*')) return command.startsWith(spec.slice(0, -2));
  if (spec.endsWith('*')) return command.startsWith(spec.slice(0, -1));
  return command === spec;
}
const permitted = (tool, input) => (deny.some((r) => ruleMatches(r, tool, input)) ? false
  : mode === 'bypassPermissions' || allow.some((r) => ruleMatches(r, tool, input)));
const hookMatches = (matcher, tool) => !matcher || matcher === '*' || new RegExp(`^(?:${matcher})$`).test(tool);

function runHooks(event, payload) {
  const said = { decision: undefined, reason: '', updatedInput: undefined };
  if (disableHooks) return said;
  for (const group of hooks[event]) {
    if (!isObj(group) || !hookMatches(group.matcher, payload.tool_name) || !Array.isArray(group.hooks)) continue;
    for (const h of group.hooks) {
      if (!isObj(h) || h.type !== 'command' || typeof h.command !== 'string') continue;
      const r = spawnSync('/bin/sh', ['-c', h.command], {
        cwd, env: { ...env, CLAUDE_PROJECT_DIR: cwd }, input: JSON.stringify({ ...payload, tool_input: said.updatedInput ?? payload.tool_input }),
        encoding: 'utf8', timeout: (Number(h.timeout) || 60) * 1000,
      });
      if (event !== 'PreToolUse') continue;
      if (r.status === 2) return { decision: 'deny', reason: (r.stderr || '').trim(), updatedInput: said.updatedInput };
      if (r.status !== 0) continue;
      let out;
      try { out = JSON.parse(r.stdout); } catch { continue; }
      const hso = isObj(out?.hookSpecificOutput) ? out.hookSpecificOutput : {};
      const decision = hso.permissionDecision ?? (out?.decision === 'block' ? 'deny' : out?.decision === 'approve' ? 'allow' : undefined);
      const reason = hso.permissionDecisionReason ?? out?.reason ?? '';
      if (isObj(hso.updatedInput)) said.updatedInput = hso.updatedInput;
      if (decision === 'deny') return { decision, reason: String(reason), updatedInput: said.updatedInput };
      if (decision === 'allow') { said.decision = 'allow'; said.reason = String(reason); }
    }
  }
  return said;
}

const clients = new Map();
function stdioClient(cfg) {
  let dead;
  const child = spawn(cfg.command, Array.isArray(cfg.args) ? cfg.args : [], { cwd, env: { ...env, ...(isObj(cfg.env) ? cfg.env : {}) }, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  let buf = '';
  let id = 0;
  const failAll = (message) => { dead = message; for (const r of pending.values()) r({ error: { code: -1, message } }); pending.clear(); };
  child.on('error', (e) => failAll(e.message));
  child.on('exit', () => failAll('the server exited'));
  child.stdin.on('error', () => { /* answered by exit */ });
  child.stdout.on('data', (d) => {
    buf += d;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      if (m && m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    }
  });
  return {
    request: (method, params) => new Promise((res) => {
      if (dead) { res({ error: { code: -1, message: dead } }); return; }
      const n = ++id;
      pending.set(n, res);
      setTimeout(() => { if (pending.delete(n)) res({ error: { code: -1, message: 'timed out' } }); }, 20_000).unref();
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    }),
    notify: async (method, params) => { if (!dead) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`); },
    close: () => { try { child.kill(); } catch { /* gone */ } },
  };
}
function httpClient(cfg) {
  let sessionId;
  let id = 0;
  const post = async (body) => {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(isObj(cfg.headers) ? cfg.headers : {}) };
    if (sessionId) headers['mcp-session-id'] = sessionId;
    const r = await fetch(cfg.url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
    sessionId = r.headers.get('mcp-session-id') ?? sessionId;
    const text = await r.text();
    if (body.id === undefined) return undefined;
    if ((r.headers.get('content-type') ?? '').includes('text/event-stream')) {
      for (const line of text.split('\n')) if (line.startsWith('data:')) { try { const m = JSON.parse(line.slice(5)); if (m.id === body.id) return m; } catch { /* next */ } }
      return { error: { code: -1, message: 'no response in the event stream' } };
    }
    try { return JSON.parse(text); } catch { return { error: { code: r.status, message: `HTTP ${r.status} ${text.slice(0, 200)}` } }; }
  };
  const safe = async (body) => { try { return await post(body); } catch (e) { return { error: { code: -1, message: String(e?.cause?.code ?? e?.message ?? e) } }; } };
  return { request: (method, params) => safe({ jsonrpc: '2.0', id: ++id, method, params }), notify: (method, params) => safe({ jsonrpc: '2.0', method, params }), close() {} };
}
async function connect(name) {
  if (clients.has(name)) return clients.get(name);
  const cfg = servers[name];
  const client = cfg.type === 'http' || (typeof cfg.url === 'string' && cfg.type !== 'stdio') ? httpClient(cfg) : stdioClient(cfg);
  const init = await client.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude-code', version: '0.0.0-stand-in' } });
  let tools = [];
  let error;
  if (init?.error) error = `MCP server "${name}" failed to start: ${init.error.message}`;
  else {
    await client.notify('notifications/initialized', {});
    const list = await client.request('tools/list', {});
    tools = Array.isArray(list?.result?.tools) ? list.result.tools.map((t) => t.name) : [];
  }
  const c = { client, tools, error };
  clients.set(name, c);
  return c;
}

async function execute(tool, input) {
  if (tool === 'Bash') {
    const r = spawnSync('/bin/bash', ['-c', String(input?.command ?? '')], { cwd, env, encoding: 'utf8', timeout: 120_000 });
    return { content: `${r.stdout ?? ''}${r.stderr ?? ''}`.trimEnd(), is_error: r.status !== 0 };
  }
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(tool);
  if (!m || !servers[m[1]]) return { content: `Error: No such tool available: ${tool}`, is_error: true };
  const c = await connect(m[1]);
  if (c.error) return { content: c.error, is_error: true };
  if (!c.tools.includes(m[2])) return { content: `Error: No such tool available: ${tool}`, is_error: true };
  const r = await c.client.request('tools/call', { name: m[2], arguments: input });
  if (r?.error) return { content: `MCP error ${r.error.code}: ${r.error.message}`, is_error: true };
  const content = Array.isArray(r?.result?.content) ? r.result.content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n') : '';
  return { content, is_error: r?.result?.isError === true };
}

let n = 0;
async function callTool(tool, input) {
  const id = `toolu_${String(++n).padStart(2, '0')}${randomBytes(4).toString('hex')}`;
  say({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'tool_use', id, name: tool, input }] } });
  const base = { session_id: session, transcript_path: transcriptPath, cwd, permission_mode: mode, tool_name: tool, tool_use_id: id };
  const pre = runHooks('PreToolUse', { ...base, hook_event_name: 'PreToolUse', tool_input: input });
  const ran = pre.updatedInput ?? input;
  const result = pre.decision === 'deny' ? { content: pre.reason, is_error: true }
    : pre.decision !== 'allow' && !permitted(tool, ran) ? { content: `Claude requested permissions to use ${tool}, but you haven't granted it yet.`, is_error: true }
    : await execute(tool, ran);
  runHooks('PostToolUse', { ...base, hook_event_name: 'PostToolUse', tool_input: ran, tool_response: result });
  say({ type: 'user', session_id: session, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result.content, is_error: result.is_error }] } });
  return { tool, input, ran, content: result.content, is_error: result.is_error };
}

// ---- What it can reach: files by path, everything under its homes, and hosts.
function walk(root, list, depth = 0) {
  if (list.length > 400 || depth > 6) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch (e) { list.push({ path: root, error: e.code }); return; }
  for (const e of entries) {
    const p = join(root, e.name);
    let dir = e.isDirectory();
    let file = e.isFile();
    if (e.isSymbolicLink()) { try { const st = statSync(p); dir = false; file = st.isFile(); } catch { continue; } }
    if (dir) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p, list, depth + 1); }
    else if (file) { try { list.push({ path: p, text: statSync(p).size > 262_144 ? null : readFileSync(p, 'utf8') }); } catch (err) { list.push({ path: p, error: err.code }); } }
  }
}
const tryRead = (path) => { try { lstatSync(path); return { path, ok: true, text: readFileSync(path, 'utf8') }; } catch (e) { return { path, ok: false, error: e.code }; } };
const PROBE = `const s=require('net').connect({host:process.argv[1],port:+process.argv[2]});const t=setTimeout(()=>{console.log('TIMEOUT');process.exit(0)},+process.argv[3]);s.on('connect',()=>{console.log('CONNECTED');process.exit(0)});s.on('error',e=>{console.log(e.code||e.message);process.exit(0)});`;
function probe(host, port, ms) {
  return new Promise((res) => {
    const s = net.connect({ host, port });
    const t = setTimeout(() => { s.destroy(); res({ from: 'agent', target: `${host}:${port}`, ok: false, errno: 'TIMEOUT' }); }, ms);
    s.on('connect', () => { clearTimeout(t); s.destroy(); res({ from: 'agent', target: `${host}:${port}`, ok: true }); });
    s.on('error', (e) => { clearTimeout(t); res({ from: 'agent', target: `${host}:${port}`, ok: false, errno: e.code }); });
  });
}
function childProbe(host, port, ms) {
  return new Promise((res) => {
    let out = '';
    const c = spawn(process.execPath, ['-e', PROBE, host, String(port), String(ms)], { env, stdio: ['ignore', 'pipe', 'ignore'] });
    c.stdout.on('data', (d) => { out += d; });
    c.on('error', (e) => res({ from: 'child', target: `${host}:${port}`, ok: false, errno: `SPAWN ${e.code}` }));
    c.on('close', () => { const w = out.trim(); res({ from: 'child', target: `${host}:${port}`, ok: w === 'CONNECTED', errno: w === 'CONNECTED' ? undefined : w }); });
  });
}

const fill = (v) => (typeof v === 'string' ? v.replace(/\{\{now\}\}/g, () => new Date().toISOString()).replace(/\{\{tmp\}\}/g, () => `/tmp/build-${randomBytes(3).toString('hex')}`)
  : Array.isArray(v) ? v.map(fill) : isObj(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)])) : v);

const claudeMd = existsSync(join(cwd, 'CLAUDE.md')) ? readFileSync(join(cwd, 'CLAUDE.md'), 'utf8') : '';
const observation = { prompt, cwd, claudeMd, argv, env, configDir, globalFile, mode, settings: loaded, servers, calls: [], reads: [], home: [], net: [] };
try {
  say({ type: 'system', subtype: 'init', session_id: session, cwd, tools: ['Bash', ...Object.keys(servers).map((s) => `mcp__${s}__*`)], mcp_servers: Object.keys(servers).map((name) => ({ name })) });
  for (const step of script.steps) {
    if (step.when && !claudeMd.includes(step.when)) continue;
    observation.calls.push(await callTool(step.tool, fill(step.input)));
  }
  observation.reads = (SCENARIO.userFiles ?? []).map(tryRead);
  const homes = [...new Set([env.HOME, configDir].filter(Boolean))];
  for (const h of homes) walk(h, observation.home);
  if (SCENARIO.probes) observation.net = await Promise.all(SCENARIO.probes.flatMap((p) => [probe(p.host, p.port, p.ms), childProbe(p.host, p.port, p.ms)]));
} catch (e) {
  observation.crash = String(e?.stack ?? e);
} finally {
  for (const c of clients.values()) c.client.close();
}

// The model sees every tool result; this request carries what the agent saw.
let reply;
try {
  reply = await fetch(`${env.ANTHROPIC_BASE_URL.replace(/\/$/, '')}/v1/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01', ...signIn },
    body: JSON.stringify({ model: flags.model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }], metadata: { observation } }), signal: AbortSignal.timeout(20_000),
  });
} catch (e) {
  finish(false, `API Error: Connection error (${e?.cause?.code ?? e?.message ?? e})`);
}
if (reply.status === 401) finish(false, 'Invalid API key · Please run /login');
if (!reply.ok) finish(false, `API Error: ${reply.status}`);
finish(true, 'Done.');

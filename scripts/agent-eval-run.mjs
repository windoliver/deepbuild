// One real agent session for the manual evaluation (#26), recorded as the scorer reads it. Never in CI: it starts a
// real Claude Code or Codex session on your own sign-in and spends plan usage.
//   node scripts/agent-eval.mjs run --agent claude|codex [--out <dir>] [--model <name>] [--no-skill | --skill <file>]
// The session works on the red-unit fixture, a repo whose unit check fails, with DeepBuild's hooks, its deep mcp and
// the skill installed for it, against a hub of its own: the hub keeps your login home, so it sees the session's
// transcript where the agent writes it, and its root is a temp folder, as are deep-hook's and deep mcp's home, so
// your ~/.deepbuild is never touched. The run lands in <out>/run.json with the scorer's verdict beside it.
// --no-skill leaves the skill out, and --skill installs another file in its place, such as a stale skill: planted runs
// the scorer must fail. It stops only what it started, by PID.
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const CLI = join(ROOT, 'packages/cli/dist/main.js');
const SKILL = join(ROOT, 'skills/deepbuild/SKILL.md');
// A session starts with an allowlisted environment, so the variables that mark this nested session never reach it.
const ALLOWED = ['HOME', 'USER', 'LOGNAME', 'SHELL', 'PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME'];
const quote = (arg) => `'${String(arg).replaceAll("'", `'\\''`)}'`;
const parse = (text) => text.split('\n').flatMap((line) => { try { const v = JSON.parse(line); return v && typeof v === 'object' ? [v] : []; } catch { return []; } });

/** The task: the person's words, with the claim ids the manifest closes over and never a value it expects. */
const TASK = 'task:01K74FX2B4D6F8H0K2M4P6R8T0';
const PROMPT = `The unit check in this repo fails. Fix the code, then claim ${TASK} done (attempt 1, scope session, at the commit HEAD has now) and prove it with DeepBuild's tools, following the deepbuild skill. This session is scripted: nobody will answer a question. Finish your reply with one line of JSON and nothing after it: {"claims":[{"id":"unit-outcome","value":"<the outcome DeepBuild reported for your last unit run>","evidence":"<that run's handle>"}]}`;
const MANIFEST = { first_tool: 'deep_status', claims: [{ id: 'unit-outcome', expected: 'passed' }] };

/** The red-unit fixture: sum subtracts, so its three tests fail until it adds. */
function fixture(work) {
  mkdirSync(join(work, '.deepbuild'), { recursive: true });
  writeFileSync(join(work, 'sum.mjs'), 'export const sum = (a, b) => a - b;\n');
  writeFileSync(join(work, 'test.mjs'), [
    "import { sum } from './sum.mjs';",
    'const cases = [[1, 2, 3], [0, 0, 0], [-4, 6, 2]];',
    'const failed = cases.filter(([a, b, want]) => sum(a, b) !== want);',
    'console.log(`${cases.length - failed.length} of ${cases.length} tests ok`);',
    'process.exit(failed.length ? 1 : 0);',
    '',
  ].join('\n'));
  writeFileSync(join(work, '.deepbuild', 'done.yaml'), `checks:\n  unit: { type: command, run: "${process.execPath} test.mjs" }\n`);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=eval', '-c', 'user.email=eval@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd: work });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'red-unit');
}

/** A JSON-RPC client on a deep mcp started by hand, for the live tool list the session's deep mcp served too. */
async function liveTools(env, cwd) {
  const child = spawn(process.execPath, [CLI, 'mcp'], { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: child.stdout });
  const replies = [];
  lines.on('line', (raw) => replies.push(JSON.parse(raw)));
  const ask = async (id, method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    for (let i = 0; i < 100 && !replies.some((r) => r.id === id); i++) await new Promise((wake) => setTimeout(wake, 50));
    return replies.find((r) => r.id === id);
  };
  await ask(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'agent-eval', version: '0' } });
  const tools = (await ask(2, 'tools/list', {}))?.result?.tools ?? [];
  child.stdin.end();
  return tools;
}

/** The hooks each agent's facts list for its newest version, each running deep-hook straight from the agent. */
function hookEvents(agent) {
  const facts = JSON.parse(readFileSync(join(ROOT, `adapters/${agent === 'claude' ? 'claude-code' : 'codex'}.facts.json`), 'utf8'));
  return [...new Set(Object.values(facts.events?.versions ?? {}).flatMap((events) => Object.keys(events)))];
}

/** Claude Code: headless, its settings carrying the hooks and its MCP config the deep server, the skill in the repo. */
function claudeArgs(o) {
  const hooks = Object.fromEntries(hookEvents('claude').map((event) => [event, [{ hooks: [{ type: 'command', command: `HOME=${quote(o.home)} exec ${quote(o.hook)} claude-code ${event}` }] }]]));
  writeFileSync(join(o.dir, 'settings.json'), JSON.stringify({ hooks }, null, 2));
  writeFileSync(join(o.dir, 'mcp.json'), JSON.stringify({ mcpServers: { deep: { command: process.execPath, args: [CLI, 'mcp'], env: { HOME: o.home } } } }, null, 2));
  return [
    '-p', '--output-format', 'stream-json', '--verbose', '--model', o.model ?? 'haiku', '--setting-sources', 'project', '--strict-mcp-config',
    '--mcp-config', join(o.dir, 'mcp.json'), '--settings', join(o.dir, 'settings.json'), '--permission-mode', 'acceptEdits',
    '--allowedTools', 'mcp__deep__deep_ask,mcp__deep__deep_wait,mcp__deep__deep_open_item,mcp__deep__deep_status,mcp__deep__deep_search,mcp__deep__deep_claim,mcp__deep__deep_evidence,mcp__deep__deep_run,mcp__deep__deep_propose,Read,Edit,Write,Skill,Bash(git:*),Bash(node:*)',
  ];
}

/** Codex: exec, none of your config, hooks and the deep server as overrides, the skill in the repo. */
function codexArgs(o) {
  const hooks = hookEvents('codex').flatMap((event) => ['-c', `hooks.${event}=[{hooks=[{type="command",command=${JSON.stringify(`HOME=${quote(o.home)} exec ${quote(o.hook)} codex ${event}`)}}]}]`]);
  return [
    'exec', '--json', '--skip-git-repo-check', '--ignore-user-config', '-m', o.model ?? 'gpt-reserve', '-c', 'model_reasoning_effort="low"', '-s', 'workspace-write',
    '-c', `projects.${JSON.stringify(o.work)}.trust_level="trusted"`, ...hooks, '--dangerously-bypass-hook-trust',
    '-c', `mcp_servers.deep.command=${JSON.stringify(process.execPath)}`, '-c', `mcp_servers.deep.args=${JSON.stringify([CLI, 'mcp'])}`, '-c', `mcp_servers.deep.env={HOME=${JSON.stringify(o.home)}}`,
    '-c', 'mcp_servers.deep.tool_timeout_sec=120', '-c', 'mcp_servers.deep.default_tools_approval_mode="approve"', '-',
  ];
}

/**
 * Codex writes a folder's trust into your config the first time it runs there, whatever the overrides say. The
 * fixture's folder is gone after the run, so the entry for it, and nothing else, comes out again.
 */
function forgetTrust(work) {
  const config = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
  if (!existsSync(config)) return;
  const text = readFileSync(config, 'utf8');
  const entry = `[projects.${JSON.stringify(work)}]\ntrust_level = "trusted"\n`;
  const at = text.indexOf(entry);
  if (at < 0) return;
  const before = text.slice(0, at).replace(/\n$/, '');
  writeFileSync(config, before + (before.endsWith('\n') ? '' : '\n') + text.slice(at + entry.length));
}

/** Each deep_* call in order with its arguments and the result MCP returned, from the agent's own event stream. */
function callsOf(agent, events) {
  if (agent === 'claude') {
    const results = new Map(events.filter((e) => e.type === 'user').flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content : []))
      .filter((c) => c.type === 'tool_result').map((c) => [c.tool_use_id, { isError: c.is_error === true, content: Array.isArray(c.content) ? c.content : [{ type: 'text', text: String(c.content ?? '') }] }]));
    return events.filter((e) => e.type === 'assistant').flatMap((e) => e.message?.content ?? [])
      .filter((c) => c.type === 'tool_use' && /^mcp__deep__deep_/.test(c.name))
      .map((c) => ({ tool: c.name.slice('mcp__deep__'.length), arguments: c.input ?? {}, result: results.get(c.id) ?? null }));
  }
  return events.filter((e) => e.type === 'item.completed' && e.item?.type === 'mcp_tool_call' && e.item.server === 'deep')
    .map(({ item }) => ({ tool: item.tool, arguments: item.arguments ?? {}, result: item.error ? { isError: true, content: [{ type: 'text', text: JSON.stringify(item.error) }] } : item.result ?? null }));
}

/** The agent's last words, and the claims JSON line they end with. */
function answerOf(agent, events) {
  const text = agent === 'claude'
    ? String(events.filter((e) => e.type === 'result').at(-1)?.result ?? '')
    : String(events.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message').at(-1)?.item?.text ?? '');
  const line = text.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
  try { const parsed = JSON.parse(line ?? ''); return { text, claims: Array.isArray(parsed.claims) ? parsed.claims : [] }; } catch { return { text, claims: [] }; }
}

/** The session's own transcript (Claude Code) or rollout (Codex), where the skill's text shows if it reached the model. */
function transcriptOf(agent, events, work) {
  if (agent === 'claude') {
    const id = events.find((e) => e.session_id)?.session_id;
    const file = id && join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects', work.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
    return file && existsSync(file) ? file : null;
  }
  const thread = events.find((e) => e.type === 'thread.started')?.thread_id;
  const sessions = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions');
  const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : d.name.endsWith(`-${thread}.jsonl`) ? [join(dir, d.name)] : [])) : []);
  return thread ? walk(sessions)[0] ?? null : null;
}
/** Whether the skill's body reached the model: its first paragraph, whitespace and escapes aside, is in the transcript. */
function loaded(transcript, skill) {
  if (!transcript) return false;
  const body = skill.split('\n---\n')[1] ?? skill;
  const marker = body.split('\n\n').map((p) => p.trim()).find((p) => p && !p.startsWith('#'));
  const flat = (s) => s.replace(/\\n|\\"|\s+/g, ' ').replace(/\\u0027|\\'/g, "'").replace(/ +/g, ' ');
  return Boolean(marker) && flat(readFileSync(transcript, 'utf8')).includes(flat(marker));
}

export async function runEval({ agent, out, model, skill: withSkill = true, skillFile = SKILL }) {
  const bin = execFileSync('/bin/sh', ['-c', `command -v ${agent}`], { encoding: 'utf8' }).trim();
  const hook = join(ROOT, 'target/debug/deep-hook');
  if (!existsSync(hook)) execFileSync('cargo', ['build', '-q', '-p', 'deep-hook'], { cwd: ROOT, stdio: 'inherit' });
  // Short: a socket path must fit in 104 bytes on macOS.
  const tmp = realpathSync(mkdtempSync('/tmp/deval-'));
  const [root, home, work] = [join(tmp, 'r'), join(tmp, 'h'), join(tmp, 'work')];
  mkdirSync(join(home, '.deepbuild'), { recursive: true, mode: 0o700 });
  writeFileSync(join(home, '.deepbuild', 'config.json'), JSON.stringify({ hub: { address: `unix:${join(root, 'hub.sock')}` } }));
  mkdirSync(work);
  fixture(work);
  const skillText = readFileSync(skillFile, 'utf8');
  if (withSkill) {
    for (const at of [join(work, '.claude', 'skills', 'deepbuild'), join(work, '.codex', 'skills', 'deepbuild'), join(work, '.agents', 'skills', 'deepbuild')]) {
      mkdirSync(at, { recursive: true });
      copyFileSync(skillFile, join(at, 'SKILL.md'));
    }
  }
  const dir = out ?? realpathSync(mkdtempSync(join(tmpdir(), 'deep-eval-')));
  mkdirSync(dir, { recursive: true });
  const env = Object.fromEntries(ALLOWED.filter((name) => name in process.env).map((name) => [name, process.env[name]]));
  const started = [];
  const stop = async () => {
    for (const child of started.reverse()) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      child.kill('SIGTERM');
      await new Promise((done) => { const t = setTimeout(() => { child.kill('SIGKILL'); done(); }, 15_000); child.once('exit', () => { clearTimeout(t); done(); }); });
    }
  };
  try {
    const hub = spawn(process.execPath, [CLI, 'hub', 'run', '--root', root], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    started.push(hub);
    let hubLog = '';
    hub.stderr.setEncoding('utf8').on('data', (d) => { hubLog += d; });
    await new Promise((ready, fail) => { hub.stdout.once('data', ready); hub.once('exit', () => fail(Error(`the hub did not start: ${hubLog}`))); });
    const args = (agent === 'claude' ? claudeArgs : codexArgs)({ dir, home, hook, work, model });
    const session = spawn(bin, args, { cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'] });
    started.push(session);
    let output = '';
    let errors = '';
    session.stdout.setEncoding('utf8').on('data', (d) => { output += d; });
    session.stderr.setEncoding('utf8').on('data', (d) => { errors += d; });
    session.stdin.end(PROMPT);
    const code = await new Promise((done) => { const t = setTimeout(() => { session.kill('SIGTERM'); done('timeout'); }, 15 * 60_000); session.once('exit', (c) => { clearTimeout(t); done(c); }); });
    if (agent === 'codex') forgetTrust(work);
    writeFileSync(join(dir, 'stream.jsonl'), output);
    writeFileSync(join(dir, 'stderr.txt'), errors);
    const events = parse(output);
    const transcript = transcriptOf(agent, events, work);
    const answer = answerOf(agent, events);
    const run = {
      v: 1, run: `eval-${agent}-red-unit-${Date.now()}`, agent: agent === 'claude' ? 'claude-code' : 'codex', repo: 'red-unit', exit: code,
      prompt: PROMPT,
      skill: { loaded: withSkill && loaded(transcript, skillText), text: withSkill ? skillText : null },
      tools: await liveTools({ ...env, HOME: home }, work),
      calls: callsOf(agent, events),
      manifest: MANIFEST,
      answer: { claims: answer.claims },
      transcript,
    };
    writeFileSync(join(dir, 'run.json'), `${JSON.stringify(run, null, 2)}\n`);
    if (transcript) copyFileSync(transcript, join(dir, 'transcript.jsonl'));
    writeFileSync(join(dir, 'hub.log'), hubLog);
    return { dir, run };
  } finally {
    await stop();
    rmSync(tmp, { recursive: true, force: true });
  }
}

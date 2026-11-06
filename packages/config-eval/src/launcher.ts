// The real agents under test and the real judge, on your plan: Claude Code for a `claude-*` model and Codex for a
// `gpt-*` judge, each headless with its prompt on stdin, as the adapters' facts launch them (`launch.readOnlyJob`).
// The agent under test may edit files in its own checkout and touches nothing else (#1108): it runs in the platform
// sandbox, which refuses every host but its model endpoint and this machine, from a throwaway config home that holds
// only its model sign-in, and its outside calls are answered from the task's recording. The judge reads only what it
// is shown, in an empty folder.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { ReplayPlan } from '@deepbuild/record';
import { bubblewrap, seatbelt, type Grant, type SandboxBackend } from '@deepbuild/supervisor';
import type { AgentResult, AgentRun, Grade, JudgeRequest, Launcher, Made } from './index.js';
import { openAnswering } from './recording.js';

/** One agent run may take this long, and never past the eval's deadline, before it is stopped and counted failed. */
const RUN_MS = 30 * 60_000;
type Cli = 'claude' | 'codex';
const cliOf = (model: string): Cli | undefined => (/^claude/.test(model) ? 'claude' : /^(gpt|o\d|codex)/.test(model) ? 'codex' : undefined);

/** After the CLI exits, how long its output may take to drain before what arrived is read. */
const DRAIN_MS = 2_000;
/**
 * Its stdout lines as JSON values, once it exits or its time is up. It runs in a process group of its own, so the
 * stop reaches the tools it started too; nothing else is stopped. A process outside the group that still holds its
 * output, such as a hook's helper, can't keep the run waiting: its exit and a short drain end it. In the Linux
 * sandbox the process started is bubblewrap, which stays until every process in the sandbox is gone; the sandbox's
 * helper writes the program's own exit on fd 3, and that ends it too.
 */
export function runCli(argv: string[], prompt: string, cwd: string, env: Record<string, string>, deadline: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'ignore', 'pipe'], detached: true });
    let out = '';
    const stop = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal); } catch { /* the group is gone */ } };
    let hard: NodeJS.Timeout | undefined;
    let drain: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => { stop('SIGTERM'); hard = setTimeout(() => stop('SIGKILL'), 5_000); }, Math.max(0, Math.min(RUN_MS, deadline - Date.now())));
    const done = () => {
      for (const t of [timer, hard, drain]) clearTimeout(t);
      child.stdout!.destroy();
      child.stdio[3]?.destroy();
      resolve(out.split('\n').flatMap((line) => { try { return [JSON.parse(line) as unknown]; } catch { return []; } }));
    };
    child.stdout!.on('data', (chunk: Buffer) => { out += chunk.toString('utf8'); });
    child.on('error', (error) => { for (const t of [timer, hard, drain]) clearTimeout(t); reject(error); });
    const exited = () => { drain ??= setTimeout(done, DRAIN_MS); };
    // The helper's log, a JSON value a line, which can arrive in any pieces.
    let log = '';
    child.stdio[3]?.on('data', (chunk: Buffer) => {
      const lines = (log + chunk.toString('utf8')).split('\n');
      log = lines.pop()!;
      for (const line of lines) { try { const v = JSON.parse(line) as unknown; if (isObj(v) && 'exit' in v) exited(); } catch { /* not a line of the helper's */ } }
    });
    child.on('exit', exited);
    child.on('close', done);
    child.stdin!.end(prompt);
  });
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The run's final reply and the tokens it reported, read from the CLI's JSON lines. */
export function resultOf(cli: Cli, lines: unknown[]): AgentResult {
  if (cli === 'claude') {
    const end = lines.filter(isObj).findLast((l) => l.type === 'result');
    if (!end || end.is_error === true || end.subtype !== 'success') return { ok: false };
    const u = isObj(end.usage) ? end.usage : undefined;
    return {
      ok: true, result: typeof end.result === 'string' ? end.result : '',
      ...(u ? { usage: { input: num(u.input_tokens) + num(u.cache_creation_input_tokens) + num(u.cache_read_input_tokens), output: num(u.output_tokens) } } : {}),
    };
  }
  const events = lines.filter(isObj);
  const done = events.findLast((e) => e.type === 'turn.completed');
  if (!done || events.some((e) => e.type === 'turn.failed' || e.type === 'error')) return { ok: false };
  const said = events.filter((e) => e.type === 'item.completed' && isObj(e.item) && e.item.type === 'agent_message').map((e) => String((e.item as Record<string, unknown>).text ?? ''));
  const u = isObj(done.usage) ? done.usage : undefined;
  return { ok: true, result: said.at(-1) ?? '', ...(u ? { usage: { input: num(u.input_tokens), output: num(u.output_tokens) } } : {}) };
}

/**
 * The 5-hour window a Claude Code run last reported, from its stream's `rate_limit_event`: the share used (0 to 1)
 * and when the window resets. Undefined when the run reported another limit, such as the weekly one or overage.
 */
export function windowOf(lines: unknown[]): { used: number; resets: number | null } | undefined {
  const info = lines.filter(isObj).filter((l) => l.type === 'rate_limit_event' && isObj(l.rate_limit_info)).map((l) => l.rate_limit_info as Record<string, unknown>)
    .findLast((i) => i.rateLimitType === 'five_hour' && typeof i.utilization === 'number' && Number.isFinite(i.utilization));
  return info ? { used: info.utilization as number, resets: typeof info.resetsAt === 'number' ? info.resetsAt : null } : undefined;
}

/** The platform sandbox: nothing a replay runs runs outside one. */
function sandbox(): SandboxBackend {
  if (process.platform === 'linux') return bubblewrap;
  if (process.platform === 'darwin') return seatbelt;
  throw Error(`a replay runs only in the platform sandbox, which ${process.platform} doesn't have yet, so nothing runs`);
}
/** The agent's model endpoint as `host:port`, from ANTHROPIC_BASE_URL or Claude Code's own, whether it is on this machine, and whether it is plain http. */
function modelEndpoint(env: Record<string, string>): { target: string; local: boolean; plain: boolean } {
  const url = new URL(env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com');
  const host = url.hostname;
  const plain = url.protocol === 'http:';
  return { target: `${host}:${url.port || (plain ? '80' : '443')}`, local: host === '127.0.0.1' || host === 'localhost' || host === '[::1]', plain };
}
/** The program `name` on PATH, or undefined. */
function onPath(name: string, path: string): string | undefined {
  for (const dir of path.split(':').filter(Boolean)) {
    try { accessSync(join(dir, name), constants.X_OK); return join(dir, name); } catch { /* not here */ }
  }
  return undefined;
}
/** What a replayed run reads of this machine's installs: the CLI's folder and where it really lives, and the node install the hook runs on. */
function installReads(cli: string): string[] {
  return [...new Set([dirname(cli), dirname(realpathSync(cli)), dirname(dirname(realpathSync(process.execPath)))])];
}
/** Whether `path` is `folder` or inside it. */
const within = (path: string, folder: string): boolean => { const r = relative(folder, path); return r === '' || (!r.startsWith('..') && !isAbsolute(r)); };
/** Variables a CLI reads that carry nothing of yours: its locale and terminal. */
const PLAIN = ['LANG', 'LC_ALL', 'LC_CTYPE', 'TERM'];
/** The model sign-in, when the environment carries it rather than a file in the config home. */
const SIGN_IN = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
/** Your Claude Code sign-in, from the config home the environment names. */
function oauthOf(given: Record<string, string>): Record<string, unknown> | undefined {
  const yours = given.CLAUDE_CONFIG_DIR || join(given.HOME ?? '/nonexistent', '.claude');
  let creds: unknown;
  try { creds = JSON.parse(readFileSync(join(yours, '.credentials.json'), 'utf8')); } catch { creds = undefined; }
  return isObj(creds) && isObj(creds.claudeAiOauth) ? creds.claudeAiOauth : undefined;
}

/**
 * One replayed Claude Code run (#1108). Its home and config home are throwaway folders holding only a copy of your
 * model sign-in and the replay's own settings: no settings, MCP server, plug-in or tool credential of yours. Its MCP
 * servers are the recording's, served by the answering server, and its PreToolUse hook hands each shell command to
 * the same server, which answers one that reaches the network from the recording or refuses it; every other command
 * runs in the sandbox. Its environment holds its PATH, its homes, its locale, its sign-in and its model endpoint.
 */
async function replayRun(run: AgentRun, deadline: number): Promise<{ lines: unknown[]; calls: Made[] }> {
  const given = run.env;
  const model = modelEndpoint(given);
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'dr-')));
  const answering = await openAnswering(run.recording ?? [], model.target);
  try {
    // Seatbelt keeps every run from writing a folder named .claude, so the config home is named otherwise.
    const home = join(box, 'home');
    const config = join(home, 'claude-home');
    const tmp = join(box, 'tmp');
    for (const d of [config, tmp]) mkdirSync(d, { recursive: true });
    // Your sign-in's access token alone: a replay that refreshed with your refresh token would rotate it and sign you out.
    const oauth = oauthOf(given);
    if (oauth && typeof oauth.accessToken === 'string') {
      writeFileSync(join(config, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: oauth.accessToken, expiresAt: oauth.expiresAt, scopes: oauth.scopes } }), { mode: 0o600 });
    }
    const hook = join(box, 'replay-hook.mjs');
    writeFileSync(hook, answering.hookScript);
    writeFileSync(join(config, 'settings.json'), JSON.stringify({
      permissions: { allow: answering.servers.map((s) => `mcp__${s}`) },
      hooks: { PreToolUse: [{ matcher: 'Bash|WebFetch|WebSearch', hooks: [{ type: 'command', command: `"${process.execPath}" "${hook}"` }] }] },
    }, null, 2));
    const mcp = join(box, 'mcp.json');
    writeFileSync(mcp, JSON.stringify(answering.mcpConfig));
    const proxy = `http://127.0.0.1:${answering.port}`;
    const env: Record<string, string> = {
      PATH: given.PATH ?? '/usr/bin:/bin', HOME: home, CLAUDE_CONFIG_DIR: config, TMPDIR: tmp,
      ...Object.fromEntries([...PLAIN, ...SIGN_IN, 'ANTHROPIC_BASE_URL'].flatMap((k) => (given[k] ? [[k, given[k]]] : []))),
      // A model endpoint off this machine is reached through the answering server's tunnel, its one way out.
      ...(model.local ? {} : { HTTPS_PROXY: proxy, https_proxy: proxy, NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost' }),
    };
    const cli = onPath('claude', env.PATH!);
    if (!cli) throw Error('no claude on the agent\'s PATH');
    const grant: Grant = {
      read: [...installReads(cli), box],
      write: [run.cwd, home, tmp],
      hosts: [`127.0.0.1:${answering.port}`, ...(model.local ? [model.target] : [])],
    };
    const argv = [cli, '-p', '--output-format', 'stream-json', '--verbose', '--model', run.model, '--permission-mode', 'acceptEdits', '--strict-mcp-config', '--mcp-config', mcp];
    const launch = await sandbox().confine({ argv, cwd: run.cwd, env }, grant, `run:replay-${box.slice(-6)}`);
    const lines = await runCli(launch.argv, run.prompt, launch.cwd, launch.env, deadline);
    return { lines, calls: answering.calls };
  } finally {
    await answering.close();
    rmSync(box, { recursive: true, force: true });
  }
}

/**
 * The launcher for a plan's models: the agents' runs stop at `deadlines.work`, the judge's at `deadlines.judge` (ms
 * since the epoch). It reads the agents' 5-hour
 * window from what their runs report, and before the first run from one short probe; a reading of another window
 * than the first, or none, leaves the window unread.
 */
export function defaultLauncher(plan: ReplayPlan, env: Record<string, string>, deadlines: { work: number; judge: number }): Launcher {
  const agent = cliOf(plan.models.agent);
  const judge = cliOf(plan.models.judge);
  if (!agent) throw Error(`no agent CLI runs ${plan.models.agent}: the eval runs claude-* models on Claude Code and gpt-* ones on Codex`);
  if (agent !== 'claude') throw Error(`a replay answers its agent's outside calls from the task's recording only on Claude Code, so ${plan.models.agent} can't be replayed yet (#1108)`);
  if (!judge) throw Error(`no CLI runs the judge ${plan.models.judge}: the eval runs claude-* models on Claude Code and gpt-* ones on Codex`);
  const model = modelEndpoint(env);
  if (model.plain && !model.local) throw Error(`the agent's model endpoint ${env.ANTHROPIC_BASE_URL} is off this machine over plain http, which the replay's one way out, a tunnel for https, can't carry; use an https endpoint or one on this machine`);
  // A replay copies only your sign-in's access token, never its refresh token, so it must last the runs.
  const expires = SIGN_IN.some((k) => env[k]) ? undefined : oauthOf(env)?.expiresAt;
  if (typeof expires === 'number' && expires < deadlines.work) throw Error(`your Claude sign-in expires at ${new Date(expires).toISOString()}, before the replay's runs end at ${new Date(deadlines.work).toISOString()}, and a replay can't refresh it; sign in to Claude Code again, or pass CLAUDE_CODE_OAUTH_TOKEN, then rerun`);
  // A replay reads its installs, and none may hold your home or Claude config home, with your credentials in them.
  const cli = onPath('claude', env.PATH ?? '/usr/bin:/bin');
  const yours = ([['home', env.HOME], ['Claude config home', env.CLAUDE_CONFIG_DIR]] as const).flatMap(([name, d]) => (d && existsSync(d) ? [{ name, at: realpathSync(d) }] : []));
  // Each folder resolved, as your home is: a sandbox's grant of a link reads what it links to.
  for (const folder of cli ? installReads(cli) : []) {
    const held = yours.find((d) => within(d.at, realpathSync(folder)));
    if (held) throw Error(`a replay's sandbox reads ${folder}, where Claude Code or the node it runs on is installed, and that holds your ${held.name} ${held.at} with its credentials; install them in a folder of their own, then rerun`);
  }
  // The judge only reads.
  const read: Record<Cli, (model: string) => string[]> = {
    claude: (model) => ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--strict-mcp-config', '--setting-sources', 'user', '--permission-mode', 'dontAsk'],
    codex: (model) => ['exec', '--json', '-s', 'read-only', '--skip-git-repo-check', '--ignore-user-config', '-m', model, '-'],
  };
  /** In an empty folder of its own, removed after. */
  const inEmpty = async <T>(work: (dir: string) => Promise<T>): Promise<T> => {
    const dir = mkdtempSync(join(tmpdir(), 'dj-'));
    try { return await work(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  let probed = false;
  let first: { used: number; resets: number | null } | undefined;
  let last: { used: number; resets: number | null } | undefined;
  const note = (lines: unknown[]): unknown[] => {
    const w = windowOf(lines);
    // Runs end out of order, and a window's use only grows: the fullest reading of it is the latest.
    if (w) { first ??= w; if (!last || w.resets !== last.resets || w.used > last.used) last = w; }
    return lines;
  };
  return {
    async work(run) {
      const { lines, calls } = await replayRun(run, deadlines.work);
      return { ...resultOf(agent, note(lines)), calls };
    },
    async judge(request: JudgeRequest): Promise<Grade[]> {
      const prompt = `${request.prompt}\n\n${request.outputs.map((o) => `=== Output ${o.label} ===\n${o.text}`).join('\n\n')}\n\n`
        + `Answer with one line of JSON and nothing after it: {"grades":[{"label":"<label>","score":<0 to 1>}]}, one entry per output.`;
      const answer = resultOf(judge, await inEmpty((dir) => runCli([judge, ...read[judge](request.model)], prompt, dir, env, deadlines.judge)));
      const lastLine = (answer.result ?? '').trim().split('\n').at(-1) ?? '';
      const parsed = JSON.parse(lastLine.slice(lastLine.indexOf('{'))) as unknown;
      const grades = isObj(parsed) && Array.isArray(parsed.grades) ? parsed.grades : [];
      return grades.filter(isObj).map((g) => ({ label: String(g.label), score: Number(g.score) }));
    },
    async planUsed() {
      if (agent !== 'claude') return null;
      if (!first && !probed) await inEmpty((dir) => runCli([agent, ...read[agent](plan.models.agent)], 'Reply with the single word ok.', dir, env, deadlines.work)).then(note).finally(() => { probed = true; });
      return last && first && last.resets === first.resets ? last.used : null;
    },
  };
}

// `deep doctor` (#19): the hub, its socket and disk, the hook installation, and each agent's own items, each with a
// stable code from the doctor family (doctor.item@1), a level, what was read and the fix. An item that didn't run
// reads not_checked, never ok: the test prompt spends plan usage, so it runs only with --prompt. The exit status is
// the one table's: 1 when any item failed, else 3 when any wasn't checked, else 0.
import { execFile } from 'node:child_process';
import { constants, existsSync, readFileSync, realpathSync, statfsSync } from 'node:fs';
import { access } from 'node:fs/promises';
import net from 'node:net';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudeSettings, commands, installed, readJson } from './claude-settings.js';
import { keychain } from './keychain.js';
import { hubAddress, installedRoot } from './paths.js';
import { activePlant as plant } from './plant.js';
import { relationItems } from './setup.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
export interface Item { item: string; agent: string; code: string; level: 'ok' | 'warn' | 'fail' | 'skip'; evidence: string; fix: string }
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
import { codexConfig, codexHooks, hookList, hooksDisabled, installedCodex, modified } from './codex-settings.js';
const MANAGED = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode/managed-settings.json' : '/etc/claude-code/managed-settings.json';
const OURS = /deep-hook|packages\/cli\/dist\/main\.js/;

/** Runs a program with a 10 s cap; its exit code and output, or null when it couldn't start. */
function ran(program: string, args: string[], input?: string): Promise<{ code: number | null; out: string; err: string } | null> {
  return new Promise((done) => {
    const child = execFile(program, args, { timeout: 10_000, encoding: 'utf8', env: process.env }, (error, out, err) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') return done(null);
      done({ code: error ? (typeof error.code === 'number' ? error.code : null) : 0, out: String(out), err: String(err) });
    });
    child.stdin?.end(input ?? '');
  });
}
/** The first executable `name` on a PATH. */
async function which(name: string, path: string): Promise<string | undefined> {
  for (const dir of path.split(delimiter)) {
    if (!dir) continue;
    const file = join(dir, name);
    if (await access(file, constants.X_OK).then(() => true, () => false)) return file;
  }
  return undefined;
}
const facts = (agent: string): { versions: string[]; billing?: { apiKeyVariables?: string[] } } => JSON.parse(readFileSync(join(REPO, 'adapters', `${agent}.facts.json`), 'utf8')) as { versions: string[] };
const parts = (v: string) => v.split(/[.-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
function compare(a: string, b: string): number {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] ?? 0, q = y[i] ?? 0;
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    return String(p) < String(q) ? -1 : 1;
  }
  return 0;
}
const covered = (agent: string, version: string) => {
  const range = facts(agent).versions;
  return range.length > 0 && compare(version, range[0]!) >= 0 && compare(version, range[range.length - 1]!) <= 0;
};
const hubAnswers = (socket: string): Promise<boolean> => new Promise((done) => {
  const sock = net.connect(socket);
  const timer = setTimeout(() => { sock.destroy(); done(false); }, 2000);
  sock.once('data', () => { clearTimeout(timer); sock.destroy(); done(true); });
  sock.once('error', () => { clearTimeout(timer); done(false); });
});

/** The first port from `from` (inclusive) to `to` that nothing listens on at 127.0.0.1. */
async function firstFree(from: number, to: number): Promise<number | undefined> {
  for (let port = from; port < to; port++) {
    const free = await new Promise<boolean>((done) => {
      const server = net.createServer();
      server.once('error', () => done(false));
      server.listen(port, '127.0.0.1', () => server.close(() => done(true)));
    });
    if (free) return port;
  }
  return undefined;
}

/** Every item, in the order a person reads them; `prompt` sends each signed-in agent its test prompt. */
export async function doctorItems(env: NodeJS.ProcessEnv, options: { prompt: boolean; cwd: string }): Promise<Item[]> {
  const root = installedRoot();
  const items: Item[] = [];
  const add = (item: string, agent: string, code: string, level: Item['level'], evidence: string, fix: string) => items.push({ item, agent, code, level, evidence, fix });

  // The hub and its disk.
  let socket = '';
  try { socket = hubAddress(options.cwd).path; } catch (error) { add('hub.socket', 'deepbuild', 'hub_unreachable', 'fail', error instanceof Error ? error.message : String(error), 'Fix ~/.deepbuild/config.json\'s hub.address.'); }
  if (socket) {
    if (await hubAnswers(socket)) add('hub.socket', 'deepbuild', 'healthy', 'ok', `the hub answers at unix:${socket}`, 'Nothing to do.');
    else add('hub.socket', 'deepbuild', 'hub_unreachable', 'fail', `no hub answers at unix:${socket}`, 'Run `deep hub start`; deep setup installs it as a login service.');
  }
  try {
    let at = root;
    while (!existsSync(at) && dirname(at) !== at) at = dirname(at);
    const fs = statfsSync(at);
    const free = fs.bavail * fs.bsize;
    const gb = (free / 2 ** 30).toFixed(1);
    if (free < 2 ** 30) add('hub.disk', 'deepbuild', 'disk_low', 'warn', `${gb} GB free where ${root} lives`, 'Free some space: the record and evidence need room to write, and a full disk turns every gate watch-only.');
    else add('hub.disk', 'deepbuild', 'healthy', 'ok', `${gb} GB free where ${root} lives`, 'Nothing to do.');
  } catch (error) {
    add('hub.disk', 'deepbuild', 'not_checked', 'skip', `the free space at ${root} couldn't be read: ${error instanceof Error ? error.message : String(error)}`, 'Check the disk by hand.');
  }

  // The ports a worktree's stack leases (env-local, from 3000 up): one must be free for the next stack.
  const free = await firstFree(3000, 3100);
  if (free !== undefined) add('hub.ports', 'deepbuild', 'healthy', 'ok', `port ${free} is free on 127.0.0.1 for the next worktree's stack, leased from 3000 up`, 'Nothing to do.');
  else add('hub.ports', 'deepbuild', 'ports_taken', 'fail', 'no port from 3000 to 3099 is free on 127.0.0.1, so no worktree\'s stack can start', 'Stop the services you started on those ports, by PID.');

  // Claude Code: its hooks, where they won't run, the order they run in, the timing relations, MCP, the status line.
  const file = claudeSettings();
  const settings = readJson(file);
  const record = installed(root);
  const hooks = isObj(settings?.hooks) ? settings.hooks : {};
  const present = (event: string, command: string) => Array.isArray(hooks[event]) && (hooks[event] as unknown[]).some((g) => isObj(g) && Array.isArray(g.hooks) && g.hooks.some((h) => isObj(h) && h.command === command));
  if (!record) add('claude.hooks', 'claude-code', 'hooks_missing', 'fail', `DeepBuild's hooks aren't installed: no setup has written them to ${file}`, 'Run `deep setup`, which adds them beside yours.');
  else {
    // The planted wrong program takes setup's record as the installation and never reads your settings file.
    const missing = plant() === 'doctor-misses-hooks' ? [] : Object.entries(record.hooks).filter(([event, groups]) => groups.some((g) => (g.hooks as Obj[]).some((h) => !present(event, String(h.command))))).map(([event]) => event);
    if (missing.length) add('claude.hooks', 'claude-code', 'hooks_missing', 'fail', `DeepBuild's ${missing.join(', ')} hook entr${missing.length === 1 ? 'y is' : 'ies are'} missing from ${file}, so those hooks don't reach the hub`, 'Run `deep setup`, which writes them back beside yours.');
    else add('claude.hooks', 'claude-code', 'healthy', 'ok', `DeepBuild's entries for ${Object.keys(record.hooks).join(', ')} are in ${file}`, 'Nothing to do.');
  }
  for (const where of hooksOff(file, settings, options.cwd, env)) add('claude.hooks_enabled', 'claude-code', 'hooks_disabled', 'fail', where.evidence, where.fix);
  if (record) for (const order of hookOrders(settings, commands(record))) add('claude.hook_order', 'claude-code', 'healthy', 'ok', order, 'Nothing to do: Claude Code starts a hook\'s entries together, so none waits on another; this is the order it reads them in.');
  items.push(...relationItems());
  const user = readJson(join(homedir(), '.claude.json'));
  const server = isObj(user?.mcpServers) ? user.mcpServers.deepbuild : undefined;
  if (isObj(server) && Array.isArray(server.args) && server.args.includes('mcp')) add('claude.mcp', 'claude-code', 'healthy', 'ok', `DeepBuild's MCP server is registered at user scope in ~/.claude.json (${String(server.command)} ${server.args.join(' ')})`, 'Nothing to do.');
  else add('claude.mcp', 'claude-code', 'mcp_unregistered', 'fail', 'DeepBuild\'s MCP server isn\'t registered in ~/.claude.json, so sessions can\'t ask you or claim done', 'Run `deep setup`.');
  const line = isObj(settings?.statusLine) ? String(settings.statusLine.command) : '';
  if (/deep-hook\S*'? statusline$/.test(line)) add('claude.statusline', 'claude-code', 'healthy', 'ok', `the status line forwarder runs in ${file}, then your own status line`, 'Nothing to do.');
  else add('claude.statusline', 'claude-code', 'statusline_missing', 'warn', `${file}'s statusLine isn't DeepBuild's forwarder, so the plan windows aren't read`, 'Run `deep setup`, which puts the forwarder in front of your own status line.');

  // Each agent's binary, version, sign-in and billing; Claude Code's token lifetime, test prompt and jobs' binary.
  const path = env.PATH ?? '';
  const loginPath = loginPathOf(root);
  const [claude, codex] = await Promise.all([which('claude', path), which('codex', path)]);
  await Promise.all([claudeItems(claude, loginPath, env, options.prompt, add), codexItems(codex, env, add)]);
  return items;
}

async function claudeItems(claude: string | undefined, loginPath: string | undefined, env: NodeJS.ProcessEnv, prompt: boolean, add: (...a: [string, string, string, Item['level'], string, string]) => void): Promise<void> {
  const agent = 'claude-code';
  const range = facts(agent).versions;
  if (!claude) {
    add('claude.binary', agent, 'binary_missing', 'fail', 'no claude on your PATH', 'Install Claude Code, or put it on your PATH.');
    return;
  }
  const [version, auth, token, jobs] = await Promise.all([
    ran(claude, ['--version']), ran(claude, ['auth', 'status']), tokenExpiry(env), loginPath === undefined ? undefined : which('claude', loginPath),
  ]);
  const v = /(\d+\.\d+\.\d+[\w.-]*)/.exec(version?.out ?? '')?.[1];
  if (!v) add('claude.binary', agent, 'binary_missing', 'fail', `${claude} --version printed no version`, 'Reinstall Claude Code.');
  else if (!covered(agent, v)) add('claude.binary', agent, 'version_uncovered', 'fail', `${claude} is Claude Code ${v}, outside what its facts cover (${range[0]} to ${range[range.length - 1]}): its hooks are recorded unverified and its gates are watch-only`, 'Install a version the facts cover, or update DeepBuild.');
  else add('claude.binary', agent, 'healthy', 'ok', `${claude} is Claude Code ${v}, which its facts cover`, 'Nothing to do.');
  if (jobs !== undefined) {
    const same = (() => { try { return realpathSync(jobs) === realpathSync(claude); } catch { return jobs === claude; } })();
    if (same) add('claude.jobs_binary', agent, 'healthy', 'ok', `your sessions and DeepBuild's jobs both run ${claude}`, 'Nothing to do.');
    else add('claude.jobs_binary', agent, 'binary_differs', 'warn', `your sessions run ${claude}, and DeepBuild's jobs, started with your login shell's PATH, would run ${jobs}`, 'Remove one install, or put the one you use first on your login shell\'s PATH, then run `deep setup` to record it again.');
  } else if (loginPath !== undefined) add('claude.jobs_binary', agent, 'binary_missing', 'warn', `DeepBuild's jobs would find no claude on your login shell's PATH (${loginPath})`, 'Put claude on your login shell\'s PATH, then run `deep setup`.');
  let signed: Obj | undefined;
  try { signed = JSON.parse(auth?.out ?? '') as Obj; } catch { signed = undefined; }
  if (signed?.loggedIn === true) add('claude.sign_in', agent, 'healthy', 'ok', `signed in by ${String(signed.authMethod)}${signed.subscriptionType ? `, plan ${String(signed.subscriptionType)}` : ''}`, 'Nothing to do.');
  else add('claude.sign_in', agent, 'signed_out', 'fail', `claude auth status says you aren't signed in (exit ${auth?.code ?? 'none'})`, 'Run claude and sign in with /login.');
  // The planted wrong program says nothing of the token's lifetime.
  if (plant() === 'doctor-hides-token') { /* no item */ } else if (token === undefined) add('claude.token', agent, 'not_checked', 'skip', 'no sign-in token lifetime to read: none in the Keychain or ~/.claude/.credentials.json', 'Sign in to Claude Code; a run checks the token again before it starts.');
  else {
    const left = token - Date.now();
    const when = new Date(token).toISOString();
    if (left < 3_600_000) add('claude.token', agent, 'token_expiring', 'warn', `your sign-in token expires at ${when}, in ${Math.max(0, Math.round(left / 60_000))} minutes: a run planned past then won't start`, 'Sign in again (claude, then /login) before a long run.');
    else add('claude.token', agent, 'healthy', 'ok', `your sign-in token expires at ${when}`, 'Nothing to do; a run planned past then won\'t start, saying so.');
  }
  billing(agent, 'Claude Code', env, add);
  if (env.CLAUDECODE) add('claude.nesting', agent, 'nested_session', 'warn', 'deep doctor runs inside a Claude Code session (CLAUDECODE is set), so what it reads is that session\'s environment', 'Run deep doctor from your own terminal.');
  if (!prompt && plant() !== 'prompt-without-flag') {
    // The planted wrong program shows the prompt it didn't send as ok.
    if (plant() === 'skipped-reads-ok') add('claude.prompt', agent, 'healthy', 'ok', 'the test prompt', 'Nothing to do.');
    else add('claude.prompt', agent, 'not_checked', 'skip', 'no test prompt was sent: it spends plan usage', 'Run `deep doctor --prompt` to send Claude Code one test prompt.');
    return;
  }
  const answer = await ran(claude, ['-p', '--output-format', 'json'], 'Reply with OK.\n');
  let result: Obj | undefined;
  try { result = JSON.parse(answer?.out ?? '') as Obj; } catch { result = undefined; }
  if (result?.subtype === 'success' && result.is_error === false) add('claude.prompt', agent, 'healthy', 'ok', `a test prompt came back: ${String(result.result).slice(0, 80)}`, 'Nothing to do.');
  else add('claude.prompt', agent, 'prompt_failed', 'fail', `the test prompt didn't come back as a success (exit ${answer?.code ?? 'none'}): ${(answer?.err || answer?.out || '').slice(0, 200)}`, 'Run claude -p "Reply with OK." yourself and read what it says.');
}
async function codexItems(codex: string | undefined, env: NodeJS.ProcessEnv, add: (...a: [string, string, string, Item['level'], string, string]) => void): Promise<void> {
  const agent = 'codex';
  const root = installedRoot();
  if (hooksDisabled()) add('codex.hooks_enabled', agent, 'hooks_disabled', 'fail', `${codexConfig()} has hooks = false under [features], so DeepBuild's hooks won't run there; setup never flips your setting`, 'Take hooks = false out of [features] if you want DeepBuild to hear Codex sessions.');
  if (installedCodex(root)) {
    const changed = modified(root);
    for (const text of changed) add('codex.hooks', agent, 'hooks_modified', 'fail', text, `Put the entry back as ${root}/codex-hooks.json has it, then approve it once in /hooks if Codex asks.`);
    if (!changed.length) add('codex.hooks', agent, 'healthy', 'ok', `DeepBuild's entries are in ${codexHooks()} as setup wrote them`, 'Nothing to do.');
  }
  if (!codex) return;
  // Trust is Codex's to say, by its own hook list.
  if (installedCodex(root)) {
    const listed = await hookList(codex, homedir(), env);
    const ours = listed?.filter((h) => /deep-hook'? codex /.test(String(h.command)));
    if (!ours) add('codex.hooks_trust', agent, 'not_checked', 'skip', 'not checked: Codex gave no hook list', 'Run deep doctor again once codex app-server starts.');
    else {
      const waiting = ours.filter((h) => h.trustStatus !== 'trusted');
      if (waiting.length) add('codex.hooks_trust', agent, 'hooks_untrusted', 'warn', `Codex's hook list reports ${waiting.map((h) => `${h.eventName} ${h.trustStatus}`).join(', ')}: those hooks don't run until you approve them`, 'Approve them once in /hooks in Codex.');
      else add('codex.hooks_trust', agent, 'healthy', 'ok', `Codex's hook list reports DeepBuild's ${ours.length} entries trusted`, 'Nothing to do.');
    }
  }
  const [version, login] = await Promise.all([ran(codex, ['--version']), ran(codex, ['login', 'status'])]);
  const v = /(\d+\.\d+\.\d+[\w.-]*)/.exec(version?.out ?? '')?.[1];
  const range = facts(agent).versions;
  if (!v) add('codex.binary', agent, 'binary_missing', 'fail', `${codex} --version printed no version`, 'Reinstall Codex.');
  else if (!covered(agent, v)) add('codex.binary', agent, 'version_uncovered', 'fail', `${codex} is Codex ${v}, outside what its facts cover (${range[0]} to ${range[range.length - 1]})`, 'Install a version the facts cover, or update DeepBuild.');
  else add('codex.binary', agent, 'healthy', 'ok', `${codex} is Codex ${v}, which its facts cover`, 'Nothing to do.');
  if (login?.code === 0) add('codex.sign_in', agent, 'healthy', 'ok', 'codex login status exits 0: signed in', 'Nothing to do.');
  else add('codex.sign_in', agent, 'signed_out', 'fail', `codex login status exits ${login?.code ?? 'none'}: not signed in`, 'Run codex login.');
  billing(agent, 'Codex', env, add);
}
/** A billing key set where your sessions start makes them bill an API account; never shows its value. */
function billing(agent: string, name: string, env: NodeJS.ProcessEnv, add: (...a: [string, string, string, Item['level'], string, string]) => void): void {
  const set = (facts(agent).billing?.apiKeyVariables ?? []).filter((k) => env[k]);
  for (const key of set) add(`${agent === 'codex' ? 'codex' : 'claude'}.billing`, agent, 'billing_api_key', 'warn', `${key} is set in the shell your sessions start from, so ${name} sessions bill an API account, not your plan`, `Unset ${key} where you start sessions if you mean to use your plan.`);
  if (!set.length) add(`${agent === 'codex' ? 'codex' : 'claude'}.billing`, agent, 'healthy', 'ok', `no API billing variable is set, so ${name} sessions use your plan`, 'Nothing to do.');
}
/** When your Claude Code sign-in token expires: the Keychain item, or the credentials file where there is no Keychain. */
async function tokenExpiry(env: NodeJS.ProcessEnv): Promise<number | undefined> {
  let text = await keychain('Claude Code-credentials');
  const file = join(env.HOME ?? '', '.claude', '.credentials.json');
  if (text === undefined && existsSync(file)) text = readFileSync(file, 'utf8');
  try {
    const o = (JSON.parse(text ?? '') as Obj).claudeAiOauth;
    return isObj(o) && typeof o.expiresAt === 'number' ? o.expiresAt : undefined;
  } catch {
    return undefined;
  }
}
function loginPathOf(root: string): string | undefined {
  const config = readJson(join(root, 'config.json'));
  const runner = isObj(config?.runner) ? config.runner : undefined;
  return typeof runner?.login_path === 'string' ? runner.login_path : undefined;
}

/**
 * Where Claude Code won't run DeepBuild's hooks: `disableAllHooks` in your settings, the repo's or managed settings,
 * or a policy that allows only managed hooks. The planted wrong program reads only your user settings.
 */
function hooksOff(file: string, settings: Obj | undefined, cwd: string, env: NodeJS.ProcessEnv): { evidence: string; fix: string }[] {
  const out: { evidence: string; fix: string }[] = [];
  if (settings?.disableAllHooks === true) out.push({ evidence: `disableAllHooks is true in ${file}, so Claude Code runs no hook, DeepBuild's included`, fix: `Take disableAllHooks out of ${file}.` });
  if (plant() === 'hooks-disable-user-only') return out;
  const repo = topLevel(cwd);
  for (const name of ['settings.json', 'settings.local.json']) {
    const repoFile = join(repo, '.claude', name);
    if (readJson(repoFile)?.disableAllHooks === true) out.push({ evidence: `disableAllHooks is true in ${repoFile}, so DeepBuild's hooks won't run in ${repo}`, fix: `Take disableAllHooks out of ${repoFile} to have DeepBuild watch sessions in ${repo}.` });
  }
  const managedFile = env.DEEP_HUB_TEST_MANAGED_SETTINGS || MANAGED;
  const managed = readJson(managedFile);
  if (managed?.allowManagedHooksOnly === true) out.push({ evidence: `allowManagedHooksOnly is true in Claude Code's managed settings (${managedFile}), so only managed hooks run and DeepBuild's user-level hooks won't run anywhere`, fix: 'Ask whoever manages this Mac to add DeepBuild\'s hooks to the managed settings, or to allow user hooks.' });
  if (managed?.disableAllHooks === true) out.push({ evidence: `disableAllHooks is true in Claude Code's managed settings (${managedFile}), so no hook runs`, fix: 'Ask whoever manages this Mac to allow hooks.' });
  return out;
}
function topLevel(cwd: string): string {
  for (let dir = cwd; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return cwd;
  }
}
/** For each hook another tool also has entries on: every entry, in the order Claude Code reads and starts them. */
function hookOrders(settings: Obj | undefined, ours: Set<string>): string[] {
  const hooks = isObj(settings?.hooks) ? settings.hooks : {};
  const out: string[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    const commands = (Array.isArray(groups) ? groups : []).flatMap((g) => (isObj(g) && Array.isArray(g.hooks) ? g.hooks : []).filter(isObj).map((h) => String(h.command)));
    const theirs = commands.filter((c) => !ours.has(c) && !OURS.test(c));
    if (!theirs.length || commands.length === theirs.length) continue;
    // The planted wrong program lists ours first, whatever the file says.
    const listed = plant() === 'hooks-order-ours-first' ? [...commands.filter((c) => !theirs.includes(c)), ...theirs] : commands;
    out.push(`${event}, in the order Claude Code reads its entries (it starts them together): ${listed.map((c, i) => `${i + 1}. ${theirs.includes(c) ? `another tool's ${c}` : `DeepBuild's ${c}`}`).join('; ')}`);
  }
  return out;
}

/**
 * `deep doctor [--json] [--prompt]`: the items, one per line, for a person (an item not checked reading "not checked")
 * or as doctor.item@1 objects with their item and agent; `also` adds the extensions' items. The exit is the one table's:
 * 2 for a usage error with nothing checked, 1 when any item failed, else 3 when any wasn't checked, else 0.
 */
export async function doctorCommand(args: readonly string[], also: () => Promise<Item[]>): Promise<number> {
  // The planted wrong program runs whatever flags it is given.
  if (plant() !== 'doctor-takes-any-flag' && (args.some((a) => a !== '--json' && a !== '--prompt') || new Set(args).size !== args.length)) {
    process.stderr.write('Usage: deep doctor [--json] [--prompt]\n');
    return 2;
  }
  const json = args.includes('--json');
  const agents: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', deepbuild: 'DeepBuild' };
  const items = [...(await doctorItems(process.env, { prompt: args.includes('--prompt'), cwd: process.cwd() })), ...(await also())];
  for (const i of items) {
    const state = i.code === 'not_checked' ? 'not checked' : i.level.toUpperCase();
    console.log(json ? JSON.stringify(i) : `${agents[i.agent] ?? i.agent} ${i.item}: ${state} (${i.code})\n  ${i.evidence}\n  Fix: ${i.fix}`);
  }
  const failed = items.some((i) => i.level === 'fail');
  const unchecked = items.some((i) => i.code === 'not_checked');
  // The planted wrong programs: one exits 0 with an item not checked, one puts not checked before a failure.
  if (plant() === 'not-checked-exits-0') return failed ? 1 : 0;
  if (plant() === 'doctor-not-checked-first' && unchecked) return 3;
  return failed ? 1 : unchecked ? 3 : 0;
}

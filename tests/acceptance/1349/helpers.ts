// Test-side tools for #1349's acceptance tests (README): the app's runtime folder built once per commit, a fixture
// machine standing in for a clean Mac (a temp HOME with no agent, and a refusing, logging `git`, `node`, `xcrun` and
// `cc` first on the system PATH), the replica (`deep-drive`) driven over its stdin for the first screen and Set up, the
// hub's socket for the box's Send and the sign-in row's button, the stand-in installer, the stand-in `claude`
// (fixtures/claude.pl) and its model (a 127.0.0.1 server the runner's forwarder reaches as api.anthropic.com:443).
// Screen readers come from #1100's suite and the credential sweep from #19's, imported by path. Nothing here stands in
// for DeepBuild: every judge reads what the replica, the hub's record, the files under the temp home, the stand-ins'
// logs or the model's server show.
//
// Safety: every folder is under /tmp/da1349-* (a socket path must fit in 104 bytes) or target/da1349; HOME is the temp
// home for every process started, so no real ~/.deepbuild, ~/.claude, ~/.local or login Keychain is read or written; no
// child inherits this process's DEEP_*, CLAUDE*, CODEX*, XDG_*, GIT_*, proxy or billing variables. Every process
// stopped is one this suite started, by PID: its own children, their descendants, and processes whose command line
// names a world's own temp folder. No network beyond 127.0.0.1, no model.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net, { type AddressInfo } from 'node:net';
import { availableParallelism, loadavg } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { AGENT_NAMES, byId, controlFailures, FIRST_LAUNCH, flat, pageId, screenOf, wordsOf, type Screen, type Seen, type SNode } from '../1100/helpers.ts';
import { everyForm, sweep, walk, type Canary } from '../19/status/helpers.ts';

export { AGENT_NAMES, byId, controlFailures, FIRST_LAUNCH, flat, pageId, screenOf, sweep, walk, wordsOf };
export type { Canary, Screen, Seen, SNode };

export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const SUITE = fileURLToPath(new URL('./', import.meta.url));
export const NODE = process.execPath;
export const MIN = 60_000;
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
export const inconclusive = (why: string): never => expect.fail(`INCONCLUSIVE: ${why}; this is not a pass`);
export const said = (v: unknown, n = 400): string => (JSON.stringify(v) ?? String(v)).slice(0, n);
export const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Line = { [key: string]: any };

/** The criteria: `#1349.<first 8 hex of SHA-256(text, trimmed, white space collapsed)>` (scripts/proof-change.mjs, criterionId). */
export const ID = {
  1: '#1349.ba1a9b5f', 2: '#1349.30081c64', 3: '#1349.d6911e12', 4: '#1349.e08d3218',
  5: '#1349.7e8a2760', 6: '#1349.aa369523', 7: '#1349.72be1f28', 8: '#1349.8524225c',
} as const;
export const CRITERION = {
  1: "On a clean macOS test account with no agent, Node, git or developer tools, the download reaches the box with no terminal and no developer tools prompt. The sign-in step is the harness's, in the agent's own window",
  2: 'A topic then makes a workspace with working history and going back. A build that needs a system git fails, naming the call',
  3: "DeepBuild's record and logs hold no credential, and a scan of them finds none",
  4: 'A planted lapsed sign-in pauses the work with one plain line, and the work resumes after signing in, with nothing lost',
  5: "Budgets, on the reference Mac in the local preflight: the app's part of this, leaving out the agent's own installer and sign-in, takes under 2 minutes",
  6: "On the clean account, a person, not the harness, signs in once from the row's button in a recorded run, and the words typed before sign-in reach the agent once. A planted hub that closes the row when the page returns, with the probe still reading not signed in, fails, naming the check",
  7: 'The first screen has one button with no agent found. A planted screen with an install button beside Set up fails, naming the control',
  8: "The record's setup events name the agent the first screen's row named before the click. A planted setup that installs a different agent fails, naming both",
} as const;
export const named = (n: keyof typeof ID): string => `AC${n} ${ID[n]}`;

/** The planted wrong programs (README: The contract, 8). `system-git` is a runtime build, the rest DEEP_HUB_PLANT values. */
export const PLANT = {
  systemGit: 'system-git',
  installButton: 'install-button-beside-set-up',
  otherAgent: 'installs-other-agent',
  closesOnReturn: 'closes-on-return',
} as const;

/** The topics sent in the box: a five-day trip (AC2, AC6) and, during the lapse, a weekend in Porto (AC4). */
export const TRIP = 'plan a five-day trip for four people under $4,000';
export const PORTO = 'plan a weekend in Porto for four people under $1,500';
/** The research job's answer for a trip, in #1342's shape (tests/acceptance/1342/README.md, The contract 3). */
export const tripAnswer = (words: string): Line => ({
  makes: 'plan',
  lines: [
    { id: 'L1', field: 'makes', text: `A day-by-day plan: ${words}`, cites: [{ at: 'words', quote: words.split(' for ')[0] }] },
    { id: 'L2', field: 'for', text: 'Four people travelling together', cites: [{ at: 'words', quote: 'for four people' }] },
    { id: 'L3', field: 'proves', text: `The whole trip costs ${words.slice(words.indexOf('under'))}`, cites: [{ at: 'words', quote: words.slice(words.indexOf('under')) }] },
  ],
  promises: [{ line: 'L3', kind: 'money' }, { line: 'L1', kind: 'document' }],
  tasks: [{ title: 'Pick where to stay', serves: ['L1', 'L3'] }, { title: 'Plan each day', serves: ['L1'] }],
  held: [],
  fits: null,
});

// ---- Processes: only ones this suite started, stopped by PID.

const owned = new Set<number>();
export const own = (pid: number | undefined | null): void => { if (pid) owned.add(pid); };
function living(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  try { process.kill(pid, 0); } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  const stat = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout;
  return !/Z/.test(stat);
}
function table(): { pid: number; ppid: number; command: string }[] {
  return spawnSync('ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.split('\n').map((l) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null).map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), command: m[3]! }));
}
/** The PIDs to stop for a world: what this suite spawned, the hubs its launcher stand-in logged, their descendants, and every process naming the world's folder. */
function worldPids(tmp: string): number[] {
  const all = table();
  const roots = new Set<number>(owned);
  const launched = join(tmp, 'launched');
  if (existsSync(launched)) for (const p of readFileSync(launched, 'utf8').split('\n').map(Number)) if (p > 0) roots.add(p);
  for (const p of all) if (p.command.includes(tmp)) roots.add(p.pid);
  const out = new Set<number>(roots);
  for (let grew = true; grew;) { grew = false; for (const p of all) if (out.has(p.ppid) && !out.has(p.pid)) { out.add(p.pid); grew = true; } }
  out.delete(process.pid);
  return [...out];
}
async function stopPids(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(living) && Date.now() < deadline) await sleep(100);
  for (const pid of pids) if (living(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}

// ---- Builds, once per commit, under target/da1349 (README, How to run).

const CACHE = join(process.env.CARGO_TARGET_DIR ? dirname(process.env.CARGO_TARGET_DIR) : REPO, 'target', 'da1349');
const CARGO_ENV = { ...process.env, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0' };
interface Ran { code: number | null; stdout: string; stderr: string }
function runFor(command: string, args: readonly string[], o: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env ?? process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout = (stdout + d).slice(-20_000); });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-20_000); });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, o.timeoutMs);
    child.on('error', (e) => { stderr += `\n[spawn failed: ${e.message}]`; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
const shown = (r: Ran): string => `exit ${r.code}, stdout ${said(r.stdout.slice(-1200), 1300)}, stderr ${said(r.stderr.slice(-1200), 1300)}`;

const head = (): string => {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) blocked(`git rev-parse HEAD in the checkout failed: ${r.stderr}`);
  return r.stdout.trim();
};
const runtimes = new Map<string, Promise<string>>();
/**
 * The app's runtime folder (design: Starting from nothing), as `node scripts/app-runtime.mjs` lays it out from the
 * release's archives (`node scripts/release-pack.mjs`, #41's pack check, unsigned), built once per commit into
 * target/da1349/<commit>/ and reused: `plain`, and `system-git` (`--plant system-git`, the same folder with no `git/`).
 * A build that can't be made is BLOCKED, naming it, never a pass.
 */
export function runtime(kind: 'plain' | 'system-git'): Promise<string> {
  let built = runtimes.get(kind);
  if (!built) {
    built = (async () => {
      if (!existsSync(join(REPO, 'scripts/app-runtime.mjs'))) blocked("no scripts/app-runtime.mjs, so the app's runtime folder can't be built (design: Starting from nothing)");
      const dir = join(CACHE, head().slice(0, 12));
      const out = join(dir, kind === 'plain' ? 'runtime' : 'runtime-system-git');
      const done = join(out, '.da1349-built');
      if (existsSync(done)) return out;
      const archives = join(dir, 'archives');
      if (!existsSync(join(archives, 'manifest.json'))) {
        rmSync(archives, { recursive: true, force: true });
        mkdirSync(archives, { recursive: true });
        const packed = await runFor(NODE, [join(REPO, 'scripts/release-pack.mjs'), '--repo', REPO, '--commit', 'HEAD', '--out', archives], { cwd: REPO, env: CARGO_ENV, timeoutMs: 60 * MIN });
        if (packed.code !== 0 || !existsSync(join(archives, 'manifest.json'))) blocked(`the release's archives couldn't be made: node scripts/release-pack.mjs --repo <checkout> --commit HEAD --out ${archives}: ${shown(packed)}`);
      }
      rmSync(out, { recursive: true, force: true });
      const args = [join(REPO, 'scripts/app-runtime.mjs'), '--archives', archives, '--out', out, ...(kind === 'system-git' ? ['--plant', 'system-git'] : [])];
      const made = await runFor(NODE, args, { cwd: REPO, env: CARGO_ENV, timeoutMs: 120 * MIN });
      if (made.code !== 0 || !existsSync(join(out, 'bin', 'deep'))) blocked(`the app's runtime folder (${kind}) couldn't be built: node ${args.slice(0).join(' ')}: ${shown(made)}`);
      writeFileSync(done, `${new Date().toISOString()}\n`);
      return out;
    })();
    runtimes.set(kind, built);
  }
  return built;
}

const target = (name: string): string => join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name);
const drives = new Map<string, Promise<string>>();
/** The replica, `deep-drive`: as shipped, or with `env-plants` so DEEP_HUB_PLANT selects an app plant; each copied out under its own name. */
export function driveBin(planted: boolean): Promise<string> {
  if (process.platform !== 'darwin') blocked(`the app and its replica draw on macOS only; this is ${process.platform}`);
  const key = planted ? 'deep-drive-plants' : 'deep-drive-plain';
  let built = drives.get(key);
  if (!built) {
    built = (async () => {
      if (planted) await driveBin(false);
      const args = ['build', '--locked', '-q', '-p', 'deep-replica', '--bin', 'deep-drive', ...(planted ? ['--features', 'env-plants'] : [])];
      const r = await runFor('cargo', args, { cwd: REPO, env: CARGO_ENV, timeoutMs: 90 * MIN });
      if (r.code !== 0) blocked(`cargo ${args.join(' ')} failed: ${shown(r)}`);
      mkdirSync(join(CACHE, 'bin'), { recursive: true });
      const out = join(CACHE, 'bin', key);
      copyFileSync(target('deep-drive'), out);
      return out;
    })();
    drives.set(key, built);
  }
  return built;
}

// ---- The model: a 127.0.0.1 server the runner's forwarder reaches as api.anthropic.com:443 (README: Stand-ins).

export interface Asked { at: number; prompt: string; signedIn: boolean; answered?: 'answer' | 'authentication_failed' | 'none' }
export class Model {
  readonly asked: Asked[] = [];
  private readonly answers: { match: string; answer: Line; gate?: string }[] = [];
  private readonly opened = new Set<string>();
  private constructor(private readonly server: http.Server, readonly url: string, private readonly signedIn: () => boolean) {}
  static async start(signedIn: () => boolean): Promise<Model> {
    let model: Model | undefined;
    const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    server.on('connect', (_req: http.IncomingMessage, socket: net.Socket, early: Buffer) => {
      socket.on('error', () => undefined);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      let buffer = early.toString('utf8');
      const take = (): void => {
        const at = buffer.indexOf('\n');
        if (at < 0) return;
        socket.removeAllListeners('data');
        let prompt = '';
        try { prompt = String((JSON.parse(buffer.slice(0, at)) as Line).prompt ?? ''); } catch { /* not JSON */ }
        void model!.reply(prompt).then((line) => { if (!socket.destroyed) socket.end(`${line}\n`); });
      };
      socket.setEncoding('utf8').on('data', (d: string) => { buffer += d; take(); });
      take();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    model = new Model(server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, signedIn);
    return model;
  }
  /** The research job's answer for prompts holding `match`; with `gate`, held until `open(gate)`. */
  answer(match: string, answer: Line, gate?: string): void { this.answers.push({ match, answer, ...(gate ? { gate } : {}) }); }
  open(gate: string): void { this.opened.add(gate); }
  private async reply(prompt: string): Promise<string> {
    const asked: Asked = { at: Date.now(), prompt, signedIn: this.signedIn() };
    this.asked.push(asked);
    const entry = this.answers.find((a) => prompt.includes(a.match));
    if (entry?.gate) for (const end = Date.now() + 20 * MIN; !this.opened.has(entry.gate) && Date.now() < end;) await sleep(200);
    // The model refuses a sign-in that isn't there when it answers, as the API refuses an expired token.
    if (!this.signedIn()) { asked.answered = 'authentication_failed'; return JSON.stringify({ error: 'authentication_failed' }); }
    asked.answered = entry ? 'answer' : 'none';
    return JSON.stringify(entry ? { answer: entry.answer } : { error: 'no answer for this prompt' });
  }
  /** How many runs of the agent its prompt held these words in. */
  reached(words: string): Asked[] { return this.asked.filter((a) => a.prompt.includes(words)); }
  async close(): Promise<void> { this.server.closeAllConnections(); await new Promise<void>((resolve) => this.server.close(() => resolve())); }
}

// ---- The fixture machine (README: The fixture machine).

const VERSION = (JSON.parse(readFileSync(join(REPO, 'adapters', 'claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
/** The account the person signs in to, as Claude Code's own sign-in writes it to ~/.claude.json. */
const ACCOUNT = '1349aaaa-1111-4222-8333-555555555555';
/** Programs a clean Mac doesn't have: the first three are macOS's developer-tools shims there, `node` is absent. */
export const REFUSING = ['git', 'xcrun', 'cc', 'node'] as const;

export interface Canaries { installer: string; probe: string; signIn: string; token: string; refresh: string }
export interface World {
  tmp: string; home: string; root: string; sys: string; state: string; plant?: string; runtime?: string;
  model: Model; canaries: Canaries; env: NodeJS.ProcessEnv;
}
const worlds: World[] = [];

const credentialShaped = (kind: string): string => `sk-ant-${kind}01-${randomBytes(30).toString('base64url')}`;
const script = (path: string, lines: string[]): void => { writeFileSync(path, ['#!/bin/sh', ...lines, ''].join('\n')); chmodSync(path, 0o755); };
const q = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;
const STRIP = /^(ANTHROPIC_|OPENAI_|AWS_|CLAUDE|CODEX|DEEP_|XDG_|GIT_|GH_|GITHUB_|HTTPS?_PROXY$|https?_proxy$|ALL_PROXY$|all_proxy$|NO_PROXY$|no_proxy$|NODE_OPTIONS$)/;

/**
 * A fixture machine with no agent and no developer tools. `<tmp>/sys` comes first on the system PATH and holds the
 * refusing, logging `git`, `xcrun`, `cc` and `node` (each logs to `<tmp>/refused.log`); `launchctl` and `systemctl`
 * (log, exit 0); `sh-login`, the login shell, whose PATH is `<tmp>/sys` and the system's folders; and `launcher`, the
 * login service stand-in (#1100's fixtures/launcher.mjs, run by this Node's path) with the hub's test seams and the
 * model's address as its environment. The stand-in installer is `<tmp>/installer.sh` (DEEP_HUB_TEST_INSTALLER); the
 * stand-in `claude` it installs waits at `<tmp>/agent/claude`. The world is nobody signed in.
 */
export async function openWorld(o: { plant?: string; runtime?: string } = {}): Promise<World> {
  const tmp = realpathSync(mkdtempSync('/tmp/da1349-'));
  const home = join(tmp, 'h');
  const sys = join(tmp, 'sys');
  const state = join(tmp, 'agent');
  for (const d of [home, sys, state]) mkdirSync(d, { recursive: true });
  const canaries: Canaries = { installer: credentialShaped('ins'), probe: credentialShaped('prb'), signIn: credentialShaped('sgn'), token: credentialShaped('oat'), refresh: credentialShaped('ort') };
  const model = await Model.start(() => existsSync(join(state, 'signed-in')));
  const w: World = { tmp, home, root: join(home, '.deepbuild'), sys, state, ...(o.plant ? { plant: o.plant } : {}), ...(o.runtime ? { runtime: o.runtime } : {}), model, canaries, env: {} };
  worlds.push(w);

  const refused = join(tmp, 'refused.log');
  for (const name of REFUSING) {
    script(join(sys, name), [
      `# Stands in for ${name} on a clean Mac: ${name === 'node' ? 'absent' : "macOS's developer-tools shim, which asks to install them"}. It logs the call and refuses it.`,
      `printf '%s %s\\n' ${q(name)} "$*" >> ${q(refused)}`,
      name === 'node' ? `echo "sh: node: command not found" >&2; exit 127` : `echo "xcode-select: note: No developer tools were found, requesting install." >&2; exit 1`,
    ]);
  }
  for (const name of ['launchctl', 'systemctl']) script(join(sys, name), [`printf '%s %s\\n' ${q(name)} "$*" >> ${q(join(tmp, 'service.log'))}`, 'exit 0']);
  script(join(sys, 'sh-login'), [
    '# Your login shell, as setup reads it: its PATH is the system folders behind the refusing stand-ins. Login and',
    '# interactive flags are dropped, so no profile of the machine running the tests is read.',
    `PATH=${q(`${sys}:/usr/bin:/bin:/usr/sbin:/sbin`)}; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
  ]);
  writeFileSync(join(tmp, 'keychain.json'), '{}\n', { mode: 0o600 });
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  const seams: Record<string, string> = {
    DEEP_HUB_TEST_CONFIRM: join(tmp, 'confirm'), DEEP_HUB_TEST_KEYCHAIN: join(tmp, 'keychain.json'), DEEP_HUB_TEST_INSTALLER: join(tmp, 'installer.sh'),
    ...(o.plant && o.plant !== PLANT.systemGit ? { DEEP_HUB_PLANT: o.plant } : {}),
  };
  script(join(sys, 'launcher'), [
    "# The login service stand-in: #1100's launcher.mjs, given the hub's test seams and the model's address (README).",
    ...Object.entries({ ...seams, HTTPS_PROXY: model.url, https_proxy: model.url }).map(([k, v]) => `${k}=${q(v)}; export ${k}`),
    `exec ${q(NODE)} ${q(join(REPO, 'tests/acceptance/1100/fixtures/launcher.mjs'))} "$@"`,
  ]);

  // The stand-in claude, and the stand-in for its official installer, which puts it where that installer does.
  writeFileSync(join(state, 'claude'), readFileSync(join(SUITE, 'fixtures/claude.pl'), 'utf8').replace("'__VERSION__'", q(VERSION)).replace("'__STATE__'", q(state))
    .replace("'__PROBE__'", q(canaries.probe)).replace("'__SIGNIN__'", q(canaries.signIn)), { mode: 0o755 });
  const now = `$(/usr/bin/perl -MTime::HiRes=time -e 'printf "%d", time*1000')`;
  script(join(tmp, 'installer.sh'), [
    "# Stands in for Claude Code's official installer (DEEP_HUB_TEST_INSTALLER): it takes 2 s, prints a line holding a",
    '# credential-shaped canary, and puts the stand-in claude in ~/.local/bin, as the real one does.',
    `echo "start ${now}" >> ${q(join(tmp, 'installer.log'))}`,
    'echo "Setting up Claude Code..."',
    `echo "Using setup token ${canaries.installer}"`,
    'sleep 2',
    `mkdir -p ${q(join(home, '.local', 'bin'))}`,
    `cp ${q(join(state, 'claude'))} ${q(join(home, '.local', 'bin', 'claude'))}`,
    `chmod 755 ${q(join(home, '.local', 'bin', 'claude'))}`,
    'echo "Claude Code successfully installed! Location: ~/.local/bin/claude"',
    `echo "end ${now}" >> ${q(join(tmp, 'installer.log'))}`,
    'exit 0',
  ]);

  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) if (!STRIP.test(key)) env[key] = value;
  Object.assign(env, {
    HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), SHELL: join(sys, 'sh-login'), LC_ALL: 'C',
    PATH: `${sys}:/usr/bin:/bin:/usr/sbin:/sbin`, DEEP_HUB_LAUNCHER: join(sys, 'launcher'), DEEP_TEST_LAUNCHER_LOG: join(tmp, 'launched'), ...seams,
  });
  w.env = env;
  return w;
}
/** Stops every process the worlds started, by PID, and removes their folders. */
export async function closeWorlds(): Promise<void> {
  for (const w of worlds.splice(0)) {
    await stopPids(worldPids(w.tmp));
    await w.model.close().catch(() => undefined);
    rmSync(w.tmp, { recursive: true, force: true });
  }
  await stopPids([...owned].filter(living));
  owned.clear();
}

/** The person signs in, in the agent's own page: the probe reads signed in, ~/.claude.json names the account, the Keychain holds the token. */
export function signIn(w: World): void {
  writeFileSync(join(w.state, 'signed-in'), `${Date.now()}\n`);
  const file = join(w.home, '.claude.json');
  let mine: Line = {};
  try { mine = JSON.parse(readFileSync(file, 'utf8')) as Line; } catch { /* none yet */ }
  writeFileSync(file, `${JSON.stringify({ ...mine, oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'da1349@example.invalid', organizationName: 'da1349' } })}\n`);
  keychain(w, Date.now() + 8 * 3_600_000);
}
/** The sign-in lapses: the probe reads not signed in, the token in the Keychain is past its time, the model refuses it. */
export function lapse(w: World): void {
  rmSync(join(w.state, 'signed-in'), { force: true });
  keychain(w, Date.now() - 60_000);
}
function keychain(w: World, expiresAt: number): void {
  const value = JSON.stringify({ claudeAiOauth: { accessToken: w.canaries.token, refreshToken: w.canaries.refresh, expiresAt, scopes: ['user:inference'], subscriptionType: 'max' } });
  writeFileSync(join(w.tmp, 'keychain.json'), `${JSON.stringify({ 'Claude Code-credentials': value })}\n`, { mode: 0o600 });
}

// ---- The stand-ins' logs.

const linesOf = (file: string): string[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : []);
/** Every call to a refusing stand-in: `<program> <args>`. */
export const refusedCalls = (w: World): string[] => linesOf(join(w.tmp, 'refused.log'));
/** What the stand-in claude noted: `auth status`, `auth login`, `session`, `other <args>`. */
export const agentCalls = (w: World): string[] => linesOf(join(w.state, 'calls.log'));
/** The stand-in installer's own time, in ms, and how often it ran. */
export function installerRuns(w: World): { runs: number; ms: number } {
  const log = linesOf(join(w.tmp, 'installer.log'));
  const starts = log.filter((l) => l.startsWith('start ')).map((l) => Number(l.slice(6)));
  const ends = log.filter((l) => l.startsWith('end ')).map((l) => Number(l.slice(4)));
  return { runs: starts.length, ms: starts.reduce((sum, s, i) => sum + Math.max(0, (ends[i] ?? s) - s), 0) };
}
/** The installed DeepBuild: `~/.deepbuild/versions/current`, the folder Set up copied the app's runtime into. */
export const installed = (w: World, ...path: string[]): string => join(w.root, 'versions', 'current', ...path);

// ---- The replica: one `deep-drive --out <dir>` process, JSON lines in and out (#124's protocol).

export const FLICKS = 705_600_000;
export class Drive {
  private buffer = '';
  private readonly waiting: ((line: Line) => void)[] = [];
  private exited = false;
  private err = '';
  t = 0;
  private constructor(private readonly child: ChildProcess) {
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      this.buffer += d;
      for (let i = this.buffer.indexOf('\n'); i >= 0; i = this.buffer.indexOf('\n')) {
        const raw = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 1);
        let parsed: Line;
        try { parsed = JSON.parse(raw) as Line; } catch { parsed = { unparsed: raw }; }
        this.waiting.shift()?.(parsed);
      }
    });
    child.stderr!.setEncoding('utf8').on('data', (d: string) => { this.err = (this.err + d).slice(-4000); });
    child.on('exit', () => { this.exited = true; for (const wake of this.waiting.splice(0)) wake({ exited: true }); });
  }
  /** A replica in the world's home with the world's environment; `planted`: the env-plants build, so DEEP_HUB_PLANT selects an app plant. */
  static async start(w: World, planted = false): Promise<Drive> {
    const bin = await driveBin(planted);
    const out = join(w.tmp, `drive-${randomBytes(4).toString('hex')}`);
    mkdirSync(out, { recursive: true });
    const child = spawn(bin, ['--out', out], { cwd: REPO, env: { ...w.env, ...(w.plant && w.plant !== PLANT.systemGit ? { DEEP_HUB_PLANT: w.plant } : {}) }, stdio: ['pipe', 'pipe', 'pipe'] });
    own(child.pid);
    const d = new Drive(child);
    const ready = await d.next(600_000);
    if (ready.ready !== true) blocked(`deep-drive didn't say {"ready": true}: ${said(ready)} ${d.err.slice(-600)}`);
    return d;
  }
  private next(ms: number): Promise<Line> {
    if (this.exited) return Promise.resolve({ exited: true });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timedOut: ms }), ms);
      this.waiting.push((line) => { clearTimeout(timer); resolve(line); });
    });
  }
  async call(args: Line): Promise<Line> {
    const reply = this.next(600_000);
    this.child.stdin!.write(`${JSON.stringify(args)}\n`);
    const got = await reply;
    if (got.exited || got.timedOut || got.unparsed !== undefined) blocked(`deep-drive gave no JSON reply to ${String(args.call)}: ${said(got)} ${this.err.slice(-600)}`);
    if (typeof got.t === 'number') this.t = got.t;
    return got;
  }
  async must(what: string, args: Line): Promise<Line> {
    const reply = await this.call(args);
    if (reply.ok !== true) throw Error(`${what}: ${said(reply.error ?? reply, 800)}`);
    return reply;
  }
  async see(): Promise<Seen> {
    const r = await this.must('see', { call: 'see' });
    return { snapshot: r.snapshot as Seen['snapshot'], address: (r.address ?? null) as string | null };
  }
  wait(ms: number): Promise<Line> { return this.must(`waiting ${ms} ms`, { call: 'wait_for', wait_for: { t: this.t + Math.round((ms * FLICKS) / 1000) }, timeout: ms + 2000 }); }
  click(locator: Line, what: string): Promise<Line> { return this.must(what, { call: 'act', locator, act: { kind: 'click' } }); }
  async stop(): Promise<void> {
    try { this.child.stdin!.end(); } catch { /* closed */ }
    const deadline = Date.now() + 5000;
    while (!this.exited && Date.now() < deadline) await sleep(20);
    if (!this.exited) try { process.kill(this.child.pid!, 'SIGKILL'); } catch { /* gone */ }
  }
}

/** The replica's first launch in the world's home, as a fresh account opening the download, its runtime the world's (README: The contract, 1). */
export async function firstLaunch(w: World, planted = false): Promise<{ d: Drive; screen: Screen }> {
  const d = await Drive.start(w, planted);
  await d.must('launching the replica on its first launch', { call: 'launch', launch: { from: 'empty', setup: 'unfinished', clock: 'real', ...(w.runtime ? { runtime: w.runtime } : {}) } });
  await d.wait(1500);
  return { d, screen: screenOf(await d.see()) };
}
/** The whole window's nodes, the page's and the shell's. */
export const allNodes = (s: Screen): SNode[] => flat(s.seen.snapshot.tree);
/** The box, ready for your words: the window left the first-launch page, holds the box, and the keyboard is in it. */
export function boxFailures(s: Screen): string[] {
  const out: string[] = [];
  if (s.page?.id === FIRST_LAUNCH || s.seen.address === FIRST_LAUNCH) out.push(`the window is still on the first-launch page ${FIRST_LAUNCH}`);
  const box = allNodes(s).find((n) => n.id === 'box' || n.id === 'box-draft');
  if (!box) out.push(`the window holds no box (a node with id box or box-draft); it shows ${pageId(s)}`);
  const focus = (s.seen.snapshot as { focus?: unknown }).focus;
  if (focus !== 'box' && focus !== 'box-draft') out.push(`the keyboard isn't in the box: the snapshot's focus is ${said(focus)}`);
  return out;
}
export interface SetUp { pressed: number; ended: number; screen: Screen; ready: boolean; failures: string[] }
/** Presses Set up as a person does, then lets the clock run a second at a time until the box is ready or `ms` pass. */
export async function pressSetUp(d: Drive, ms = 10 * MIN): Promise<SetUp> {
  const pressed = Date.now();
  await d.click({ role: 'button', name: 'Set up' }, 'a press on the Set up button');
  for (;;) {
    await d.wait(1000);
    const screen = screenOf(await d.see());
    const failures = boxFailures(screen);
    if (!failures.length) return { pressed, ended: Date.now(), screen, ready: true, failures };
    if (Date.now() - pressed > ms) return { pressed, ended: Date.now(), screen, ready: false, failures };
  }
}

// ---- The hub, over its socket, as the app (`app`) or the CLI (`cli`) reaches it.

export function hubCall(w: World, method: string, params: Line = {}, role: 'app' | 'cli' = 'cli', timeoutMs = 60_000): Promise<{ result?: Line; error?: Line }> {
  const socket = join(w.root, 'hub.sock');
  const token = readFileSync(join(w.root, 'control.token'), 'utf8').trim();
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let buffer = '';
    let step = 0;
    const timer = setTimeout(() => { sock.destroy(); reject(Error(`no reply to ${method} within ${timeoutMs} ms`)); }, timeoutMs);
    sock.setEncoding('utf8');
    sock.on('error', (e) => { clearTimeout(timer); reject(e); });
    sock.on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line: Line | undefined;
        try { line = JSON.parse(buffer.slice(0, i)) as Line; } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (step === 0) { step = 1; sock.write(`${JSON.stringify({ v: 1, hello: role, token })}\n`); }
        else if (step === 1 && line?.role !== undefined) { step = 2; sock.write(`${JSON.stringify({ v: 1, id: 1, method, params })}\n`); }
        else if (step === 1 && line?.error) { clearTimeout(timer); sock.destroy(); resolve({ error: line.error as Line }); }
        else if (step === 2 && line?.id === 1) { clearTimeout(timer); sock.destroy(); resolve(line.error ? { error: line.error as Line } : { result: (line.result ?? {}) as Line }); }
      }
    });
  });
}
/** Whether the hub answers at ~/.deepbuild/hub.sock within `ms`. */
export async function hubAnswers(w: World, ms = 60_000): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(500)) {
    if (!existsSync(join(w.root, 'control.token'))) continue;
    try { if ((await hubCall(w, 'events.read', { after: 0, limit: 1 }, 'cli', 5000)).result) return true; } catch { /* not yet */ }
  }
  return false;
}
export interface Ev { id: string; kind: string; subject?: string; ts: number; data: Line; log_pos: number }
export async function events(w: World): Promise<Ev[]> {
  const all: Ev[] = [];
  for (let after = 0; ;) {
    const reply = await hubCall(w, 'events.read', { after, limit: 1000 });
    if (reply.error) blocked(`events.read refused: ${said(reply.error)}`);
    const page = (reply.result?.events ?? []) as Ev[];
    if (!page.length) return all;
    all.push(...page);
    after = page[page.length - 1]!.log_pos;
  }
}
export const lastPos = async (w: World): Promise<number> => (await events(w)).at(-1)?.log_pos ?? 0;
export async function waitFor<T>(probe: () => Promise<T | undefined | false> | T | undefined | false, ms: number, everyMs = 1000): Promise<T | undefined> {
  for (const end = Date.now() + ms; ;) {
    const v = await probe();
    if (v !== undefined && v !== false) return v;
    if (Date.now() >= end) return undefined;
    await sleep(everyMs);
  }
}

/** The app's Send: `box.say` with your words, on the app's connection, as the box sends them (#1342's route). */
export async function send(w: World, words: string): Promise<{ at: number; since: number; reply: Line }> {
  const since = await lastPos(w);
  const at = Date.now();
  const reply = await hubCall(w, 'box.say', { words }, 'app').catch((e: unknown) => ({ error: { message: String(e) } }));
  return { at, since, reply };
}
/** The sign-in row's button: `signin.open` for the row's task, on the app's connection (README: The contract, 5). */
export const pressSignIn = (w: World, task: string): Promise<{ result?: Line; error?: Line }> => hubCall(w, 'signin.open', { ask: task }, 'app');

/** A sign-in task: an unblock ask whose question says sign in, raised after `since`. */
export const SIGN_IN = /\bsign(?:ed)?[\s-]?in\b/i;
export const signInTasks = (all: readonly Ev[], since: number): Ev[] =>
  all.filter((e) => e.kind === 'ask.created' && e.log_pos > since && e.data?.kind === 'unblock' && SIGN_IN.test(String(e.data?.question ?? '')));
const CLOSING = ['ask.moot', 'ask.answered', 'ask.cancelled', 'ask.superseded', 'ask.defaulted', 'ask.taken_over', 'ask.machine'];
/** The event that closed an ask, if any. */
export const closing = (all: readonly Ev[], ask: Ev): Ev | undefined => all.find((e) => CLOSING.includes(e.kind) && e.subject === `ask:${ask.id}`);
export const openSignIns = (all: readonly Ev[]): Ev[] => signInTasks(all, 0).filter((a) => !closing(all, a));

/** The cards raised after `since`: each `brief.drafted` with the authority ask it names (#1342's contract, 4). */
export interface Card { ask: string; created: Ev; brief: Line }
export const cards = (all: readonly Ev[], since: number): Card[] => all.filter((e) => e.kind === 'brief.drafted' && e.log_pos > since).flatMap((d) => {
  const created = all.find((e) => e.kind === 'ask.created' && `ask:${e.id}` === String(d.data.ask));
  return created ? [{ ask: String(d.data.ask), created, brief: d.data.brief as Line }] : [];
});
/** `~/.deepbuild/versions/current/bin/deep`, the installed launcher, with the world's environment. */
export const deep = (w: World, args: readonly string[], timeoutMs = 5 * MIN): Promise<Ran> => runFor(installed(w, 'bin', 'deep'), args, { cwd: w.tmp, env: w.env, timeoutMs });
/** The card answered yes on the trusted path with `deep inbox answer`; what the command said. */
export async function approve(w: World, card: Card): Promise<Ran> {
  const yes = ((card.created.data.options ?? []) as { id: string; decision?: string }[]).find((x) => x.decision === 'allow');
  if (!yes) return { code: null, stdout: '', stderr: `the card ${card.ask} offers no yes: ${said(card.created.data.options)}` };
  return deep(w, ['inbox', 'answer', card.ask, yes.id]);
}
/** The shipped git, `~/.deepbuild/versions/current/git/bin/git`, run as the tests' own reader of a workspace's history. */
export function shippedGit(w: World, folder: string, ...args: string[]): Ran {
  const r = spawnSync(installed(w, 'git', 'bin', 'git'), ['-C', folder, '-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8', env: { HOME: w.home, PATH: `${w.sys}:/usr/bin:/bin`, GIT_CONFIG_NOSYSTEM: '1', LC_ALL: 'C' } });
  return { code: r.status, stdout: r.stdout ?? '', stderr: `${r.stderr ?? ''}${r.error ? `[${r.error.message}]` : ''}` };
}

// ---- Judges.

/** AC8's screen half: the install step the first screen lists, `setup-step:install:<agent>`, and that agent's row saying Set up installs it. */
export function installOnScreen(s: Screen): { agent?: string; failures: string[] } {
  if (!s.page) return { failures: [`the window shows no one page (a node whose id is an address); address ${said(s.seen.address)}`] };
  const out: string[] = [];
  if (s.page.id !== FIRST_LAUNCH) out.push(`the window shows ${pageId(s)}, not the first-launch page ${FIRST_LAUNCH}`);
  const steps = [...new Set(s.ids.filter((id) => id.startsWith('setup-step:install:')).map((id) => id.slice('setup-step:install:'.length)))];
  if (steps.length !== 1) return { failures: [...out, `the first screen lists ${steps.length} install steps (nodes setup-step:install:<agent>), not one: ${said(steps)}; its ids are ${said(s.ids, 600)}`] };
  const agent = steps[0]!;
  const row = byId(s, `setup-agent:${agent}`);
  const name = AGENT_NAMES[agent] ?? agent;
  if (!row) out.push(`the first screen lists the install step for ${agent} and has no row for it (setup-agent:${agent})`);
  else if (!wordsOf(row).includes(name) || !/\binstall/i.test(wordsOf(row))) out.push(`the ${name} row doesn't say Set up installs it: ${said(wordsOf(row))}`);
  return { agent, failures: out };
}
/** AC8's record half: setup's `install` events name exactly the agent the screen named. Its failure names both. */
export function installEventFailures(screenAgent: string | undefined, all: readonly Ev[]): string[] {
  const installs = all.filter((e) => e.kind === 'setup.step' && e.data?.step === 'install');
  const agents = [...new Set(installs.map((e) => String(e.data?.agent)))];
  const screen = screenAgent ? AGENT_NAMES[screenAgent] ?? screenAgent : 'no agent';
  if (!installs.length) return [`the record holds no setup.step event for the install step; the first screen's row named ${screen}`];
  return agents.filter((a) => a !== screenAgent).map((a) => `the first screen's row named ${screen} (${screenAgent}) before the click, and setup's install event names ${AGENT_NAMES[a] ?? a} (${a})`);
}
/** AC6's check: a sign-in task closed while the probe still read not signed in fails, naming the probe. */
export function closedEarly(all: readonly Ev[], task: Ev, signedInAt: number | undefined): string[] {
  const closed = closing(all, task);
  if (!closed) return [];
  if (signedInAt !== undefined && closed.ts >= signedInAt) return [];
  return [`the sign-in task ask:${task.id} closed (${closed.kind} ${said(closed.data, 200)}) at ${new Date(closed.ts).toISOString()} while the probe, claude auth status, still read not signed in`];
}
/** AC4: one plain line, the sign-in task's question: one line, short, no exit status, output, path or credential, and no terminal. */
export function plainLineFailures(question: string, c: Canaries): string[] {
  const out: string[] = [];
  if (/[\r\n]/.test(question)) out.push(`the line runs over more than one line: ${said(question)}`);
  if (question.length > 200) out.push(`the line is ${question.length} characters, not one plain line: ${said(question)}`);
  if (/exit (status|code)|exited with|\bstatus:? \d|stack|Error:|\{|\}|\/Users\/|\/tmp\//i.test(question)) out.push(`the line holds an exit status, an error, output or a path: ${said(question)}`);
  if (/terminal|\/login/i.test(question)) out.push(`the line sends you to a terminal: ${said(question)}`);
  if (Object.values(c).some((v) => question.includes(v))) out.push(`the line holds a credential: ${said(question)}`);
  if (!question.includes('Claude Code')) out.push(`the line doesn't name the agent, Claude Code: ${said(question)}`);
  return out;
}
/** Words shaped like a credential: an Anthropic key or token, a token field with a value, a bearer header. */
export const CREDENTIAL = [/sk-ant-[a-z]{2,5}\d{2}-[A-Za-z0-9_-]{16,}/, /"(access|refresh)_?[Tt]oken"\s*:\s*"[^"]{8,}"/, /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/];
/** AC3: every file under DeepBuild's state folder (the program folders under versions/ left out), searched for each canary in every form and for anything credential-shaped. */
export function credentialHits(root: string, c?: Canaries): string[] {
  const files = walk(root).filter((f) => !f.startsWith(`${join(root, 'versions')}/`));
  const list: Canary[] = c ? Object.entries(c).map(([name, value]) => ({ name: `the ${name} canary`, forms: everyForm(value) })) : [];
  const hits: string[] = [];
  const tmp = mkdtempSync('/tmp/da1349-scan-');
  try {
    // sweep() walks a folder and reads extra files: it walks an empty one and reads these, so versions/ stays out.
    for (const file of files) {
      const text = readFileSync(file).toString('latin1');
      for (const re of CREDENTIAL) { const m = re.exec(text); if (m) hits.push(`${file}: credential-shaped ${said(m[0].slice(0, 16))}…`); }
    }
    if (list.length) hits.push(...sweep(tmp, list, files));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
  return [...new Set(hits)];
}

/** A budget: past it with the 1-minute load at or above the core count reads INCONCLUSIVE (a skip, never a pass). */
export function withinBudget(ctx: TestContext, ms: number, budget: number, what: string): void {
  if (ms <= budget) return;
  const load = loadavg()[0]!;
  const cores = availableParallelism();
  if (load >= cores) ctx.skip(`INCONCLUSIVE: ${what} took ${ms} ms, past ${budget} ms, at a 1-minute load of ${load.toFixed(1)} on ${cores} cores`);
  expect(ms, `${what} within ${budget} ms (1-minute load ${load.toFixed(1)} on ${cores} cores)`).toBeLessThanOrEqual(budget);
}
/** Asserts a judgement fails on a planted wrong program, and that its failure names each of `want`. */
export function mustName(what: string, failures: readonly string[], want: readonly string[]): void {
  const text = failures.join('\n');
  expect(failures.length, `${what}: the judgement must fail on the planted program, and it passed`).toBeGreaterThan(0);
  for (const w of want) expect(text, `${what}: its failure must name ${w}`).toContain(w);
}

// ---- The clean account's evidence (README: The contract, 9), read from a copy of its ~/.deepbuild.

export const EVIDENCE = join(REPO, 'docs', 'evidence', '1349');
/** The events in a copy of a record, `ledger.db`, read-only. */
export function recordCopy(root: string): Ev[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try {
    return (db.prepare('SELECT id, kind, subject, ts, data, log_pos FROM events ORDER BY log_pos').all() as { id: string; kind: string; subject: string | null; ts: number; data: string; log_pos: number }[])
      .map((r) => ({ id: r.id, kind: r.kind, ...(r.subject ? { subject: r.subject } : {}), ts: Number(r.ts), log_pos: Number(r.log_pos), data: (() => { try { return JSON.parse(r.data) as Line; } catch { return {}; } })() }));
  } finally { db.close(); }
}

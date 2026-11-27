// A real paseo daemon for #3429's first criterion (README, The worlds): the pinned release from DEEP_PASEO_CLI, as
// #55's real.test.ts needs it, in a folder of its own under /private/tmp/dh3429-* (short, for its sockets). HOME is
// <folder>/h for every process, so paseo's home is <folder>/h/.paseo and the real ~/.paseo is never touched; the daemon
// listens on a free port of its own on 127.0.0.1 with its relay off and fetches no speech model. Processes are stopped
// by the process group this file started, never by name or port. Node's own modules alone: it needs no build.
// First: what you gave the suite by hand (#55 D1).
import { given } from '../55/env.ts';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { pinned } from './run.ts';

export type Line = { [key: string]: any };
export const NODE = process.execPath;

/** Waits for what `probe` gives. A wait that runs out reads BLOCKED: the daemon didn't do its part, so nothing was shown. */
export async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, ms: number, what: () => string, step = 200): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const got = await probe();
    if (got) return got;
    if (Date.now() > end) throw Error(`BLOCKED: timed out after ${ms} ms waiting for ${what()}`);
    // deadline: spaces the polls of a wait for an observed condition, bounded by `ms`.
    await new Promise((done) => setTimeout(done, step));
  }
}
/** The JSON a paseo command printed, after any line of words before it. */
export const jsonIn = (text: string): Line => JSON.parse(text.slice(Math.min(...['{', '['].map((c) => text.indexOf(c)).filter((i) => i >= 0)))) as Line;
const freePort = (): Promise<number> => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address() as net.AddressInfo; s.close(() => resolve(port)); });
});

const daemons = new Set<Daemon>();
export interface Ran { code: number | null; stdout: string; stderr: string }
export class Daemon {
  private out = '';
  private constructor(readonly cli: string, readonly dir: string, readonly root: string, readonly env: NodeJS.ProcessEnv, readonly child: ChildProcess) {
    for (const stream of [child.stdout!, child.stderr!]) stream.setEncoding('utf8').on('data', (d: string) => { this.out = (this.out + d).slice(-20_000); });
  }
  /**
   * `paseo daemon run` with plugins on and `providers` under agents.providers of its config.json. `DEEP_PASEO_CLI` is
   * the `paseo` command of @getpaseo/cli at the version the facts pin: missing or another version is BLOCKED, never a skip.
   */
  static async start(providers: Line): Promise<Daemon> {
    const cli = given.DEEP_PASEO_CLI;
    if (!cli || !existsSync(cli)) throw Error(`BLOCKED: no real paseo: set DEEP_PASEO_CLI to the paseo command of @getpaseo/cli ${pinned()} (it ${cli ? 'names no file' : 'is not set'})`);
    const dir = realpathSync(mkdtempSync('/private/tmp/dh3429-'));
    const home = join(dir, 'h');
    const root = join(home, '.paseo');
    mkdirSync(root, { recursive: true });
    const env = { PATH: `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`, HOME: home, TMPDIR: dir, LC_ALL: 'C', PASEO_DICTATION_ENABLED: 'false', PASEO_VOICE_MODE_ENABLED: 'false' };
    let version: string;
    try { version = execFileSync(cli, ['--version'], { encoding: 'utf8', env, cwd: dir }).trim().replace(/^v/, ''); } catch (error) { rmSync(dir, { recursive: true, force: true }); throw Error(`BLOCKED: DEEP_PASEO_CLI doesn't run: ${String((error as Error).message).split('\n')[0]}`); }
    if (version !== pinned()) { rmSync(dir, { recursive: true, force: true }); throw Error(`BLOCKED: DEEP_PASEO_CLI is paseo ${version}; the facts pin ${pinned()}, the version this test runs on`); }
    writeFileSync(join(root, 'config.json'), `${JSON.stringify({ version: 1, daemon: { listen: `127.0.0.1:${await freePort()}`, relay: { enabled: false } }, pluginsEnabled: true, agents: { providers } }, null, 2)}\n`);
    const child = spawn(cli, ['daemon', 'run', '--home', root], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const daemon = new Daemon(cli, dir, root, env, child);
    daemons.add(daemon);
    await until(() => /Listening on/.test(daemon.out) || child.exitCode !== null, 180_000, () => `paseo's daemon to listen: ${daemon.out.slice(-800)}`);
    if (child.exitCode !== null) throw Error(`BLOCKED: paseo's daemon exited ${child.exitCode}: ${daemon.out.slice(-2000)}`);
    return daemon;
  }
  output(): string { return this.out; }
  /** A folder of this daemon's own, for an agent to work in. */
  folder(name: string): string {
    const dir = join(this.dir, name);
    mkdirSync(dir);
    return dir;
  }
  /** One paseo command against this daemon's home. */
  run(args: readonly string[], ms = 180_000): Promise<Ran> {
    return new Promise((resolve) => {
      const child = spawn(this.cli, ['--home', this.root, ...args], { cwd: this.dir, env: this.env, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout += d; });
      child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr += d; });
      // deadline: a paseo command that never ends is stopped, by its PID, and reads as one that failed.
      const timer = setTimeout(() => child.kill('SIGKILL'), ms);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    });
  }
  /** A plugin installed from a directory and running. */
  async install(dir: string, id: string): Promise<void> {
    const installed = await this.run(['plugin', 'install', dir]);
    if (installed.code !== 0) throw Error(`BLOCKED: paseo plugin install of ${id} exited ${installed.code}: ${installed.stdout} ${installed.stderr}`);
    await until(async () => {
      const ls = await this.run(['plugin', 'ls', '--json']);
      const got = ls.code === 0 ? jsonIn(ls.stdout) : [];
      return ((Array.isArray(got) ? got : got.plugins ?? []) as Line[]).some((p) => (p.id ?? p.plugin) === id && p.status === 'running');
    }, 120_000, () => `paseo plugin ${id} running; daemon output ${this.out.slice(-800)}`, 500);
  }
  /** The daemon and what it started, by the process group this file made; then its folder. */
  async stop(): Promise<void> {
    if (!daemons.delete(this)) return;
    const pid = this.child.pid;
    if (pid && this.child.exitCode === null) {
      await new Promise<void>((done) => {
        // deadline: a daemon that ignores SIGTERM for 10 s is killed, with its group.
        const timer = setTimeout(done, 10_000);
        this.child.once('exit', () => { clearTimeout(timer); done(); });
        try { process.kill(-pid, 'SIGTERM'); } catch { /* gone */ }
      });
      try { process.kill(-pid, 'SIGKILL'); } catch { /* gone */ }
    }
    rmSync(this.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
export async function cleanup(): Promise<void> {
  for (const daemon of [...daemons]) await daemon.stop();
}

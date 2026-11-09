// Test-side tools for #41's npm packaging criteria (AC1, AC9, AC19, AC21): temp folders, child processes stopped by PID,
// planted npm packages packed with the real `npm pack`, and the release's own archives made from this repository's
// committed HEAD through scripts/release-pack.mjs. Nothing here stands in for DeepBuild; the scripts under test are
// reached only through the command lines pinned in each test file's header.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url)).replace(/\/$/, '');
export const NODE = process.execPath;
export const NPM = join(dirname(NODE), 'npm');
export const script = (name: string) => join(REPO, 'scripts', name);
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export const AC1 = 'AC1 #41.a90a4093';
export const AC9 = 'AC9 #41.6d07af40';
export const AC19 = 'AC19 #41.13231c35';
export const AC21 = 'AC21 #41.7e835721';
/** This machine's per-platform deep-hook package, as the issue names them: deep-hook as per-platform optional packages. */
export const PLATFORM_PACKAGE = `@deepbuild/deep-hook-${process.platform}-${process.arch}`;

/** User-level git hooks can reach the network; every git this suite runs, and every git a script it starts runs, skips them. */
export const GIT_ENV = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/dev/null' };

// ---- Temp folders, short real paths under /tmp; removed after the suite.
const made: string[] = [];
export function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(`/tmp/${prefix}`));
  made.push(dir);
  return dir;
}
/** A folder under this checkout's ignored target/, which a container runtime on a Mac shares (it may not share /tmp). */
export function sharedDir(prefix: string): string {
  mkdirSync(join(REPO, 'target'), { recursive: true });
  const dir = realpathSync(mkdtempSync(join(REPO, 'target', prefix)));
  made.push(dir);
  return dir;
}

// ---- Child processes: every one this suite starts is tracked by PID and stopped by PID.
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error?: string }
const owned = new Set<number>();
export function run(command: string, args: readonly string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let error: string | undefined;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { error = `killed at ${o.timeoutMs} ms`; child.kill('SIGKILL'); }, o.timeoutMs);
    child.on('error', (e) => { error = e.message; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (child.pid) owned.delete(child.pid);
      resolve({ code, signal, stdout, stderr, ...(error ? { error } : {}) });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export const shown = (r: Ran, max = 4000) =>
  `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.error ? `, ${r.error}` : ''}\n--- stdout\n${r.stdout.slice(-max)}\n--- stderr\n${r.stderr.slice(-max)}`;
export async function cleanup(): Promise<void> {
  for (const pid of owned) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** This process's environment without anything that points DeepBuild, git or npm at a host copy or a real registry. */
export function scrubbedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(DEEP_|GIT_|npm_|NPM_|NODE_|XDG_|CLAUDE|CODEX)/i.test(k)) continue;
    env[k] = v;
  }
  env.PATH = `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  return { ...env, ...GIT_ENV, ...extra };
}

// ---- Planted npm packages, packed with the real `npm pack`.
export type Files = Record<string, string | Buffer | { body: string | Buffer; mode: number }>;
export function put(root: string, files: Files): void {
  for (const [p, f] of Object.entries(files)) {
    const path = join(root, p);
    mkdirSync(dirname(path), { recursive: true });
    const body = typeof f === 'string' || Buffer.isBuffer(f) ? f : f.body;
    writeFileSync(path, body);
    chmodSync(path, typeof f === 'string' || Buffer.isBuffer(f) ? 0o644 : f.mode);
  }
}
/** Packs the package folder `dir` into `dest` with `npm pack --ignore-scripts`; the archive's file name. */
export function npmPack(dir: string, dest: string): string {
  mkdirSync(dest, { recursive: true });
  const r = spawnSync(NPM, ['pack', '--json', '--ignore-scripts', '--pack-destination', dest], { cwd: dir, env: scrubbedEnv({ npm_config_registry: 'http://127.0.0.1:9/' }), encoding: 'utf8' });
  if (r.status !== 0) throw Error(`npm pack in ${dir} failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as Array<{ filename: string }>)[0]!.filename;
}
/** A release-pack-shaped folder: each package packed into `out`, and manifest.json as pack.test.ts pins it. */
export function releaseFolder(packages: Record<string, Files>, out: string): string {
  const src = tempDir('dh41rs-');
  const archives: Array<{ name: string; file: string; sha256: string }> = [];
  for (const [i, files] of Object.values(packages).entries()) {
    const dir = join(src, String(i));
    put(dir, files);
    const file = npmPack(dir, out);
    archives.push({ name: (JSON.parse(String(files['package.json'])) as { name: string }).name, file, sha256: sha256(readFileSync(join(out, file))) });
  }
  writeFileSync(join(out, 'manifest.json'), `${JSON.stringify({ commit: '0'.repeat(40), archives }, null, 2)}\n`);
  return out;
}
/** One file of an archive, read from the archive's own bytes. */
export function fromArchive(tgz: string, path: string): Buffer | undefined {
  const r = spawnSync('tar', ['-xzOf', tgz, path], { maxBuffer: 1 << 28 });
  return r.status === 0 ? r.stdout : undefined;
}

// ---- Network observation on loopback.
/** A TCP listener that counts every connection made to it and answers none usefully. */
export async function tripwire(): Promise<{ url: string; port: number; count: () => number; close: () => Promise<void> }> {
  let n = 0;
  const server = net.createServer((sock) => { n += 1; sock.destroy(); });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/`, port, count: () => n, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
/** Whether anything accepts a TCP connection at the URL's host and port. */
export function answers(url: string, timeoutMs = 3000): Promise<boolean> {
  const u = new URL(url);
  return new Promise((resolve) => {
    const sock = net.connect({ host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port || 80) });
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
}

// ---- The release's own archives, made from this repository.
export interface Release { out: string; commit: string; manifest: { commit: string; archives: Array<{ name: string; file: string; sha256: string }> } }
let releasing: Promise<Release> | undefined;
/**
 * The archives the release makes: this checkout's committed HEAD fetched into a fresh shallow clone (so the working
 * tree's uncommitted files never ride along), then `node scripts/release-pack.mjs --repo <clone> --commit <HEAD> --out
 * <out>` as pack.test.ts pins it. The run is offline: npm's registry points at a closed loopback port with
 * npm_config_offline=true, and CARGO_NET_OFFLINE=true, so any build step takes its dependencies from the local caches.
 * Made once per test file.
 */
export function release(): Promise<Release> {
  releasing ??= (async () => {
    const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8', env: scrubbedEnv() }).stdout.trim();
    const dir = tempDir('dh41rr-');
    const clone = join(dir, 'repo');
    const out = join(dir, 'out');
    const env = scrubbedEnv({ npm_config_registry: 'http://127.0.0.1:9/', npm_config_offline: 'true', CARGO_NET_OFFLINE: 'true', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
    for (const args of [['init', '-q', clone], ['-C', clone, 'fetch', '-q', '--depth', '1', `file://${REPO}`, commit], ['-C', clone, 'checkout', '-q', '--detach', 'FETCH_HEAD']]) {
      const r = await run('git', args, { cwd: dir, env, timeoutMs: 1_800_000 });
      if (r.code !== 0) throw Error(`git ${args.join(' ')}: ${shown(r)}`);
    }
    const r = await run(NODE, [script('release-pack.mjs'), '--repo', clone, '--commit', commit, '--out', out], { cwd: dir, env, timeoutMs: 3_600_000 });
    if (r.code !== 0 || !existsSync(join(out, 'manifest.json'))) throw Error(`the release made no archives from ${commit}: release-pack ${shown(r)}`);
    return { out, commit, manifest: JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as Release['manifest'] };
  })();
  return releasing;
}
/** The release's `deepbuild` archive and its version, or a failure naming what the release made instead. */
export function rootArchive(rel: Release): { file: string; version: string } {
  const a = rel.manifest.archives.find((x) => x.name === 'deepbuild');
  if (!a) throw Error(`the release made no deepbuild archive; it made: ${rel.manifest.archives.map((x) => x.name).join(', ') || 'nothing'}`);
  const meta = fromArchive(join(rel.out, a.file), 'package/package.json');
  if (!meta) throw Error(`the deepbuild archive ${a.file} holds no package/package.json`);
  return { file: a.file, version: (JSON.parse(meta.toString('utf8')) as { version: string }).version };
}

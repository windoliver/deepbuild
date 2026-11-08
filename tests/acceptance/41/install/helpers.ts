// Test-side tools for #41's install suite: signed test releases, the installer loaded through its pinned surface, temp
// homes with stand-ins for the login service and the system tools setup reaches, the files setup writes read back from
// disk, and the judges that say whether an entry names a fixed path and runs the newest version. Nothing here stands in
// for DeepBuild: the installer is packages/hub/src/installer.ts, setup is the built `deep setup`, the hub is the built
// CLI's `deep hub run`. The surfaces are pinned in the header of installer.test.ts and update.test.ts.
//
// A test release is one version folder packed as a gzip'd tar whose entries are relative to that folder. It holds the
// release's two programs, `bin/deep` and `bin/deep-hook`, each an executable script that:
//   - with DEEP_TEST_PROBE set, prints its version and exits 0 ("a fake version whose bin prints its version");
//   - else, with DEEP_TEST_RAN set, appends `<version> <program> <args>` to that file, then execs this checkout's built
//     CLI (`node packages/cli/dist/main.js`) or deep-hook (`target/debug/deep-hook`) with its arguments,
// so setup, the hub and the hooks really run, and a test can tell which version's program ran.

import { spawn, spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
export const CLI = join(REPO, 'packages/cli/dist/main.js');
export const HOOK = join(REPO, 'target/debug/deep-hook');
export const NODE = process.execPath;
const LAUNCHER = fileURLToPath(new URL('./fixtures/launcher.mjs', import.meta.url));

export const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- The pinned installer surface.
export type FailAt = 'after-unpack' | 'before-switch' | 'during-switch';
export interface InstallArgs { home: string; archive: Buffer; manifest: Buffer; signature: Buffer; publicKey: string; failAt?: FailAt }
export type InstallVersion = (o: InstallArgs) => Promise<{ version: string }>;
/** packages/hub/src/installer.ts's installVersion; loaded per test, so a missing module fails each test, naming it. */
export async function installer(): Promise<InstallVersion> {
  const mod = (await import('../../../../packages/hub/src/installer.js')) as { installVersion?: unknown };
  if (typeof mod.installVersion !== 'function') throw Error('packages/hub/src/installer.ts must export installVersion(o: { home, archive, manifest, signature, publicKey, failAt? })');
  return mod.installVersion as InstallVersion;
}

// ---- Temp folders. Short real paths under /tmp: a Unix socket path must fit in 104 bytes on macOS.
const made: string[] = [];
export function tempDir(prefix = 'di41-'): string {
  const dir = realpathSync(mkdtempSync(`/tmp/${prefix}`));
  made.push(dir);
  return dir;
}

// ---- Test releases, signed with a key made here.
export interface Keys { publicKey: string; privateKey: KeyObject }
/** An Ed25519 pair: the public half as SPKI PEM, which is what installVersion's `publicKey` gets. */
export function keys(): Keys {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
}
const program = (version: string, name: 'deep' | 'deep-hook'): string => [
  '#!/bin/sh',
  `# DeepBuild ${version}'s ${name}, as the test's release ships it.`,
  `if [ -n "\${DEEP_TEST_PROBE:-}" ]; then echo '${version}'; exit 0; fi`,
  `if [ -n "\${DEEP_TEST_RAN:-}" ]; then printf '%s %s %s\\n' '${version}' '${name}' "$*" >> "$DEEP_TEST_RAN"; fi`,
  name === 'deep' ? `exec '${NODE}' '${CLI}' "$@"` : `exec '${HOOK}' "$@"`,
  '',
].join('\n');
/** Writes version `version`'s folder at `dir`: bin/deep and bin/deep-hook, executable. */
export function versionFolder(dir: string, version: string): void {
  mkdirSync(join(dir, 'bin'), { recursive: true });
  for (const name of ['deep', 'deep-hook'] as const) {
    writeFileSync(join(dir, 'bin', name), program(version, name));
    chmodSync(join(dir, 'bin', name), 0o755);
  }
}
/** A version folder packed as a gzip'd tar, entries relative to the folder (`tar -czf - -C <folder> .`). */
export function archiveOf(version: string): Buffer {
  const dir = join(tempDir('rel41-'), 'v');
  versionFolder(dir, version);
  const r = spawnSync('tar', ['-czf', '-', '-C', dir, '.'], { maxBuffer: 64 << 20 });
  if (r.status !== 0) throw Error(`BLOCKED: tar couldn't pack the test release: ${String(r.stderr)}`);
  return r.stdout;
}
export interface Release { version: string; archive: Buffer; manifest: Buffer; signature: Buffer }
/**
 * Release `version`: its archive, its manifest's bytes (JSON `{"version", "sha256"}`, sha256 the archive's, hex) and an
 * Ed25519 signature over exactly those bytes by `privateKey`. `manifest` overrides fields before signing.
 */
export function release(version: string, privateKey: KeyObject, o: { manifest?: Record<string, unknown>; archive?: Buffer } = {}): Release {
  const archive = o.archive ?? archiveOf(version);
  const manifest = Buffer.from(JSON.stringify({ version, sha256: sha(archive), ...o.manifest }));
  return { version, archive, manifest, signature: sign(null, manifest, privateKey) };
}

// ---- What is on disk.
/** Every path under `dir` with what it is: a link's target, a folder, a file's mode and digest. */
export function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(dir)) return out;
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const p = join(at, name);
      const s = lstatSync(p);
      const key = p.slice(dir.length + 1);
      if (s.isSymbolicLink()) out[key] = `link -> ${readlinkSync(p)}`;
      else if (s.isDirectory()) { out[key] = 'folder'; walk(p); }
      else out[key] = `file ${(s.mode & 0o777).toString(8)} ${sha(readFileSync(p))}`;
    }
  };
  walk(dir);
  return out;
}
/** The version folders under `<home>/versions`: real folders, never the `current` link. */
export const versionFolders = (home: string): string[] =>
  existsSync(join(home, 'versions')) ? readdirSync(join(home, 'versions')).filter((n) => lstatSync(join(home, 'versions', n)).isDirectory()).sort() : [];
/** What `<home>/versions/current` is: a link, and the version folder it reaches; or why it isn't. */
export function current(home: string): { link: boolean; reaches: string | undefined } {
  const p = join(home, 'versions', 'current');
  let link = false;
  try { link = lstatSync(p).isSymbolicLink(); } catch { return { link: false, reaches: undefined }; }
  try { return { link, reaches: realpathSync(p) }; } catch { return { link, reaches: undefined }; }
}

// ---- Running a program as the test's probe: which version answers.
export interface Ran { code: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; error?: string }
export function probe(argv: string[], env: NodeJS.ProcessEnv = { PATH: '/usr/bin:/bin' }): Ran {
  const r = spawnSync(argv[0]!, argv.slice(1), { env: { ...env, DEEP_TEST_PROBE: '1' }, input: '', encoding: 'utf8', timeout: 10_000 });
  return { code: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '', ...(r.error ? { error: r.error.message } : {}) };
}
export const shown = (r: Ran) => `exit ${r.code}${r.signal ? ` (${r.signal})` : ''}${r.error ? `, ${r.error}` : ''}, stdout ${JSON.stringify(r.stdout.slice(0, 800))}, stderr ${JSON.stringify(r.stderr.slice(0, 800))}`;
/** The version `<home>/versions/current/bin/deep` answers with, or why none did. */
export function runningVersion(home: string): string {
  const r = probe([join(home, 'versions', 'current', 'bin', 'deep')]);
  return r.code === 0 ? r.stdout.trim() : `nothing ran: ${shown(r)}`;
}

// ---- A home with stand-ins, for the real `deep setup`.
/**
 * `<tmp>/h` is HOME for every process a test starts; `<tmp>/h/.codex` exists, so setup includes Codex. `<tmp>/bin` comes
 * first on PATH with `launcher` (the login service stand-in, through `DEEP_HUB_LAUNCHER`), `launchctl`, `systemctl` and
 * `claude`, which log their call and exit 0, and `sh-login`, the login shell (SHELL).
 */
export interface Home { tmp: string; home: string; bin: string; root: string }
export function makeHome(): Home {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const bin = join(tmp, 'bin');
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(bin);
  const script = (name: string, text: string) => { writeFileSync(join(bin, name), text); chmodSync(join(bin, name), 0o755); };
  for (const name of ['launchctl', 'systemctl', 'claude']) {
    script(name, `#!/bin/sh\nprintf '%s %s\\n' '${name}' "$*" >> '${bin}/calls.log'\n${name === 'claude' ? `[ "$1" = --version ] && echo '2.1.0 (Claude Code)'\n` : ''}exit 0\n`);
  }
  script('launcher', `#!/bin/sh\nprintf 'launcher %s\\n' "$*" >> '${bin}/calls.log'\nexec '${NODE}' '${LAUNCHER}' "$@"\n`);
  script('sh-login', [
    '#!/bin/sh',
    `PATH='${bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin'; export PATH`,
    'for a; do shift; case "$a" in -l|-i|--login|-il|-li) ;; -lc|-cl|-ilc|-lic|-ic|-ci) set -- "$@" -c ;; *) set -- "$@" "$a" ;; esac; done',
    'exec /bin/sh "$@"',
    '',
  ].join('\n'));
  writeFileSync(join(tmp, 'confirm'), 'confirmed\n');
  return { tmp, home, bin, root: join(home, '.deepbuild') };
}
const BILLING = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'AWS_BEARER_TOKEN_BEDROCK', 'OPENAI_API_KEY', 'CODEX_API_KEY'];
/** HOME the test's, the stand-ins first on PATH, no DEEP_, XDG_, CLAUDE*, CODEX*, GIT_ or billing variable of this process's. */
export function childEnv(h: Home): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(DEEP_|XDG_|CLAUDE|CODEX|GIT_)/.test(key) || key === 'NODE_OPTIONS' || BILLING.includes(key)) continue;
    env[key] = value;
  }
  env.HOME = h.home;
  env.XDG_CONFIG_HOME = join(h.home, '.config');
  env.XDG_CACHE_HOME = join(h.home, '.cache');
  env.SHELL = join(h.bin, 'sh-login');
  env.PATH = `${h.bin}:${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`;
  env.LC_ALL = 'C';
  env.DEEP_HUB_TEST_CONFIRM = join(h.tmp, 'confirm');
  env.DEEP_HUB_LAUNCHER = join(h.bin, 'launcher');
  env.DEEP_TEST_LAUNCHER_LOG = join(h.tmp, 'launched');
  env.DEEP_TEST_RAN = join(h.tmp, 'ran.log');
  return env;
}
const owned = new Set<number>();
export function run(command: string, args: readonly string[], o: { env: NodeJS.ProcessEnv; cwd: string; timeoutMs?: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['pipe', 'pipe', 'pipe'] });
    if (child.pid) owned.add(child.pid);
    let stdout = '';
    let stderr = '';
    let error: string | undefined;
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => { error = `killed at ${o.timeoutMs ?? 180_000} ms`; child.kill('SIGKILL'); }, o.timeoutMs ?? 180_000);
    child.on('error', (e) => { error = e.message; });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, ...(error ? { error } : {}) }); });
    child.stdin.on('error', () => undefined);
    child.stdin.end('');
  });
}
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
  const r = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
  return r.status === 0 && !/Z/.test(r.stdout);
}
/** The PIDs the login service stand-in started in this home. */
export const launched = (h: Home): number[] => existsSync(join(h.tmp, 'launched')) ? readFileSync(join(h.tmp, 'launched'), 'utf8').split('\n').map(Number).filter((n) => n > 0) : [];
/** Stops `pids` (each one this suite started), SIGTERM then SIGKILL after 5 s. */
export async function stop(pids: number[]): Promise<void> {
  for (const pid of pids) try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
  const deadline = Date.now() + 5000;
  while (pids.some(alive) && Date.now() < deadline) await sleep(50);
  for (const pid of pids) if (alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ }
}
/** Stops every process this suite started, the hubs the stand-in started included, and removes the temp folders. */
export async function cleanup(homes: Home[]): Promise<void> {
  await stop([...owned, ...homes.flatMap(launched)]);
  owned.clear();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}
export function answers(path: string, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect(path);
    const done = (v: boolean) => { clearTimeout(timer); sock.destroy(); resolve(v); };
    const timer = setTimeout(() => done(false), timeoutMs);
    sock.setEncoding('utf8');
    sock.on('data', (d: string) => { if (d.includes('\n')) done(true); });
    sock.on('error', () => done(false));
  });
}
export async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { if (await check()) return true; await sleep(200); }
  return false;
}

// ---- The files setup writes, read back from disk.
/** The login service's definition file, where `deep hub start` writes it for this home. */
export const definitionFile = (h: Home): string => process.platform === 'darwin'
  ? join(h.home, 'Library', 'LaunchAgents', 'com.deepbuild.hub.plist')
  : join(h.home, '.config', 'systemd', 'user', 'deepbuild-hub.service');
/** Every file holding an entry DeepBuild writes: Claude Code's settings and user state, Codex's two, the login service. */
export const agentFiles = (h: Home): Record<string, string> => ({
  'Claude Code settings.json': join(h.home, '.claude', 'settings.json'),
  'Claude Code .claude.json': join(h.home, '.claude.json'),
  'Codex hooks.json': join(h.home, '.codex', 'hooks.json'),
  'Codex config.toml': join(h.home, '.codex', 'config.toml'),
  'the login service definition': definitionFile(h),
});
export const snapshot = (h: Home): Record<string, string | null> =>
  Object.fromEntries(Object.entries(agentFiles(h)).map(([name, f]) => [name, existsSync(f) ? readFileSync(f, 'latin1') : null]));

/** A definition's program and environment, read back from its text as launchd or systemd reads it. */
export function readDefinition(text: string, plist: boolean): { argv: string[]; env: Record<string, string> } {
  const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const env: Record<string, string> = {};
  if (plist) {
    const args = /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(text);
    const argv = args ? [...args[1]!.matchAll(/<string>([\s\S]*?)<\/string>/g)].map((m) => unxml(m[1]!)) : [];
    const vars = /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/.exec(text);
    if (vars) for (const m of vars[1]!.matchAll(/<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/g)) env[unxml(m[1]!)] = unxml(m[2]!);
    return { argv, env };
  }
  const words = (line: string) => [...line.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)].map((m) => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]!));
  const exec = /^ExecStart=(.*)$/m.exec(text);
  for (const m of text.matchAll(/^Environment=(.*)$/gm)) for (const pair of words(m[1]!)) { const i = pair.indexOf('='); if (i > 0) env[pair.slice(0, i)] = pair.slice(i + 1); }
  return { argv: exec ? words(exec[1]!) : [], env };
}

/** One entry DeepBuild wrote: where, and how its agent runs it (a shell command line, or a program and its arguments). */
export interface Entry { where: string; shell?: string; argv?: string[]; env?: Record<string, string> }
type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const hookEntries = (file: string, name: string): Entry[] => {
  if (!existsSync(file)) return [];
  const value = JSON.parse(readFileSync(file, 'utf8')) as Obj;
  const out: Entry[] = [];
  for (const [event, groups] of Object.entries(isObj(value.hooks) ? value.hooks : {})) {
    for (const g of Array.isArray(groups) ? groups : []) for (const h of isObj(g) && Array.isArray(g.hooks) ? g.hooks : []) {
      if (isObj(h) && typeof h.command === 'string') out.push({ where: `${name} ${event}`, shell: h.command });
    }
  }
  if (isObj(value.statusLine) && typeof value.statusLine.command === 'string') out.push({ where: `${name} statusLine`, shell: value.statusLine.command });
  return out;
};
/**
 * Every entry in the files setup wrote, in a home holding none of the person's own: Claude Code's hooks and status line,
 * its MCP servers, Codex's hooks and MCP servers, and the login service's program.
 */
export function entriesOf(h: Home): Entry[] {
  const f = agentFiles(h);
  const out = [...hookEntries(f['Claude Code settings.json']!, 'Claude Code settings.json'), ...hookEntries(f['Codex hooks.json']!, 'Codex hooks.json')];
  if (existsSync(f['Claude Code .claude.json']!)) {
    const value = JSON.parse(readFileSync(f['Claude Code .claude.json']!, 'utf8')) as Obj;
    for (const [name, s] of Object.entries(isObj(value.mcpServers) ? value.mcpServers : {})) {
      if (isObj(s) && typeof s.command === 'string') out.push({ where: `Claude Code .claude.json mcpServers.${name}`, argv: [s.command, ...(Array.isArray(s.args) ? s.args.map(String) : [])] });
    }
  }
  if (existsSync(f['Codex config.toml']!)) {
    // Each [mcp_servers.<name>] table's command and args; TOML's basic strings and arrays of them read as JSON.
    const text = readFileSync(f['Codex config.toml']!, 'utf8');
    for (const m of text.matchAll(/^\[mcp_servers\.([^\]\s.]+)\]\s*\n([\s\S]*?)(?=^\[|(?![\s\S]))/gm)) {
      const command = /^command\s*=\s*(".*")\s*$/m.exec(m[2]!)?.[1];
      const args = /^args\s*=\s*(\[.*\])\s*$/m.exec(m[2]!)?.[1];
      if (command) out.push({ where: `Codex config.toml mcp_servers.${m[1]}`, argv: [JSON.parse(command) as string, ...(args ? (JSON.parse(args) as string[]) : [])] });
    }
  }
  const def = definitionFile(h);
  if (existsSync(def)) {
    const { argv, env } = readDefinition(readFileSync(def, 'utf8'), def.endsWith('.plist'));
    out.push({ where: 'the login service definition', argv, env });
  }
  return out;
}

/** The program an entry runs: a command line's first word past `exec`, unquoted; an argv's first, or Node's script. */
export function programOf(e: Entry): string {
  if (e.shell !== undefined) {
    const line = e.shell.trim().replace(/^exec\s+/, '');
    const quoted = /^'((?:[^']|'\\'')*)'/.exec(line) ?? /^"((?:[^"\\]|\\.)*)"/.exec(line);
    return quoted ? quoted[1]!.replaceAll(`'\\''`, "'") : line.split(/\s+/)[0] ?? '';
  }
  const argv = e.argv ?? [];
  return /^node(\d*|js)?$/.test(basename(argv[0] ?? '')) ? argv[1] ?? '' : argv[0] ?? '';
}
const inside = (path: string, folder: string) => path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
const VERSION_FOLDER = /\/versions\/(?!current\/)[^/'"\s]+\//;
/**
 * Why an entry's program isn't a fixed path every update keeps, or undefined when it is: it must be under `<root>/bin/`
 * or `<root>/versions/current/`, name no version's own folder, and reach, through its links, the newest version's
 * folder, `<root>/versions/<newest>`.
 */
export function notFixed(e: Entry, root: string, newest: string): string | undefined {
  const p = programOf(e);
  const where = `${e.where} runs ${JSON.stringify(p)}`;
  const text = e.shell ?? (e.argv ?? []).join(' ');
  if (VERSION_FOLDER.test(text)) return `${where}: it names a version's own folder (${VERSION_FOLDER.exec(text)![0]}), which an update removes, not the versions folder's current link`;
  if (!inside(p, join(root, 'bin')) && !inside(p, join(root, 'versions', 'current'))) return `${where}: not a fixed path under ${join(root, 'bin')}/ or ${join(root, 'versions', 'current')}/, which every update keeps`;
  let real: string;
  try { real = realpathSync(p); } catch { return `${where}: nothing is there`; }
  let newestDir: string;
  try { newestDir = realpathSync(join(root, 'versions', newest)); } catch { return `${where}: the newest version's folder ${join(root, 'versions', newest)} isn't there`; }
  if (!inside(real, newestDir)) return `${where}: it reaches ${real}, not the newest version's folder ${newestDir}`;
  return undefined;
}
/** Why running an entry as its agent does (with the probe) doesn't start the newest version, or undefined when it does. */
export function notNewest(e: Entry, newest: string): string | undefined {
  const r = e.shell !== undefined ? probe(['/bin/sh', '-c', e.shell]) : probe(e.argv ?? [''], { PATH: '/usr/bin:/bin', ...e.env });
  const out = r.stdout.trim();
  if (r.code === 0 && out === newest) return undefined;
  return `${e.where}, run as its agent runs it, must start version ${newest}: ${r.code === 0 && out ? `it started ${JSON.stringify(out)}` : `it started nothing (${shown(r)})`}`;
}

// @deepbuild/env-local (#331): the first-party environment. It starts the repo's own dev script, as the
// `environment:` block of `.deepbuild/done.yaml` in the folder it is given names it, through host@1 alone, on
// ports the supervisor leases per worktree, and reports it ready only once its health route answers 200. It never
// spawns, signals or waits for a process itself: the supervisor (#236) tracks every one by its run token and
// start time and stops only those. A compose stack runs as its own compose project, named from its run, so two
// worktrees never share one; `docker compose up` and its `down` run through the host too.
import { execFile, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { SlotFill } from '@deepbuild/conformance';
import type { Grant, Host, ResourceKind, Supervisor } from '@deepbuild/supervisor';
import { parse } from 'yaml';

/** The `environment:` block of done.yaml. */
interface Environment {
  /** The repo's own dev script, run by /bin/sh in the folder the stack starts from. */
  up?: string;
  /** A compose file in that folder, run as a compose project of the stack's own. */
  compose?: string;
  /** Each name a port leased per worktree, passed to the stack as the variable of that name. */
  ports: string[];
  /** Ready only once GET on this URL, its `${name}`s filled with the leased ports, answers 200, within `within` seconds. */
  ready: { http: string; within: number };
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// The health route is on this machine's loopback, on a leased port when the stack has any: an answer from anywhere
// else can't say the stack is ready.
const ROUTE = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(?:\$\{(\w+)\}|(\d+))(?:[/?#]|$)/;
/** The environment block of the folder's .deepbuild/done.yaml; throws naming what is wrong with it. */
function readEnvironment(folder: string): Environment {
  const file = join(folder, '.deepbuild', 'done.yaml');
  if (!existsSync(file)) throw Error(`${file} doesn't exist, so there is no environment to start`);
  const doc = parse(readFileSync(file, 'utf8')) as { environment?: unknown } | null;
  const env = doc?.environment as Record<string, unknown> | undefined;
  if (typeof env !== 'object' || env === null) throw Error(`${file} has no environment: block`);
  const { up, compose, ports = [], ready } = env as { up?: unknown; compose?: unknown; ports?: unknown; ready?: unknown };
  if ((typeof up === 'string') === (typeof compose === 'string')) throw Error(`${file}: environment names exactly one of up (a command) or compose (a file)`);
  if (!Array.isArray(ports) || ports.some((p) => typeof p !== 'string' || !NAME.test(p))) throw Error(`${file}: environment.ports is a list of variable names`);
  const r = ready as { http?: unknown; within?: unknown } | undefined;
  if (typeof r?.http !== 'string') throw Error(`${file}: environment.ready.http names the health route's URL`);
  const route = ROUTE.exec(r.http);
  const named = [...r.http.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]!);
  if (!route || named.some((name) => !(ports as string[]).includes(name)) || ((ports as string[]).length > 0 && route[1] === undefined)) {
    throw Error(`${file}: environment.ready.http is http:// on 127.0.0.1, localhost or [::1], at \${name} of a leased port when there are ports, and names no other variable`);
  }
  const within = r.within ?? 60;
  if (typeof within !== 'number' || !(within > 0) || !Number.isFinite(within)) throw Error(`${file}: environment.ready.within is a finite number of seconds`);
  return { ...(typeof up === 'string' ? { up } : { compose: compose as string }), ports: ports as string[], ready: { http: r.http, within } };
}

/** The port kind as `lease.kind@1` data: ports match by exact key. */
const PORT_KIND = { name: 'port', match: 'exact', cap: 1000, cooldown: 0, cost: 0 } as const;
/** A compose project's name, as `lease.kind@1` data: one stack's project at a time, by exact key. */
const COMPOSE_KIND = { name: 'compose', match: 'exact', cap: 1000, cooldown: 0, cost: 0 } as const;
/** env-local's resource kinds, as its manifest declares them in the kernel's lease table (#237). */
export const leaseKinds = [PORT_KIND, COMPOSE_KIND];
const HOSTS = ['127.0.0.1', '0.0.0.0', '::'];
/** Whether lsof shows no listener on the port, on any address; a failed lsof is not proof, so not free. */
const unlisted = (port: number): Promise<boolean> => new Promise((resolve) => {
  execFile('/usr/sbin/lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout, stderr) => {
    // lsof exits 1 with no output when nothing matches.
    resolve(stdout.trim() === '' && (!error || ((error as { code?: unknown }).code === 1 && stderr.trim() === '')));
  });
});
/** Answers whether a connection to the port on the host is refused. */
const refused = (port: number, host: string): Promise<boolean> => new Promise((resolve) => {
  const s = net.connect({ port, host });
  const done = (free: boolean) => { s.destroy(); resolve(free); };
  s.once('connect', () => done(false));
  s.once('error', (error: NodeJS.ErrnoException) => done(error.code !== 'ETIMEDOUT'));
  s.setTimeout(1000, () => done(false));
});
/**
 * Whether nothing on this machine listens on the port: it binds on every address, nothing answers on 127.0.0.1 or
 * ::1, and lsof shows no listener (one on a single address, ::1 or the LAN's, lets a wildcard bind succeed beside it).
 */
async function portFree(port: number): Promise<boolean> {
  for (const host of HOSTS) {
    const bound = await new Promise<boolean>((resolve) => {
      const s = net.createServer();
      s.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EAFNOSUPPORT' || error.code === 'EADDRNOTAVAIL'));
      s.listen({ port, host, exclusive: true }, () => s.close(() => resolve(true)));
    });
    if (!bound) return false;
  }
  return (await refused(port, '127.0.0.1')) && (await refused(port, '::1')) && unlisted(port);
}
/** The supervisor's port kind: from 3000 up, each port checked free before it is leased; `free: false` only for a planted wrong program. */
export function portKind(options: { free?: boolean } = {}): ResourceKind {
  return {
    kind: PORT_KIND.name, port: true, keys: Array.from({ length: PORT_KIND.cap }, (_, i) => String(3000 + i)),
    ...(options.free === false ? {} : { free: (key: string) => portFree(Number(key)) }),
  };
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A fresh run handle, run:<ULID>. */
export function newRun(ms = Date.now()): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  return `run:${time}${Array.from(randomBytes(16), (b) => CROCKFORD[b % 32]).join('')}`;
}

/** One GET of the health URL: its status, or why it got none. */
function get(url: string): Promise<{ status: number | null; error?: string }> {
  return new Promise((resolve) => {
    let req: http.ClientRequest;
    try {
      req = http.get(url, { timeout: 1000 }, (res) => { res.resume(); resolve({ status: res.statusCode ?? null }); });
    } catch (error) {
      resolve({ status: null, error: (error as Error).message });
      return;
    }
    req.on('timeout', () => { req.destroy(); resolve({ status: null, error: 'no answer within 1 s' }); });
    req.on('error', (e: NodeJS.ErrnoException) => resolve({ status: null, error: e.code ?? e.message }));
  });
}
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Stack {
  run: string; pid: number; ports: Record<string, number>; /** Its health route, its ports filled in. */ url: string;
  /** The compose project its containers carry, for a compose stack. */ project?: string;
}
/** Whether the stack's health route answers 200 now. */
export const answers = async (stack: Stack): Promise<boolean> => (await get(stack.url)).status === 200;
export type Up = { status: 'ready'; stack: Stack } | { status: 'BLOCKED'; run: string; cause: string };
interface UpOptions {
  run: string;
  /** The folder the stack starts from and reads its environment block in: a worktree, or a check's checkout. */
  folder: string;
  /** Ports already leased, by name (the kit's); otherwise each is leased through the host. */
  ports?: Record<string, number>;
  /** Added to the stack's environment; DEEP_RUN_TOKEN here is the run token the host gives it. */
  env?: Record<string, string>;
  /** The hub's compose kind: its folder no run writes and the Docker CLI it found; without one no compose stack runs. */
  compose?: { dir: string; docker?: string | undefined } | undefined;
  /** The planted wrong program: compose runs under the file's own project name, shared by every worktree. */
  sharedProject?: boolean;
  /** Who holds the stack's leases (StartSpec.holder): the session whose deep_env call starts it; the core unless given. */
  holder?: string;
}

/**
 * The first `name` in `dirs`, links followed, and every folder looked in up to it, where one planted later would be
 * found first: the hub guards them all once it has found one.
 */
const lookUp = (dirs: string[], name: string): { found?: string; searched: string[] } => {
  const searched: string[] = [];
  for (const dir of dirs.filter((d) => isAbsolute(d))) {
    searched.push(dir);
    if (existsSync(join(dir, name))) return { found: realpathSync(join(dir, name)), searched };
  }
  return { searched: [] };
};
/** The Docker CLI on the hub's PATH and the compose plugin it would run, as the folders it looks in, in order, give them. */
const dockerTools = () => {
  const cli = lookUp((process.env.PATH ?? '').split(':'), 'docker');
  const config = process.env.DOCKER_CONFIG ?? join(homedir(), '.docker');
  let extra: unknown;
  try { extra = (JSON.parse(readFileSync(join(config, 'config.json'), 'utf8')) as { cliPluginsExtraDirs?: unknown }).cliPluginsExtraDirs; } catch { /* none */ }
  const plugins = [...(Array.isArray(extra) ? extra.filter((d): d is string => typeof d === 'string' && isAbsolute(d)) : []), join(config, 'cli-plugins'),
    '/usr/local/lib/docker/cli-plugins', '/opt/homebrew/lib/docker/cli-plugins', '/usr/local/libexec/docker/cli-plugins', '/usr/lib/docker/cli-plugins', '/usr/libexec/docker/cli-plugins'];
  const plugin = lookUp(plugins, 'docker-compose');
  if (!cli.found || !plugin.found) return { guarded: [] };
  // The config, which names plugin folders; the PATH searched; every plugin folder, since a CLI listing its plugins
  // runs each it finds; and the folders the two found are in.
  const guarded = [join(config, 'config.json'), ...cli.searched, ...plugins, dirname(cli.found), dirname(plugin.found)];
  return { docker: cli.found, plugin: plugin.found, guarded: [...new Set(guarded.map((p) => (existsSync(p) ? realpathSync(p) : p)))] };
};
const SYSTEM_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
type Daemon = { socket: string[]; env: Record<string, string> } | { why: string };
const daemons = new Map<string, Daemon>();
/**
 * The daemon the Docker CLI's current context names, resolved once per hub: its socket, links followed, for a compose
 * stack's grant, and all the CLI is given, from the hub's own environment (its PATH, home and config) with DOCKER_HOST
 * pinned to that socket, so each call the hub and its stacks make reaches the socket they were granted. Compose reads
 * its file's `${...}` from this, the ports and the folder's own `.env` when it resolves the file, once; what runs is
 * that resolution. A context reached otherwise (tcp, ssh) can't be granted to a sandbox, so no stack runs on it.
 */
const daemon = (docker: string): Daemon => {
  if (daemons.has(docker)) return daemons.get(docker)!;
  const base = Object.fromEntries(['PATH', 'HOME', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT'].flatMap((k) => (process.env[k] ? [[k, process.env[k]!]] : [])));
  let found: Daemon;
  try {
    const host = execFileSync(docker, ['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], { env: base, encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const path = host.startsWith('unix:///') ? host.slice('unix://'.length) : undefined;
    const { DOCKER_CONTEXT: _, ...env } = base;
    found = path ? { socket: [...new Set([path, existsSync(path) ? realpathSync(path) : path])], env: { ...env, DOCKER_HOST: `unix://${path}` } }
      : { why: `Docker's context reaches its daemon at ${host || 'no endpoint'}, not a socket on this machine a sandbox can be granted` };
  } catch {
    found = { why: 'docker context inspect failed, so the socket Docker reaches its daemon at is unknown' };
  }
  daemons.set(docker, found);
  return found;
};
/**
 * What the CLI runs with in a compose stack or step: the daemon's pinned environment, a PATH of the CLI's own folder and
 * the system's, and the hub's own Docker config, which only links the compose plugin: no run writes either, so neither
 * your config's plugins, hooks and credential helpers nor a program planted on your PATH runs with the socket. Compose
 * fetches no remote include (a git one runs git, as configured from a home a run may write) and has an empty home of
 * the hub's; these outrank what a folder's `.env` sets.
 */
const dockerEnv = (docker: string, dir: string): Record<string, string> => {
  const d = daemon(docker);
  return 'env' in d ? {
    ...d.env, PATH: `${dirname(docker)}:${SYSTEM_PATH}`, HOME: join(dir, 'home'), DOCKER_CONFIG: join(dir, 'docker'),
    COMPOSE_EXPERIMENTAL_GIT_REMOTE: '0', COMPOSE_EXPERIMENTAL_OCI_REMOTE: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
  } : {};
};
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
const exec = (file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<{ code: number; stdout: string; stderr: string }> => new Promise((resolve) => {
  execFile(file, args, { timeout: 30_000, ...options, maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
    resolve({ code: error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0, stdout, stderr });
  });
});

/**
 * The compose kind: each key a compose project, `deep-c000` up, leased to one compose stack. Giving one back runs
 * `docker compose down -v` on its project, and it is clean only once no container or volume carries its label, so the run's
 * leases, its ports' too, end only after its containers have gone, whatever stopped its processes.
 */
export function composeKind(dir: string): ResourceKind & { dir: string; guarded: string[]; docker?: string } {
  // Found once, when the hub starts, and never again from a PATH or config a run may write.
  const tools = dockerTools();
  const docker = tools.docker ?? '/usr/local/bin/docker';
  // In `dir`, which no run writes: an empty folder, so no compose file nearby is read by `down`, and the CLI's config.
  const cwd = join(dir, 'steps');
  rmSync(join(dir, 'docker'), { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  mkdirSync(join(dir, 'home'), { recursive: true });
  mkdirSync(join(dir, 'docker', 'cli-plugins'), { recursive: true });
  writeFileSync(join(dir, 'docker', 'config.json'), '{}\n');
  if (tools.plugin) symlinkSync(tools.plugin, join(dir, 'docker', 'cli-plugins', 'docker-compose'));
  // Read when a step runs, so the hub asks Docker for its daemon only once a compose stack is wanted.
  const step = (script: string) => ({
    argv: ['/bin/sh', '-c', script, docker], cwd,
    get env() { return dockerEnv(docker, dir); },
    get grant() { const d = daemon(docker); return { run_as_you: true, sockets: 'socket' in d ? d.socket : [] }; },
  });
  const labelled = (args: string[], key: string) => exec(docker, [...args, '--filter', `label=com.docker.compose.project=${key}`], { env: dockerEnv(docker, dir), timeout: 5_000 });
  // Until then, every key reads taken without asking: a daemon that stopped answering fails the lease at once
  // rather than once per key of a thousand.
  let unanswered = 0;
  return {
    // The CLI and the plugin that run with the socket are kept from every run's writes, as the hub's own files are.
    dir, guarded: tools.guarded,
    ...(tools.docker ? { docker: tools.docker } : {}),
    kind: COMPOSE_KIND.name, keys: Array.from({ length: COMPOSE_KIND.cap }, (_, i) => `deep-c${String(i).padStart(3, '0')}`),
    release: step('"$0" compose -p "$DEEP_RESOURCE_KEY" down -v -t 1 --remove-orphans'),
    check: step([
      'f="label=com.docker.compose.project=$DEEP_RESOURCE_KEY"',
      'c=$("$0" ps -aq --filter "$f") || exit 1; v=$("$0" volume ls -q --filter "$f") || exit 1; [ -z "$c$v" ]',
    ].join('\n')),
    // A project with containers or volumes left from before (another tool's, or a crash's) is skipped: the next
    // stack never starts on what the last one left.
    free: async (key) => {
      if (Date.now() < unanswered) return false;
      const [c, v] = await Promise.all([labelled(['ps', '-aq'], key), labelled(['volume', 'ls', '-q'], key)]);
      if (c.code !== 0 || v.code !== 0) unanswered = Date.now() + 10_000;
      return c.code === 0 && v.code === 0 && c.stdout.trim() === '' && v.stdout.trim() === '';
    },
  };
}

// The sandbox's own denials, kept from a container too: the files agents read their hooks and MCP servers from.
const AGENT_FILES = /(^|\/)(\.claude|\.codex)(\/|$)|(^|\/)(\.mcp\.json|\.claude\.json)$/;
// What a service may set, as `config` resolves it; anything else (privileges, the machine's namespaces, devices,
// hooks, the Docker socket, providers, keys compose adds later) is refused rather than judged.
const SERVICE_KEYS = new Set([
  'image', 'command', 'entrypoint', 'environment', 'ports', 'expose', 'volumes', 'tmpfs', 'working_dir', 'user',
  'healthcheck', 'depends_on', 'restart', 'labels', 'annotations', 'networks', 'hostname', 'domainname', 'extra_hosts', 'dns',
  'dns_search', 'stop_signal', 'stop_grace_period', 'tty', 'stdin_open', 'init', 'read_only', 'pull_policy', 'platform',
  'profiles', 'deploy', 'mem_limit', 'mem_reservation', 'memswap_limit', 'cpus', 'cpu_shares', 'shm_size', 'ulimits', 'scale',
  'container_name', 'attach',
]);
const TOP_KEYS = new Set(['name', 'services', 'networks', 'volumes', 'configs', 'secrets']);
/**
 * Why the compose stack, as `docker compose config --format json` resolves it, may not run: the daemon starts its
 * containers outside the sandbox, so none may reach past the folder it runs from, write where the agents' hooks
 * live, publish a port it wasn't leased or off loopback, or set anything but the plain keys above. Nothing when it may.
 */
export function composeRefusal(config: unknown, folder: string, leased: readonly string[], project: string): string | undefined {
  const root = realpathSync(folder);
  /** The path's place in the folder, links followed ('' the folder itself), or nothing when it is outside. */
  const place = (path: unknown): string | undefined => {
    // `config` writes a `$` as `$$`, which compose reads again as one: a path with either is never judged. Nor is a
    // relative one, which `config` never writes and `up` reads from the judged file's folder.
    if (typeof path !== 'string' || path.includes('$') || !isAbsolute(path)) return undefined;
    // A source not there yet (the daemon makes it) is judged by its nearest folder that is, links followed.
    let real = resolve(root, path);
    for (let rest = ''; ; real = dirname(real)) {
      try { real = join(realpathSync(real), rest); break; } catch { rest = join(basename(real), rest); }
      if (real === dirname(real)) break;
    }
    const rel = relative(root, real);
    return rel.startsWith('..') || isAbsolute(rel) || AGENT_FILES.test(rel) ? undefined : rel;
  };
  const c = (config ?? {}) as Record<string, Record<string, Record<string, unknown> | null> | undefined>;
  const top = Object.keys(c).find((key) => !TOP_KEYS.has(key));
  if (top) return `it sets ${top}, which env-local doesn't run`;
  for (const [name, s] of Object.entries(c.services ?? {})) {
    if (!s) continue;
    const key = Object.keys(s).find((k) => !SERVICE_KEYS.has(k));
    if (key) return `service ${name} sets ${key}, which env-local doesn't run`;
    const reserved = (s.deploy as { resources?: { reservations?: { devices?: unknown[] } } } | undefined)?.resources?.reservations?.devices;
    if (reserved?.length) return `service ${name} reserves devices`;
    // A shape not judged here is refused, never left to compose's own checks.
    const shape = (['ports', 'volumes'] as const).find((k) => s[k] !== undefined && !Array.isArray(s[k]));
    if (shape) return `service ${name} gives ${shape} other than as a list`;
    // A port it publishes is one leased to it, never one another worktree's stack or another program may hold.
    for (const port of (Array.isArray(s.ports) ? s.ports : []) as { published?: unknown; host_ip?: unknown }[]) {
      if (!leased.includes(String(port.published))) return `service ${name} publishes port ${String(port.published ?? '(any)')}, which isn't one of its leased ports`;
      // On loopback alone, as a plain stack listens; one with no address of its own is bound there.
      if (port.host_ip !== undefined && port.host_ip !== '127.0.0.1' && port.host_ip !== '::1') return `service ${name} publishes port ${String(port.published)} on ${String(port.host_ip)}, not on loopback`;
    }
    for (const v of (Array.isArray(s.volumes) ? s.volumes : []) as { type?: string; source?: unknown; read_only?: unknown; bind?: Record<string, unknown> }[]) {
      if (v.type === 'volume' || v.type === 'tmpfs') continue;
      // Of a bind's options, only whether the daemon makes a missing source: no recursive, propagation or SELinux label.
      const option = Object.keys(v.bind ?? {}).find((k) => k !== 'create_host_path');
      if (option) return `service ${name} mounts ${String(v.source)} with bind ${option}, which env-local doesn't run`;
      const at = v.type === 'bind' ? place(v.source) : undefined;
      if (at === undefined) return `service ${name} mounts ${String(v.source)} (${String(v.type)}), outside the folder ${root} it runs from`;
      // Read-only: a container that could write in the folder could write the agents' hook files there, or plant a
      // link that a later mount's source follows out of it.
      if (v.read_only !== true) return `service ${name} mounts ${String(v.source)} writable; env-local mounts the folder read-only (\`:ro\`), with project volumes for what a container writes`;
    }
  }
  // Its volumes and networks are its project's own: none outside, named apart from it, or with a driver of their own.
  for (const [group, driver] of [['volumes', 'local'], ['networks', 'bridge']] as const) {
    for (const [name, v] of Object.entries(c[group] ?? {})) {
      if (v && (v.driver_opts || v.external || (v.driver !== undefined && v.driver !== driver) || v.name !== `${project}_${name}`)) return `${group.slice(0, -1)} ${name} isn't its project's own (an outside one, one named apart, or one with a driver or options of its own)`;
    }
  }
  for (const group of ['configs', 'secrets']) for (const [name, v] of Object.entries(c[group] ?? {})) if (v && (v.file === undefined || place(v.file) === undefined)) return `${group.slice(0, -1)} ${name} isn't a file in the folder ${root}`;
  return undefined;
}

/** The compose project compose itself would pick: the file's top-level name:, else the folder's name. */
function defaultProject(folder: string, file: string): string {
  try {
    const name = (parse(readFileSync(join(folder, file), 'utf8')) as { name?: unknown } | null)?.name;
    if (typeof name === 'string') return name;
  } catch { /* compose itself says what's wrong with the file */ }
  return basename(folder).toLowerCase();
}
// The compose stack's shell, run with its leases: compose resolves the file once (`config`), with exactly the
// project, ports and environment it then runs with, into its folder $3; it waits for the hub's judgement of what was
// resolved in $4, the hub's folder no run writes: `run.json`, the file it then runs, or `stop`. `up` runs that file,
// so what runs is what was judged. On SIGTERM it waits for up to stop, then removes the project's containers before it exits; the compose
// kind's release and check stand behind it. $1 `shared` for the planted wrong program (the file's own project),
// $2 the compose file.
const COMPOSE = (docker: string, dir: string, ports: readonly string[]) => [
  `PATH=${SYSTEM_PATH}; file=$2 work=$3 judged=$4; project=$DEEP_COMPOSE_PROJECT; [ "$1" = shared ] && project=`,
  `d() { env -i ${Object.entries(dockerEnv(docker, dir)).map(([k, v]) => `${k}=${quote(v)}`).join(' ')} ${ports.map((p) => `${p}="$${p}"`).join(' ')} ${quote(docker)} compose "$@"; }`,
  'p() { if [ -n "$project" ]; then d -p "$project" "$@"; else d "$@"; fi; }',
  'p -f "$file" config --format json > "$work/resolved.json" 2> "$work/why" || exit 3',
  ': > "$work/resolved.done"',
  'while [ ! -e "$judged/run.json" ]; do [ -e "$judged/stop" ] && exit 3; sleep 0.05; done',
  "trap 'kill -TERM $pid 2>/dev/null; wait $pid; p -f \"$judged/run.json\" down -v -t 1 --remove-orphans; exit 143' TERM INT",
  'p -f "$judged/run.json" up --pull never --no-build & pid=$!; wait $pid; code=$?',
  'p -f "$judged/run.json" down -v -t 1 --remove-orphans; exit $code',
].join('\n');
/** Compose runs, each with its shell's folder and the hub's of its judged file; their down takes compose's own time. */
const composed = new Map<string, { work: string; judged: string }>();
// What steers compose, Docker, git or the compose shell's own leases: never a port's name, which is set after them.
const STEERING = /^(COMPOSE_|DOCKER_|GIT_|DEEP_)|^(PATH|HOME)$/;

/**
 * Judges the compose stack as its shell resolved it, once compose has: why it may not run, or nothing, once the file
 * it runs is written, every published port bound on loopback alone, the way a plain stack's grant binds it.
 */
async function judge(host: Host, run: string, { work, judged }: { work: string; judged: string }, folder: string, ports: number[], project: string): Promise<string | undefined> {
  let ended = false;
  void host.wait(run).then(() => { ended = true; }, () => { ended = true; });
  const deadline = Date.now() + 60_000;
  while (!existsSync(join(work, 'resolved.done'))) {
    if (ended) return `docker compose config refused the file: ${(existsSync(join(work, 'why')) ? readFileSync(join(work, 'why'), 'utf8').trim().split('\n').slice(-1)[0] : '') || 'its shell ended first'}`;
    if (Date.now() > deadline) return 'docker compose config gave nothing within 60 s';
    await sleep(50);
  }
  let config: { services?: Record<string, { ports?: { host_ip?: string }[] }> };
  try { config = JSON.parse(readFileSync(join(work, 'resolved.json'), 'utf8')) as typeof config; } catch { return 'docker compose config gave no JSON'; }
  const why = composeRefusal(config, folder, ports.map(String), project);
  if (why) return `the compose file can't run here: ${why}; its containers would run outside the sandbox`;
  for (const service of Object.values(config.services ?? {})) for (const port of service.ports ?? []) port.host_ip ??= '127.0.0.1';
  // The project it was judged as, whatever name the file gave.
  (config as { name?: string }).name = project;
  writeFileSync(join(judged, 'run.tmp'), JSON.stringify(config));
  renameSync(join(judged, 'run.tmp'), join(judged, 'run.json'));
  return undefined;
}

/**
 * Brings the folder's stack up through the host and waits for its health route. A stack that never answers 200 in
 * time, or whose command ends first, is signalled down and BLOCKED, the cause naming the route and its last answer.
 */
export async function upStack(host: Host, o: UpOptions): Promise<Up> {
  let env: Environment;
  try {
    env = readEnvironment(o.folder);
  } catch (error) {
    return { status: 'BLOCKED', run: o.run, cause: (error as Error).message };
  }
  const given = o.ports ?? {};
  const missing = env.ports.filter((name) => given[name] === undefined);
  if (o.ports && missing.length) return { status: 'BLOCKED', run: o.run, cause: `no port given for ${missing.join(', ')}` };
  const listen = Object.values(given).map((p) => `127.0.0.1:${p}`);
  // Your files and programs, as you, and the leased ports to listen on (the supervisor adds the ones it leases).
  const grant: Grant = { run_as_you: true, ...(listen.length ? { listen, hosts: listen } : {}) };
  // The shell's $0 names the run on its command line: the kit's run token where one is given, else the run.
  const $0 = o.env?.DEEP_RUN_TOKEN ?? o.run;
  let argv = ['/bin/sh', '-c', env.up ?? '', $0];
  let folders: { work: string; judged: string } | undefined;
  const leases: { kind: string; env: string }[] = o.ports ? [] : env.ports.map((name) => ({ kind: PORT_KIND.name, env: name }));
  if (env.compose !== undefined) {
    const docker = o.compose?.docker;
    if (!o.compose || !docker) return { status: 'BLOCKED', run: o.run, cause: 'the hub found no Docker CLI with its compose plugin when it started, so no compose stack can run' };
    const { dir } = o.compose;
    const steering = env.ports.find((name) => STEERING.test(name));
    if (steering) return { status: 'BLOCKED', run: o.run, cause: `the port ${steering} is named as a variable that steers compose or Docker; name it otherwise` };
    const reached = daemon(docker);
    if ('why' in reached) return { status: 'BLOCKED', run: o.run, cause: `${reached.why}, so no compose stack can run` };
    // `version`, not `info`, which runs every plugin it lists; with the hub's config, as every call after this one.
    const info = await exec(docker, ['version', '--format', '{{.Server.Version}}'], { env: dockerEnv(docker, dir) });
    if (info.code !== 0) return { status: 'BLOCKED', run: o.run, cause: `the Docker daemon is unreachable (docker version: ${info.stderr.trim().split('\n').slice(-1)[0] || `exit ${info.code}`}), so no compose stack can run` };
    mkdirSync(join(dir, 'runs'), { recursive: true });
    folders = { work: realpathSync(mkdtempSync(join(tmpdir(), 'deep-compose-run-'))), judged: realpathSync(mkdtempSync(join(dir, 'runs', 'run-'))) };
    argv = ['/bin/sh', '-c', COMPOSE(docker, dir, env.ports), $0, o.sharedProject ? 'shared' : '', env.compose, folders.work, folders.judged];
    // The Docker CLI talks to its daemon over its socket; the containers are the daemon's, labelled with the project.
    grant.sockets = reached.socket;
    leases.push({ kind: 'compose', env: 'DEEP_COMPOSE_PROJECT' });
  }
  const started = await host.start({
    run: o.run, argv, cwd: o.folder, grant,
    env: { ...o.env, ...Object.fromEntries(Object.entries(given).map(([k, v]) => [k, String(v)])) },
    ...(leases.length ? { leases } : {}),
    ...(o.holder ? { holder: o.holder } : {}),
  });
  if (started.status === 'BLOCKED') {
    for (const f of Object.values(folders ?? {})) rmSync(f, { recursive: true, force: true });
    return { status: 'BLOCKED', run: o.run, cause: `no ${started.kind} is free to lease` };
  }
  const leased = started.leases.find((l) => l.kind === 'compose')?.key;
  const project = env.compose === undefined ? undefined : o.sharedProject ? defaultProject(o.folder, env.compose) : leased;
  if (folders) composed.set(o.run, folders);
  const ports = { ...given, ...Object.fromEntries(started.leases.filter((l) => l.kind === PORT_KIND.name).map((l, i) => [env.ports[i]!, Number(l.key)])) };
  try {
    const refused = folders ? await judge(host, o.run, folders, o.folder, Object.values(ports), project!) : undefined;
    if (refused) {
      writeFileSync(join(folders!.judged, 'stop'), '');
      await downStack(host, o.run);
      return { status: 'BLOCKED', run: o.run, cause: refused };
    }
    const up = await ready(host, o, env, started.pid, ports);
    return up.status === 'ready' && project !== undefined ? { ...up, stack: { ...up.stack, project } } : up;
  } catch (error) {
    // Whatever goes wrong once it started, the stack is signalled down, never left running unrecorded.
    await downStack(host, o.run);
    return { status: 'BLOCKED', run: o.run, cause: `the stack started, then its health couldn't be checked: ${(error as Error).message}` };
  }
}

/** Polls the started stack's health route until it answers 200; one that doesn't in time, or ends first, is signalled down and BLOCKED. */
async function ready(host: Host, o: UpOptions, env: Environment, pid: number, ports: Record<string, number>): Promise<Up> {
  const url = env.ready.http.replace(/\$\{(\w+)\}/g, (all, name: string) => (ports[name] !== undefined ? String(ports[name]) : all));
  const route = (() => { try { const u = new URL(url); return `GET ${u.pathname} on ${u.host}`; } catch { return `GET ${url}`; } })();
  let ended: string | undefined;
  void host.wait(o.run).then((exit) => { ended = exit.signal ?? `code ${exit.code}`; }, () => undefined);
  const deadline = Date.now() + env.ready.within * 1000;
  let last = 'nothing';
  for (;;) {
    const answer = await get(url);
    if (answer.status === 200) return { status: 'ready', stack: { run: o.run, pid, ports, url } };
    last = answer.status !== null ? `answered ${answer.status}` : `gave no answer (${answer.error})`;
    if (ended !== undefined || Date.now() > deadline) break;
    await sleep(50);
  }
  await downStack(host, o.run);
  const why = ended !== undefined ? `the stack's command ended (${ended}) before ${route} answered 200; it last ${last}` : `${route} ${last}, not 200, within ${env.ready.within} s`;
  return { status: 'BLOCKED', run: o.run, cause: why };
}

/** Signals the stack's run down through the host, SIGKILL after a grace, until the host says its process ended. */
export async function downStack(host: Host, run: string): Promise<void> {
  const exited = host.wait(run).then(() => true, () => true);
  await host.signal(run, 'SIGTERM').catch(() => undefined);
  // A compose stack's shell removes its containers before it exits.
  const folders = composed.get(run);
  const grace = folders ? 30_000 : 2000;
  if (!(await Promise.race([exited, sleep(grace).then(() => false)]))) {
    await host.signal(run, 'SIGKILL').catch(() => undefined);
    await Promise.race([exited, sleep(2000)]);
  }
  composed.delete(run);
  for (const f of Object.values(folders ?? {})) rmSync(f, { recursive: true, force: true });
}

// ---- env-local as an environment@1 fill (#314's kit): up(spec, lease, checkout), down(handle).

interface Handle { id: string; port: number; pid: number }
/** env-local as an environment@1 fill, starting every process through `host`; the kit's lease gives the port and run token. */
export function envLocal(options: { host: Host }): SlotFill {
  const { host } = options;
  return {
    slot: 'environment@1', revision: 1,
    async up(_spec: unknown, lease: { port: number; token: string }, checkout: string): Promise<Handle> {
      const env = readEnvironment(checkout);
      if (env.ports.length !== 1) throw Error(`the kit leases one port, and ${checkout}'s environment names ${env.ports.length}`);
      const run = newRun();
      const up = await upStack(host, { run, folder: checkout, ports: { [env.ports[0]!]: lease.port }, env: { DEEP_RUN_TOKEN: lease.token } })
        .catch((error: Error) => ({ status: 'BLOCKED' as const, run, cause: error.message }));
      if (up.status === 'BLOCKED') {
        // A stack refused before it started is no run of the host's; its cause is what the kit hears.
        await (host as Partial<Supervisor>).cleanup?.(run)?.catch(() => undefined);
        throw Error(up.cause);
      }
      return { id: run, port: lease.port, pid: up.stack.pid };
    },
    async down(handle: Handle): Promise<void> {
      await downStack(host, handle.id);
      // A supervisor as the host closes the run's records too; host@1 alone has no cleanup.
      await (host as Partial<Supervisor>).cleanup?.(handle.id);
    },
  };
}

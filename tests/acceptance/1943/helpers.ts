// Test-side tools for the #1943 acceptance tests (README): a world per VM and test file, of one of this Mac's Lima VMs
// named in a temp SSH config (the host link the kinds get, as `ssh -F` that file), and the harness's own SSH link to the
// same VM, which builds what a check reads there (a settings file, user services) and cleans up; the plug-in, imported
// lazily so each test fails on its own at the base; and the judges a clause's test and its planted runner share. The
// kinds run in this process: no hub and no `deep` command is started.
//
// Safety: every local folder is under /tmp/dh1943-* and removed after its file. The only network is the VMs through
// their forwarded SSH ports on 127.0.0.1. On a VM this file touches only ~/dh1943-<id>/ and the user units whose names
// hold dh1943-<id>, each stopped, disabled, reset and unlinked after the file; no VM is stopped or rebooted. Lima's
// control socket is never used: both SSH configs here set ControlMaster no and ControlPath none. Every local process is
// one this file started, stopped by its handle. The VM's user name and key path are redacted in what the suite shows.
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll } from 'vitest';
import type { CheckContext, CheckResult, SlotReport } from '../../../packages/conformance/src/index.ts';
import type { HostFill, HostKind, MachineSpec, SettingSpec } from '../../../packages/checks-host/src/index.ts';

// ---- The plug-in, reached only through its public entry, imported when a test first needs it.

type Plugin = typeof import('../../../packages/checks-host/src/index.ts');
export const hostChecks = (): Promise<Plugin> => import('../../../packages/checks-host/src/index.ts');

/** The criterion: `#1943.` and the first 8 hex of SHA-256 of its checkbox text (scripts/proof-change.mjs). */
export const AC = '#1943.9249618e The setting and machine check kinds each ship with a planted failure they catch, run in their conformance test: on a test host, a setting the definition requires, changed by a planted drift, fails the setting check, naming the setting, and a service that doesn\'t survive a restart fails the machine check, naming the service; each passes `check.kind@1` (#13)';

/** Each kind's own planted runner (README, Plants): the wrong program its clause names. */
export const PLANTS: Record<HostKind, string> = { setting: 'misses-the-drift', machine: 'never-restarts' };
/** check.kind@1's planted runners every kind's kit carries, as #68's kinds' do. */
export const SLOT_PLANTS = ['past-deadline', 'dropped-output'] as const;

/** The two Lima VMs this Mac runs: real Linux hosts with a user manager and lingering on for Lima's user. */
export type Vm = 'deep-ubuntu' | 'deep-fedora';
/** The host's name in the world's SSH config. */
const aliasOf = (vm: Vm): string => (vm === 'deep-ubuntu' ? 'dh1943-ubuntu' : 'dh1943-fedora');
/** Far past any run of the clauses' checks: a restart and its settle take seconds. */
const DEADLINE = 120_000;

// ---- Local folders and processes: all gone after the file.

interface Ran { code: number | null; stdout: string; stderr: string }
const made: string[] = [];
const closers: (() => Promise<void>)[] = [];
const running = new Set<ReturnType<typeof spawn>>();
afterAll(async () => {
  for (const close of closers.splice(0)) await close().catch(() => undefined);
  for (const child of running) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 180_000);

/** Runs a program to its end without blocking the event loop; killed by its handle past the timeout. */
function run(command: string, args: readonly string[], input = '', timeoutMs = 120_000): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: '/tmp', stdio: ['pipe', 'pipe', 'pipe'] });
    running.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    const done = (code: number | null, extra = ''): void => { clearTimeout(timer); running.delete(child); resolve({ code, stdout, stderr: stderr + extra }); };
    child.on('error', (error) => done(null, error.message));
    child.on('close', (code) => done(code));
    child.stdin.on('error', () => undefined);
    child.stdin.end(input);
  });
}

// ---- A VM's SSH settings, as Lima wrote them in ~/.lima/<vm>/ssh.config. Values are kept as written (quotes too).

interface LimaSsh { port: number; user: string; identityFile: string; knownHosts: string; hostKeyAlias: string; ciphers: string | undefined }
function limaSsh(vm: Vm): LimaSsh {
  const file = join(homedir(), '.lima', vm, 'ssh.config');
  if (!existsSync(file)) throw Error(`BLOCKED: the Lima VM ${vm} has no SSH config here (~/.lima/${vm}/ssh.config)`);
  const values = new Map<string, string>();
  let alias = '';
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(raw);
    if (!m || raw.trim().startsWith('#')) continue;
    if (m[1] === 'Host') alias = m[2]!;
    else if (!values.has(m[1]!)) values.set(m[1]!, m[2]!);
  }
  const need = (key: string): string => {
    const v = values.get(key);
    if (!v) throw Error(`BLOCKED: ~/.lima/${vm}/ssh.config names no ${key}`);
    return v;
  };
  return { port: Number(need('Port')), user: need('User'), identityFile: need('IdentityFile'), knownHosts: need('UserKnownHostsFile'), hostKeyAlias: values.get('HostKeyAlias') ?? alias, ciphers: values.get('Ciphers') };
}
const unquote = (v: string): string => v.replace(/^"(.*)"$/, '$1');
/** One Host block for a VM: Lima's way in (its key, user, known host key) at its forwarded port, with no control socket. */
const hostBlock = (name: string, s: LimaSsh, knownHosts: string): string => [
  `Host ${name}`, '  HostName 127.0.0.1', `  Port ${s.port}`, `  User ${s.user}`, `  IdentityFile ${s.identityFile}`, '  IdentitiesOnly yes',
  '  PreferredAuthentications publickey', '  BatchMode yes', '  StrictHostKeyChecking yes', `  UserKnownHostsFile ${knownHosts}`,
  `  HostKeyAlias ${s.hostKeyAlias}`, ...(s.ciphers ? [`  Ciphers ${s.ciphers}`] : []), '  ControlMaster no', '  ControlPath none',
  '  Compression no', '  GSSAPIAuthentication no', '  ConnectTimeout 30', '',
].join('\n');
/** What the suite shows instead of the VM's user name, the key's path and this Mac's home. */
export function redact(text: string, s?: LimaSsh): string {
  let out = text;
  for (const v of [s?.identityFile, s?.user].filter((x): x is string => !!x)) out = out.split(unquote(v)).join('<redacted>');
  return out.split(homedir()).join('~');
}

// ---- The world: the SSH config the kinds get, and the harness's own link to the same VM.

export interface World {
  vm: Vm;
  /** The SSH config the kinds are handed (README, reading 2): it names the VM as `alias`, and no other host. */
  config: string;
  alias: string;
  /** `dh1943-<id>`: the test's folder's name on the host, held by every unit the suite or a kit makes there. */
  name: string;
  /** `~/dh1943-<id>` on the host, absolute. */
  folder: string;
  /** What a check run gets: a local checkout folder (empty), its deadline and the clock. */
  ctx: CheckContext;
  ssh: LimaSsh;
  /** One shell command on the host, through the harness's link (never the kinds'). */
  sh(command: string, input?: string): Promise<Ran>;
  /** A command that must succeed: its stdout; else BLOCKED, naming it. */
  must(command: string, input?: string): Promise<string>;
}

const worlds = new Map<Vm, Promise<World>>();
/** This file's world on `vm`, opened once: a VM the harness can't reach is BLOCKED. */
export function world(vm: Vm): Promise<World> {
  let w = worlds.get(vm);
  if (!w) worlds.set(vm, (w = openWorld(vm)));
  return w;
}

async function openWorld(vm: Vm): Promise<World> {
  const tmp = realpathSync(mkdtempSync('/tmp/dh1943-'));
  made.push(tmp);
  const s = limaSsh(vm);
  const name = `dh1943-${basename(tmp).slice('dh1943-'.length)}`;
  const alias = aliasOf(vm);
  mkdirSync(join(tmp, 'home', '.ssh'), { recursive: true, mode: 0o700 });
  mkdirSync(join(tmp, 'checkout'));
  const known = join(tmp, 'home', '.ssh', 'known_hosts');
  copyFileSync(unquote(s.knownHosts), known);
  const config = join(tmp, 'home', '.ssh', 'config');
  writeFileSync(config, hostBlock(alias, s, known), { mode: 0o600 });
  const harness = join(tmp, 'harness');
  writeFileSync(harness, hostBlock('dh1943h', s, known), { mode: 0o600 });
  const sh = (command: string, input = ''): Promise<Ran> => run('ssh', ['-F', harness, 'dh1943h', command], input);
  const must = async (command: string, input = ''): Promise<string> => {
    const r = await sh(command, input);
    if (r.code !== 0) throw Error(`BLOCKED: on ${vm}, \`${redact(command.slice(0, 300), s)}\` failed: exit ${r.code}, ${redact(JSON.stringify(r.stderr.slice(-800)), s)}`);
    return r.stdout;
  };
  const home = (await sh('printf %s "$HOME"'));
  if (home.code !== 0 || !home.stdout.startsWith('/')) throw Error(`BLOCKED: the VM ${vm} can't be reached over SSH at its forwarded port: exit ${home.code}, ${redact(home.stderr.slice(-600), s)}`);
  const folder = `${home.stdout}/${name}`;
  if (!/^\/[\w./-]+\/dh1943-\w+$/.test(folder)) throw Error(`BLOCKED: the test's folder on ${vm} would be ${redact(folder, s)}, not ~/dh1943-<id>`);
  await must(`mkdir -m 0755 '${folder}'`);
  closers.push(() => close(sh, name, folder).then(() => undefined));
  return { vm, config, alias, name, folder, ssh: s, sh, must, ctx: { checkout: join(tmp, 'checkout'), deadline: DEADLINE, now: () => Date.now() } };
}

/** Stops, disables, resets and unlinks every user unit whose name holds `name`, then removes `folder`, ~/<name>. */
function close(sh: World['sh'], name: string, folder: string): Promise<Ran> {
  return sh([
    `N='${name}'`,
    'units() { systemctl --user list-units --all --plain --no-legend --no-pager 2>/dev/null | awk \'{print $1}\' | grep -F -- "$N"; }',
    'for u in $(units); do systemctl --user stop "$u"; done',
    'for u in $(systemctl --user list-unit-files --no-legend --no-pager 2>/dev/null | awk \'{print $1}\' | grep -F -- "$N"); do systemctl --user disable "$u"; done',
    'find "$HOME/.config/systemd/user" -name "*$N*" \\( -type l -o -type f \\) -delete 2>/dev/null',
    'systemctl --user daemon-reload',
    'for u in $(units); do systemctl --user reset-failed "$u"; done',
    `rm -rf '${folder}'`,
    'true',
  ].join('\n'));
}

export const shown = (r: CheckResult, w?: World): string => redact(
  `run ${r.outcome}, ${r.testsRun} run; failures: ${r.failures.map((f) => `${f.assertion ? '(assertion) ' : '(not an assertion) '}${f.message}`).join(' | ') || '(none)'}`,
  w?.ssh,
);
export const listed = (report: SlotReport, w?: World): string => redact(report.cases.map((c) => `${c.id}: ${c.outcome} ${c.message}`).join(' | '), w?.ssh);
const base = { inputs: [] as string[], depth: 'integration', oracle: 'code' as const, contract: null };

// ---- The setting clause: a settings file on the host, a planted drift, and the judge.

/** The settings the definition requires; the drift changes the second. */
export const REQUIRED = { listen_address: '127.0.0.1', max_connections: '100' } as const;
export const DRIFTED = { name: 'max_connections', to: '500' } as const;
const settingsText = (max: string): string => ['# dh1943 test service settings', 'listen_address = 127.0.0.1', `max_connections = ${max}`, 'log_level = info', ''].join('\n');

/** Writes `<folder>/<tag>/service.conf` on the host, every required setting holding: the setting check's spec for it. */
export async function settingsOnHost(w: World, tag: string): Promise<SettingSpec> {
  const file = `${w.folder}/${tag}/service.conf`;
  await w.must(`mkdir -p '${w.folder}/${tag}' && cat > '${file}'`, settingsText(REQUIRED.max_connections));
  return { ...base, kind: 'setting', runner: 'ssh', host: w.alias, file, settings: { ...REQUIRED } };
}

/**
 * The setting clause, on one fill: with every required setting holding, the check passes; after a planted drift sets
 * max_connections to 500 in the file on the host (written in place, as an edit outside the work would), the same fill's
 * next run fails, a failure at the check's assertion naming max_connections and none naming listen_address, which holds.
 * Each finding is a sentence; none means the fill met the clause.
 */
export async function judgeSetting(w: World, fill: HostFill, spec: SettingSpec): Promise<string[]> {
  const findings: string[] = [];
  const held = await fill.run(spec, w.ctx);
  if (held.outcome !== 'passed') findings.push(`with every required setting holding in ${spec.file} on ${w.alias}, the setting check reported ${shown(held, w)}; it must pass`);
  await w.must(`cat > '${spec.file}' && grep -qx '${DRIFTED.name} = ${DRIFTED.to}' '${spec.file}'`, settingsText(DRIFTED.to));
  const drifted = await fill.run(spec, w.ctx);
  if (drifted.outcome !== 'failed') {
    findings.push(`the setting check missed the drift of ${DRIFTED.name} (${REQUIRED.max_connections} to ${DRIFTED.to} on ${w.alias}): it reported ${shown(drifted, w)}; it must fail`);
    return findings;
  }
  if (!drifted.failures.some((f) => f.assertion && f.message.includes(DRIFTED.name))) findings.push(`after the drift of ${DRIFTED.name}, no failure at the setting check's assertion names ${DRIFTED.name}: ${shown(drifted, w)}`);
  if (drifted.failures.some((f) => f.message.includes('listen_address'))) findings.push(`after the drift of ${DRIFTED.name}, a failure names listen_address, which still holds: ${shown(drifted, w)}`);
  return findings;
}

// ---- The machine clause: two user services on the host, and the judge.

export interface Services { steady: string; stale: string }
/**
 * Makes two enabled, active user services on the host, `<name>-<tag>-steady.service` and `<name>-<tag>-stale.service`,
 * each a script in the test's folder that runs while the folder exists. The stale one takes a lock (a folder) on start
 * and never gives it back, so any start after its first finds the lock, says so on stderr and exits 1 at once: it
 * doesn't survive a restart. Read back as enabled and active (BLOCKED otherwise) before the check sees them.
 */
export async function servicesOnHost(w: World, tag: string): Promise<Services> {
  const units: Services = { steady: `${w.name}-${tag}-steady.service`, stale: `${w.name}-${tag}-stale.service` };
  const lock = `${w.folder}/${tag}-stale.lock`;
  const scripts: Record<keyof Services, string> = {
    steady: ['#!/bin/sh', `while [ -d '${w.folder}' ]; do sleep 2; done`, ''].join('\n'),
    stale: ['#!/bin/sh', `mkdir '${lock}' 2>/dev/null || { echo 'a stale lock from the last run is in the way' >&2; exit 1; }`, `while [ -d '${w.folder}' ]; do sleep 2; done`, ''].join('\n'),
  };
  for (const which of ['steady', 'stale'] as const) {
    const script = `${w.folder}/${tag}-${which}.sh`;
    const unit = [
      '[Unit]', `Description=dh1943 test service (${tag}, ${which})`, '', '[Service]', `ExecStart=/bin/sh ${script}`, '', '[Install]', 'WantedBy=default.target', '',
    ].join('\n');
    await w.must(`cat > '${script}'`, scripts[which]);
    await w.must(`cat > '${w.folder}/${units[which]}'`, unit);
    await w.must(`systemctl --user link '${w.folder}/${units[which]}' && systemctl --user enable --now '${units[which]}'`);
  }
  await new Promise((resolve) => setTimeout(resolve, 1500));
  for (const unit of Object.values(units)) {
    const state = (await w.sh(`systemctl --user is-enabled '${unit}'; systemctl --user is-active '${unit}'`)).stdout.split('\n').map((l) => l.trim());
    if (state[0] !== 'enabled' || state[1] !== 'active') throw Error(`BLOCKED: the harness's ${unit} on ${w.vm} reads ${JSON.stringify(state.slice(0, 2))}, not enabled and active, before the check`);
  }
  await w.must(`[ -d '${lock}' ]`);
  return units;
}

export const machineSpec = (w: World, service: string): MachineSpec => ({ ...base, kind: 'machine', runner: 'ssh', host: w.alias, service });
/** A unit's name as a failure may give it: with or without `.service`. */
const bare = (unit: string): string => unit.replace(/\.service$/, '');

/**
 * The machine clause, on one fill: the steady service, enabled, survives the check's restart, and the check passes; the
 * stale one, enabled and active until it is restarted, fails the check, a failure at its assertion naming that service.
 * Each finding is a sentence; none means the fill met the clause.
 */
export async function judgeMachine(w: World, fill: HostFill, units: Services): Promise<string[]> {
  const findings: string[] = [];
  const steady = await fill.run(machineSpec(w, units.steady), w.ctx);
  if (steady.outcome !== 'passed') findings.push(`${units.steady} on ${w.alias}, enabled and surviving a restart, got ${shown(steady, w)}; the machine check must pass it`);
  const stale = await fill.run(machineSpec(w, units.stale), w.ctx);
  if (stale.outcome !== 'failed') {
    findings.push(`the machine check passed ${units.stale} on ${w.alias}, which doesn't survive a restart: it reported ${shown(stale, w)}; it must fail`);
    return findings;
  }
  if (!stale.failures.some((f) => f.assertion && f.message.includes(bare(units.stale)))) findings.push(`no failure at the machine check's assertion names ${bare(units.stale)}, the service that didn't survive its restart: ${shown(stale, w)}`);
  return findings;
}

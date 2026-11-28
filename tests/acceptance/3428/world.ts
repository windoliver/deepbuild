// What every #3428 test shares (README, The worlds): a home as #27's tests make one (`<tmp>/h` is HOME for every
// process, `<tmp>/bin` first on PATH with #27's stand-ins for launchctl, systemctl and claude and a `deep` that runs the
// built CLI), the stand-in `paseo` of fixtures/paseo.mjs at the version a test plants, paseo's config.json in bytes
// paseo itself never writes, a local npm registry on 127.0.0.1 for the facts' install source, and `deep setup`,
// `deep setup --undo` and `deep doctor --json` run as you run them. #27's helpers are imported (same repo, same
// license); nothing here stands in for DeepBuild's code. Processes are stopped by PID, folders are /tmp/dh27-*, and
// the real ~/.deepbuild, ~/.paseo, ~/.claude and ~/.npmrc are never touched.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allEvents, cleanup as cleanup27, deep, makeHome, NODE, REPO, shown, startHub, type Ev, type Hub, type Ran } from '../27/helpers.ts';
import { compare, parse, satisfies } from './range.ts';

export { allEvents, NODE, REPO, shown, type Ev, type Hub, type Ran };
export type Line = { [key: string]: any };

/** Each criterion's tag: `#3428.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (tests/acceptance/48/README.md). */
export const AC = {
  1: 'AC1 #3428.c21bc24c', 2: 'AC2 #3428.ffe37f29', 3: 'AC3 #3428.25c11692', 4: 'AC4 #3428.cfb1bd37', 5: 'AC5 #3428.53c885f5',
} as const;

/**
 * paseo's newest stable release as this job read it: npm's `latest` for @getpaseo/cli on Nov 27 2026 (0.17.5 on
 * Nov 26, 0.17.6 on Nov 27). No test reads the network, so a newer stable release given through DEEP_PASEO_CLI
 * counts in its place (README, AC1).
 */
export const NEWEST_STABLE = '0.17.6';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
export const PLUGIN = join(REPO, 'packages/paseo');
export const FACTS_FILE = join(REPO, 'adapters/paseo.facts.json');
export const MANIFEST_FILE = join(PLUGIN, 'paseo-plugin.json');
export const facts = (): Line => JSON.parse(readFileSync(FACTS_FILE, 'utf8')) as Line;
/** The versions paseo's facts cover, newest last. */
export const covered = (): string[] => facts().versions as string[];
export const newestCovered = (): string => covered().at(-1)!;
/** The facts' install source, `npm:<name>@<version>`, and its parts. */
export function source(): { source: string; name: string; version: string } {
  const s = String(facts().install?.source ?? '');
  const m = /^npm:(@?[^@]+)@(.+)$/.exec(s);
  if (!m) throw Error(`paseo's facts name no npm install source with a version: ${JSON.stringify(facts().install)}`);
  return { source: s, name: m[1]!, version: m[2]! };
}
/** The plugin's `requirements.paseo`. */
export const range = (): string => String((JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as Line).requirements?.paseo ?? '');
/** A version past every one the facts cover: the newest's minor, plus one. */
export function newerThanFacts(): string {
  const v = parse(newestCovered())!;
  return `${v[0]}.${v[1] + 1}.0`;
}
/** The newest release covered is paseo's newest stable one, and the plugin's range holds it: what the criteria past AC1 that need a covered release wait on. */
export function coveredRelease(): string | undefined {
  const newest = newestCovered();
  const stable = parse(newest);
  if (!stable || compare(stable, parse(NEWEST_STABLE)!) < 0) return `the facts' newest paseo is ${newest}, not paseo's newest stable release (${NEWEST_STABLE} or later)`;
  if (!satisfies(newest, range())) return `the plugin's range ${range()} doesn't hold ${newest}`;
  return undefined;
}
/** Criteria that need a covered release read BLOCKED until AC1 holds (the issue's AC1): called once a test's own assertions hold. */
export function needCoveredRelease(what: string): void {
  const missing = coveredRelease();
  if (missing) throw Error(`BLOCKED: ${what} held on this program, but ${missing}; until #55's real-daemon cases pass on the newest stable paseo and the facts and the plugin's range name it (${AC[1]}), this reads BLOCKED, never PASS`);
}

// ---- The plugin as paseo installs it: a copy of packages/paseo, and its npm tarball.
const PACKAGE_FILES = ['package.json', 'paseo-plugin.json', 'index.server.ts', 'server', 'README.md'];
/** A copy of packages/paseo in `dir`, its range replaced when `requires` is given (an old copy of the plugin). */
function pluginCopy(dir: string, requires?: string): string {
  mkdirSync(dir, { recursive: true });
  for (const f of PACKAGE_FILES) if (existsSync(join(PLUGIN, f))) cpSync(join(PLUGIN, f), join(dir, f), { recursive: true });
  if (requires !== undefined) {
    const manifest = JSON.parse(readFileSync(join(dir, 'paseo-plugin.json'), 'utf8')) as Line;
    writeFileSync(join(dir, 'paseo-plugin.json'), `${JSON.stringify({ ...manifest, requirements: { ...(manifest.requirements ?? {}), paseo: requires } }, null, 2)}\n`);
  }
  return dir;
}
/** An npm tarball of a plugin copy: its files under `package/`, as npm packs them. */
function tarball(tmp: string, requires?: string): Buffer {
  const at = join(tmp, `pack-${Math.random().toString(16).slice(2, 8)}`);
  pluginCopy(join(at, 'package'), requires);
  execFileSync('tar', ['-czf', join(at, 'p.tgz'), '-C', at, 'package']);
  return readFileSync(join(at, 'p.tgz'));
}

// ---- npm's registry, on 127.0.0.1 (as tests/acceptance/55's registry()): one that serves the source, or answers 404.
const servers: Server[] = [];
export interface Registry { url: string; asked: string[] }
async function registry(name: string, versions: Record<string, Buffer> | 'answers 404'): Promise<Registry> {
  const asked: string[] = [];
  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? '');
    asked.push(`${req.method} ${url}`);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    if (versions !== 'answers 404' && url === `/${name}`) {
      const entries = Object.entries(versions);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        name, 'dist-tags': { latest: entries.at(-1)![0] },
        versions: Object.fromEntries(entries.map(([v, tgz]) => [v, { name, version: v, dist: { tarball: `${base}/t/${v}.tgz`, shasum: createHash('sha1').update(tgz).digest('hex'), integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` } }])),
      }));
      return;
    }
    const t = /^\/t\/(.+)\.tgz$/.exec(url);
    if (versions !== 'answers 404' && t && versions[t[1]!]) { res.end(versions[t[1]!]); return; }
    res.statusCode = 404;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Not found' }));
  });
  servers.push(server);
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, asked };
}

export async function cleanup(): Promise<void> {
  for (const s of servers.splice(0)) await new Promise((done) => s.close(done));
  await cleanup27();
}

// ---- The world: a home, the stand-in paseo, its config.json and the registry.
export interface World {
  tmp: string; home: string; bin: string;
  /** paseo's config.json, under the test's HOME. */
  configFile: string;
  /** Its bytes as planted, before any command ran. */
  before: Buffer;
  /** What every DeepBuild command of the test gets: npm's registry and cache. */
  env: Record<string, string>;
  registry: Registry;
  /** The hub, started as #27's tests start it, where the test runs deep setup (which reports its steps to it). */
  hub: Hub | undefined;
  /** Every command the stand-in paseo was run with, in order. */
  calls(): Line[];
}
export interface WorldOptions {
  /** The version the stand-in's CLI and daemon report. */
  version: string;
  /** No paseo plugin installed; or DeepBuild's installed from the facts' source and loading as paseo decides; or an old copy of it whose range is `>=0.14.0 <0.15.0`, which paseo refuses at load. */
  plugin: 'none' | 'installed' | 'old copy';
  /** The registry serves the facts' source (the plugin as packages/paseo has it, or the old copy), or answers 404 for it. */
  registry: 'serves' | 'answers 404';
  /** A hub running in the home before anything else: what `deep setup` reports its steps to and ends with. */
  hub?: boolean;
}
/** The old copy's range: older than any paseo the facts have covered. */
export const OLD_RANGE = '>=0.14.0 <0.15.0';

/**
 * paseo's config.json as a person's paseo holds it: pretty-printed by hand with four spaces and objects on one line, a
 * form paseo's own writes (`JSON.stringify(config, null, 2)`) never give, so any write shows in its bytes.
 */
function plantedConfig(plugins: Line | undefined): string {
  const lines = ['{', '    "version": 1,', '    "daemon": { "listen": "127.0.0.1:6767", "relay": { "enabled": false } },', '    "pluginsEnabled": true'];
  if (plugins) {
    lines[lines.length - 1] += ',';
    lines.push(`    "plugins": ${JSON.stringify(plugins)}`);
  }
  return `${lines.join('\n')}\n}\n`;
}

export async function world(o: WorldOptions): Promise<World> {
  const { tmp, home, bin } = makeHome();
  const state = join(tmp, 'paseo-state');
  mkdirSync(state);
  writeFileSync(join(state, 'world.json'), `${JSON.stringify({ version: o.version })}\n`);
  writeFileSync(join(state, 'calls.jsonl'), '');
  const paseoHome = join(home, '.paseo');
  writeFileSync(join(bin, 'paseo'), `#!/bin/sh\nexec '${NODE}' '${join(FIXTURES, 'paseo.mjs')}' '${state}' '${paseoHome}' "$@"\n`);
  chmodSync(join(bin, 'paseo'), 0o755);

  const { name, version } = source();
  const requires = o.plugin === 'old copy' ? OLD_RANGE : undefined;
  const tgz = tarball(tmp, requires);
  const reg = await registry(name, o.registry === 'answers 404' ? 'answers 404' : { [version]: tgz });

  let plugins: Line | undefined;
  if (o.plugin !== 'none') {
    const placed = pluginCopy(join(paseoHome, 'plugins', 'npm', 'deepbuild', version), requires);
    plugins = {
      deepbuild: {
        source: 'npm', path: placed, enabled: true,
        npm: { packageName: name, requestedSpec: version, version, integrity: `sha512-${createHash('sha512').update(tgz).digest('base64')}` },
        installation: { identity: { kind: 'npm', packageName: name, pluginPath: '.' }, currentRevision: version },
      },
    };
  }
  mkdirSync(paseoHome, { recursive: true });
  const configFile = join(paseoHome, 'config.json');
  writeFileSync(configFile, plantedConfig(plugins));
  // npm's registry where npm itself reads it, for whoever checks the source and for paseo's daemon.
  writeFileSync(join(home, '.npmrc'), `registry=${reg.url}\n`);
  const env = { npm_config_registry: reg.url, npm_config_cache: join(tmp, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' };
  const calls = () => readFileSync(join(state, 'calls.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);
  const hub = o.hub ? await startHub(home) : undefined;
  return { tmp, home, bin, configFile, before: readFileSync(configFile), env, registry: reg, hub, calls };
}

// ---- What the stand-in paseo was asked.
const READS = [['status'], ['daemon', 'status'], ['plugin', 'ls'], ['plugin', 'status'], ['plugin', 'logs']];
const words = (c: Line): string[] => (c.words ?? []) as string[];
const said = (c: Line): string => `paseo ${(c.args as string[]).join(' ')}`;
/** `paseo plugin install|add <source>`. */
export const installs = (calls: Line[]): Line[] => calls.filter((c) => words(c)[0] === 'plugin' && ['install', 'add'].includes(words(c)[1] ?? ''));
/** Every command that can change paseo's plugins or its files: anything but a version, a status or a listing. */
export const changing = (calls: Line[]): Line[] => calls.filter((c) => {
  const w = words(c);
  if (!w.length) return !(c.args as string[]).some((a) => ['-v', '--version', '-h', '--help'].includes(a));
  return !READS.some((r) => r.every((x, i) => w[i] === x)) && !(c.args as string[]).some((a) => a === '--help' || a === '-h');
});
export const shownCalls = (calls: Line[]): string => calls.map(said).join('; ') || 'none';

// ---- deep setup, deep setup --undo, deep doctor.
export const setup = (w: World): Promise<Ran> => deep(w.home, ['setup'], { env: w.env, timeoutMs: 300_000 });
export const undo = (w: World): Promise<Ran> => deep(w.home, ['setup', '--undo'], { env: w.env, timeoutMs: 300_000 });
/** What a run said, stdout and stderr, line by line. */
export const linesOf = (r: Ran): string[] => `${r.stdout}\n${r.stderr}`.split('\n').map((l) => l.trim()).filter(Boolean);
/** A text with the test's home written as ~ and its temp folder as <tmp>, as a record keeps them. */
export const redact = (w: World, text: string): string => text.split(w.home).join('~').split(w.tmp).join('<tmp>');

/** `deep doctor --json`: its items, as doctor.item@1 objects with their item and agent. */
export async function doctor(w: World, env: Record<string, string | undefined> = {}): Promise<{ ran: Ran; items: Line[] }> {
  const ran = await deep(w.home, ['doctor', '--json'], { env: { ...w.env, ...env }, timeoutMs: 300_000 });
  const items = ran.stdout.split('\n').flatMap((l) => { try { const o = JSON.parse(l) as Line; return o && typeof o === 'object' && typeof o.item === 'string' ? [o] : []; } catch { return []; } });
  if (!items.length) throw Error(`BLOCKED: deep doctor --json printed no item: ${shown(ran)}`);
  return { ran, items };
}
/** paseo's items: those whose agent is paseo, as Claude Code's are claude-code's. */
export const paseoItems = (items: Line[]): Line[] => items.filter((i) => i.agent === 'paseo');
export const itemsShown = (items: Line[]): string => JSON.stringify(items.map((i) => ({ item: i.item, code: i.code, level: i.level, evidence: String(i.evidence).slice(0, 300) })));
/** The doctor family's codes (doctor.item@N): a stable code is one of them. */
export function doctorCodes(): Set<string> {
  const dir = join(REPO, 'packages/contracts/schemas');
  const codes = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => /^doctor\.item@\d+\.json$/.test(f))) for (const c of ((JSON.parse(readFileSync(join(dir, f), 'utf8')) as Line).properties?.code?.enum ?? []) as string[]) codes.add(c);
  return codes;
}

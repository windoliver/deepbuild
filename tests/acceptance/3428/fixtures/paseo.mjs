// The stand-in `paseo` (README, The worlds): a paseo CLI and its running daemon in one process per command, at the
// version the test plants, owning `<home>/.paseo/config.json` as paseo does. It speaks the shapes of
// @getpaseo/cli 0.17.6 as this job read them (`paseo -v`; `paseo status` and `paseo daemon status --json`, whose
// `daemonVersion` is the running daemon's; `paseo plugin ls --json`, an array of plugin.list items with `status`
// running, disabled or failed and the load's `error`; `paseo plugin install|add <source>` from a directory or an
// `npm:` source; `paseo plugin remove|enable|disable|reload <id>`; errors as `Error: <message>` on stderr, exit 1).
// A plugin's state is computed as paseo computes it at load: plugins on, the entry enabled, and its
// `requirements.paseo` holding the daemon's version (paseo's own words when it doesn't, from
// @getpaseo/protocol's plugin-requirements.ts). An `npm:` source is read from npm's configured registry
// (npm_config_registry, else `registry=` in ~/.npmrc), as the daemon's npm reads it; nothing here reaches past it.
// Every command is appended to `<state>/calls.jsonl` before it runs. paseo writes config.json pretty-printed, so any
// write it makes shows as a change to the bytes the test planted.
//
// Usage (the wrapper `deep setup` and `deep doctor` find on PATH): node paseo.mjs <state dir> <paseo home> <args...>
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { satisfies } from '../range.ts';

const [state, defaultHome, ...argv] = process.argv.slice(2);
const world = JSON.parse(readFileSync(join(state, 'world.json'), 'utf8'));
const VERSION = world.version;

// ---- Options paseo takes anywhere on the line.
const WITH_VALUE = new Set(['--home', '--host', '-o', '--format', '--id', '--ref', '--path']);
const opts = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (WITH_VALUE.has(a)) opts[a] = argv[++i];
  else if (a.startsWith('--') && a.includes('=') && WITH_VALUE.has(a.slice(0, a.indexOf('=')))) opts[a.slice(0, a.indexOf('='))] = a.slice(a.indexOf('=') + 1);
  else if (a.startsWith('-') && a !== '-') opts[a] = true;
  else args.push(a);
}
// The command as given and its words without options, before anything runs.
appendFileSync(join(state, 'calls.jsonl'), `${JSON.stringify({ args: argv, words: args, at: Date.now(), cwd: process.cwd() })}\n`);
const json = opts['--json'] === true || opts['-o'] === 'json' || opts['--format'] === 'json';
const home = resolve(opts['--home'] ?? process.env.PASEO_HOME ?? defaultHome);
const configFile = join(home, 'config.json');

function fail(message, code = 'COMMAND_FAILED') {
  process.stderr.write(json ? `${JSON.stringify({ error: { code, message } }, null, 2)}\n` : `Error: ${message}\n`);
  process.exit(1);
}
/** What commander says of a command paseo doesn't have. */
function unknown(name) {
  process.stderr.write(`error: unknown command '${name}'\n`);
  process.exit(1);
}
function out(data, human) {
  process.stdout.write(`${json ? JSON.stringify(data, null, 2) : human}\n`);
  process.exit(0);
}
const readConfig = () => (existsSync(configFile) ? JSON.parse(readFileSync(configFile, 'utf8')) : {});
function writeConfig(config) {
  mkdirSync(home, { recursive: true });
  writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`);
}
const manifestOf = (dir) => {
  const file = join(dir, 'paseo-plugin.json');
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
};
/** paseo's own check (plugin-requirements.ts at 0.17.6): its words when the plugin's range leaves this daemon out. */
function incompatible(manifest) {
  const range = manifest.requirements?.paseo ?? '<0.8.0';
  if (satisfies(VERSION, range)) return undefined;
  const action = manifest.requirements?.paseo === undefined
    ? 'This plugin has no requirements.paseo and targets Paseo before 0.8. Ask its author to migrate it: https://paseo.sh/docs/plugins/migration'
    : 'Use a compatible plugin version or update the daemon.';
  return `Plugin "${manifest.id}" requires Paseo ${range}. Your daemon is ${VERSION}. ${action}`;
}
/** A configured plugin as `paseo plugin ls` lists it: its load state computed as the daemon computes it. */
function itemOf(id, entry, config) {
  const manifest = manifestOf(entry.path);
  const item = { id, ...(manifest?.name ? { name: manifest.name } : {}), ...(manifest?.description ? { description: manifest.description } : {}), path: entry.path, enabled: entry.enabled !== false };
  if (entry.npm) item.npm = entry.npm;
  if (entry.installation) item.installation = entry.installation;
  if (entry.source === 'directory') item.source = 'directory';
  let error;
  if (entry.enabled === false || config.pluginsEnabled !== true) item.status = 'disabled';
  else if (!manifest) error = `Plugin manifest not found: ${join(entry.path, 'paseo-plugin.json')}`;
  else error = incompatible(manifest);
  if (!item.status) item.status = error ? 'failed' : 'running';
  if (error) item.error = error;
  return item;
}
const listed = (config) => Object.keys(config.plugins ?? {}).sort().map((id) => itemOf(id, config.plugins[id], config));
const row = (p) => `${p.id.padEnd(20)} ${p.status.padEnd(10)} ${(p.enabled ? 'yes' : 'no').padEnd(8)} ${p.path}${p.error ? `  ${p.error}` : ''}`;
const table = (items) => ['PLUGIN               STATUS     ENABLED  DIRECTORY', ...items.map(row)].join('\n');

/** npm's configured registry, as the daemon's npm reads it. */
function registryUrl() {
  const fromEnv = Object.entries(process.env).find(([k]) => k.toLowerCase() === 'npm_config_registry')?.[1];
  if (fromEnv) return fromEnv.endsWith('/') ? fromEnv : `${fromEnv}/`;
  const rc = join(process.env.HOME ?? homedir(), '.npmrc');
  const line = existsSync(rc) ? /^registry\s*=\s*(\S+)/m.exec(readFileSync(rc, 'utf8'))?.[1] : undefined;
  if (line) return line.endsWith('/') ? line : `${line}/`;
  fail('npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/ failed: this stand-in reaches no registry but a local one');
}
async function fromNpm(source) {
  const spec = source.replace(/^npm:/, '');
  const at = spec.lastIndexOf('@');
  const [name, selector] = at > 0 ? [spec.slice(0, at), spec.slice(at + 1)] : [spec, 'latest'];
  const url = `${registryUrl()}${name.replace('/', '%2f')}`;
  let res;
  try { res = await fetch(url, { headers: { accept: 'application/json' } }); } catch (e) { fail(`npm error code ECONNREFUSED\nnpm error request to ${url} failed: ${e.message}`); }
  if (res.status === 404) fail(`npm error code E404\nnpm error 404 Not Found - GET ${url} - Not found\nnpm error 404  '${name}@${selector}' is not in this registry.`);
  if (!res.ok) fail(`npm error code E${res.status}\nnpm error ${res.status} - GET ${url}`);
  const doc = await res.json();
  const version = doc.versions?.[selector] ? selector : doc['dist-tags']?.[selector];
  if (!version || !doc.versions?.[version]) fail(`No npm version matches ${name}@${selector}`);
  const tgz = await fetch(doc.versions[version].dist.tarball);
  if (!tgz.ok) fail(`npm error code E${tgz.status}\nnpm error ${tgz.status} - GET ${doc.versions[version].dist.tarball}`);
  const dir = mkdtempSync(join(tmpdir(), 'dh3428-npm-'));
  writeFileSync(join(dir, 'p.tgz'), Buffer.from(await tgz.arrayBuffer()));
  mkdirSync(join(dir, 'package'));
  execFileSync('tar', ['-xzf', join(dir, 'p.tgz'), '-C', join(dir, 'package'), '--strip-components=1']);
  return { dir, folder: join(dir, 'package'), name, selector, version };
}

const [command, sub, target] = args;
if (opts['-v'] || opts['--version']) out(VERSION, VERSION);
if (command === 'status' || (command === 'daemon' && sub === 'status')) {
  const data = { home, pid: world.pid ?? 4242, listen: world.listen ?? '127.0.0.1:6767', localDaemon: 'running', desktopManaged: false, daemonVersion: VERSION, connectedDaemon: 'reachable' };
  out(data, Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n'));
}
if (command === 'plugin') {
  const config = readConfig();
  if (sub === 'ls' || sub === 'status') {
    const items = listed(config).filter((p) => !target || p.id === target);
    if (target && !items.length) fail(`Plugin is not configured: ${target}`);
    out(items, table(items));
  }
  if (sub === 'logs') out([], 'TIME STREAM MESSAGE');
  if (sub === 'install' || sub === 'add') {
    if (!target) unknown('plugin install');
    process.stderr.write('Trusting plugin code: server code and preparation commands run unsandboxed on the daemon host; client code runs inside Paseo. Dependencies and future updates are part of the codebase you trust.\n');
    const npm = target.startsWith('npm:');
    const got = npm ? await fromNpm(target) : undefined;
    const folder = got ? got.folder : resolve(target);
    const manifest = manifestOf(folder);
    if (!manifest) fail(`Plugin manifest not found: ${join(folder, 'paseo-plugin.json')}`);
    const refused = incompatible(manifest);
    if (refused) { if (got) rmSync(got.dir, { recursive: true, force: true }); fail(refused); }
    const id = opts['--id'] ?? manifest.id;
    if (config.plugins?.[id]) { if (got) rmSync(got.dir, { recursive: true, force: true }); fail(`Plugin ID "${id}" is already configured; choose another ID with --id`); }
    let entry = { source: 'directory', path: folder, enabled: true };
    if (got) {
      const placed = join(home, 'plugins', 'npm', id, got.version);
      mkdirSync(placed, { recursive: true });
      cpSync(got.folder, placed, { recursive: true });
      rmSync(got.dir, { recursive: true, force: true });
      entry = {
        source: 'npm', path: placed, enabled: true,
        npm: { packageName: got.name, requestedSpec: got.selector, version: got.version, integrity: 'sha512-stand-in' },
        installation: { identity: { kind: 'npm', packageName: got.name, pluginPath: '.' }, currentRevision: got.version },
      };
    }
    config.plugins = { ...(config.plugins ?? {}), [id]: entry };
    writeConfig(config);
    const item = itemOf(id, entry, config);
    if (item.status === 'failed') fail(item.error ?? `Plugin failed to start: ${id}`);
    out(item, table([item]));
  }
  if (['remove', 'rm', 'uninstall', 'enable', 'disable', 'reload'].includes(sub)) {
    if (!target) unknown(`plugin ${sub}`);
    const entry = config.plugins?.[target];
    if (!entry) fail(`Plugin is not configured: ${target}`);
    if (sub === 'reload') {
      if (entry.enabled === false) fail(`Plugin is disabled: ${target}`);
      if (config.pluginsEnabled !== true) fail('Plugins are globally disabled');
      out(itemOf(target, entry, config), table([itemOf(target, entry, config)]));
    }
    if (sub === 'enable' || sub === 'disable') {
      config.plugins[target] = { ...entry, enabled: sub === 'enable' };
      writeConfig(config);
      out(itemOf(target, config.plugins[target], config), table([itemOf(target, config.plugins[target], config)]));
    }
    const item = { ...itemOf(target, entry, config), enabled: false, status: 'disabled' };
    delete config.plugins[target];
    writeConfig(config);
    out(item, table([item]));
  }
  unknown(`plugin ${sub ?? ''}`);
}
unknown(command ?? '');

#!/usr/bin/env node
// The release rehearsal (#41): before any publish, every package goes to a registry on loopback and nowhere else.
//   node scripts/release-rehearse.mjs --archives <release-pack --out folder> --work <new folder>
// It refuses the whole run, before any upload, when an archive's publishConfig.registry (which npm publish honours
// over any flag) is not on loopback, naming the URL. Otherwise it starts a registry of its own on 127.0.0.1, publishes
// every archive there with npm, installs `deepbuild` into a fresh project (<work>/project, HOME <work>/home), runs the
// installed `deep --version` and `deep doctor`, stops the registry, removes node_modules and reinstalls from the npm
// cache with every network path a loopback listener that counts connections. Exit 0 only when all of that held and
// the reinstall made no connection.
import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { isIP, createServer as createTcpServer } from 'node:net';
import { join, resolve } from 'node:path';

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const fail = (message) => {
  console.error(`release-rehearse: ${message}`);
  process.exit(1);
};
const [archivesArg, workArg] = [flag('archives'), flag('work')];
if (!archivesArg || !workArg) fail('usage: release-rehearse.mjs --archives <dir> --work <dir>');
const archives = resolve(archivesArg);
const work = resolve(workArg);
if (existsSync(work)) fail(`${work} already exists; the rehearsal needs a fresh folder`);

/** A command's exit and output, run without blocking this process, whose registry has to keep answering. */
const run = (command, args, opts) => new Promise((done) => {
  const child = spawn(command, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
  child.on('error', (error) => done({ code: null, stdout, stderr: `${stderr}${error.message}` }));
  child.on('close', (code) => done({ code, stdout, stderr }));
});
const untar = (file, path) => new Promise((done, reject) => {
  const child = spawn('tar', ['-xzOf', file, path], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (d) => chunks.push(d));
  child.on('close', (code) => (code === 0 ? done(Buffer.concat(chunks)) : reject(Error(`${file} holds no ${path}`))));
});

const manifest = JSON.parse(readFileSync(join(archives, 'manifest.json'), 'utf8'));
const packages = [];
for (const a of manifest.archives) {
  const file = join(archives, a.file);
  packages.push({ file, meta: JSON.parse((await untar(file, 'package/package.json')).toString('utf8')) });
}

// Before any upload: each archive's own publish target, by every address its host resolves to.
const LOOPBACK4 = /^127\./;
const loopbackAddress = (address) => (isIP(address) === 4 ? LOOPBACK4.test(address) : address === '::1' || /^::ffff:127\./i.test(address));
const offLoopback = [];
for (const { meta } of packages) {
  const url = meta.publishConfig?.registry;
  if (url === undefined) continue;
  let host;
  try {
    host = new URL(url).hostname.replace(/^\[|\]$/g, '');
  } catch {
    offLoopback.push(`${meta.name} publishes to ${url}, which is no URL`);
    continue;
  }
  let addresses = [];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch { /* resolves to nothing: not loopback */ }
  if (!addresses.length || !addresses.every(loopbackAddress)) offLoopback.push(`${meta.name} publishes to ${url}, whose host ${host} is not on loopback${addresses.length ? ` (${addresses.join(', ')})` : ''}`);
}
if (offLoopback.length) fail(`refused before any upload; nothing was published:\n  ${offLoopback.join('\n  ')}`);

// The registry: npm's publish and install routes, in memory, on 127.0.0.1 only.
const stored = new Map();
const sockets = new Set();
const registry = createServer((req, res) => {
  const chunks = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    const tarball = /^\/(.+)\/-\/([^/]+)$/.exec(path);
    if (tarball && (req.method === 'GET' || req.method === 'HEAD')) {
      const bytes = stored.get(decodeURIComponent(tarball[1]))?.files.get(decodeURIComponent(tarball[2]));
      return bytes ? send(200, bytes, 'application/octet-stream') : send(404, { error: 'not found' });
    }
    const name = decodeURIComponent(path.slice(1));
    if (req.method === 'PUT') {
      const doc = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const entry = stored.get(name) ?? { versions: {}, files: new Map() };
      for (const [file, { data }] of Object.entries(doc._attachments ?? {})) entry.files.set(file, Buffer.from(data, 'base64'));
      for (const [version, meta] of Object.entries(doc.versions ?? {})) {
        const file = meta.dist.tarball.split('/-/').pop();
        entry.versions[version] = { ...meta, dist: { ...meta.dist, tarball: `${base}/${name}/-/${file}` } };
      }
      stored.set(name, entry);
      return send(201, { ok: true });
    }
    if (req.method !== 'GET') return send(405, { error: 'not allowed' });
    const entry = stored.get(name);
    if (!entry) return send(404, { error: 'not found' });
    const latest = Object.keys(entry.versions).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1);
    send(200, { name, 'dist-tags': { latest }, versions: entry.versions });
  });
});
registry.on('connection', (sock) => { sockets.add(sock); sock.on('close', () => sockets.delete(sock)); });
await new Promise((done) => registry.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${registry.address().port}`;
const url = `${base}/`;
let stopped = false;
const stop = async () => {
  if (stopped) return;
  stopped = true;
  for (const sock of sockets) sock.destroy();
  await new Promise((done) => registry.close(() => done()));
};
console.log(`registry: ${url}`);

const home = join(work, 'home');
const project = join(work, 'project');
mkdirSync(home, { recursive: true });
mkdirSync(project, { recursive: true });
const npmrc = join(home, '.npmrc');
writeFileSync(npmrc, `registry=${url}\n@deepbuild:registry=${url}\n//127.0.0.1:${registry.address().port}/:_authToken=rehearsal\naudit=false\nfund=false\nupdate-notifier=false\n`, { mode: 0o600 });
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_|NPM_|DEEP_|NODE_OPTIONS$)/i.test(k)));
const env = { ...clean, HOME: home, npm_config_userconfig: npmrc, npm_config_cache: join(home, '.npm') };
const npm = 'npm';

let ok = false;
try {
  for (const { file, meta } of packages) {
    const r = await run(npm, ['publish', file, '--registry', url, `--@deepbuild:registry=${url}`, '--access', 'public', '--ignore-scripts'], { cwd: work, env });
    if (r.code !== 0) throw Error(`npm publish ${meta.name}@${meta.version} failed:\n${r.stderr.trim()}`);
    if (!stored.get(meta.name)?.versions[meta.version]) throw Error(`npm publish ${meta.name}@${meta.version} exited 0, but this registry received nothing`);
    console.log(`published: ${meta.name}@${meta.version}`);
  }

  const root = packages.find((p) => p.meta.name === 'deepbuild');
  if (!root) throw Error(`the release holds no deepbuild package; it holds ${packages.map((p) => p.meta.name).join(', ')}`);
  writeFileSync(join(project, 'package.json'), '{ "name": "rehearsal-project", "version": "1.0.0", "private": true }\n');
  const install = await run(npm, ['install', `deepbuild@${root.meta.version}`, '--ignore-scripts'], { cwd: project, env });
  if (install.code !== 0) throw Error(`npm install deepbuild failed:\n${install.stderr.trim()}`);
  const deep = join(project, 'node_modules', '.bin', 'deep');
  const version = await run(deep, ['--version'], { cwd: project, env });
  console.log(`deep --version: ${version.stdout.trim()}`);
  if (version.code !== 0 || version.stdout.trim() !== root.meta.version) throw Error(`deep --version exited ${version.code}, printing ${JSON.stringify(version.stdout.trim())}, not ${root.meta.version}:\n${version.stderr.trim()}`);
  const doctor = await run(deep, ['doctor'], { cwd: project, env });
  console.log(`deep doctor: exit ${doctor.code}`);
  // doctor's own verdicts: 0 passed, 1 an item failed, 3 an item not checked; anything else is doctor not running.
  if (![0, 1, 3].includes(doctor.code)) throw Error(`deep doctor didn't run:\n${doctor.stdout.trim()}\n${doctor.stderr.trim()}`);

  await stop();
  console.log('registry stopped');

  // The reinstall from the cache, every network path a loopback listener counting each connection.
  rmSync(join(project, 'node_modules'), { recursive: true, force: true });
  let connections = 0;
  const trip = createTcpServer((sock) => { connections += 1; sock.destroy(); });
  await new Promise((done) => trip.listen(0, '127.0.0.1', done));
  const tripUrl = `http://127.0.0.1:${trip.address().port}/`;
  const offline = { ...env, npm_config_registry: tripUrl, 'npm_config_@deepbuild:registry': tripUrl, npm_config_proxy: tripUrl, npm_config_https_proxy: tripUrl, npm_config_noproxy: '' };
  const again = await run(npm, ['ci', '--offline', '--ignore-scripts', '--registry', tripUrl, `--@deepbuild:registry=${tripUrl}`], { cwd: project, env: offline });
  await new Promise((done) => trip.close(() => done()));
  console.log(`reinstall network requests: ${connections}`);
  if (again.code !== 0) throw Error(`the reinstall from the npm cache failed:\n${again.stderr.trim()}`);
  if (connections) throw Error(`the reinstall made ${connections} network connection${connections === 1 ? '' : 's'}`);
  ok = true;
} catch (error) {
  console.error(`release-rehearse: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await stop();
}
process.exit(ok ? 0 : 1);

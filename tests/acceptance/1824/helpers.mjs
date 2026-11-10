// Test-side tools for the #1824 acceptance tests (README: The surface). The forge that serves outside files is a
// boundary this repo doesn't own, so `sandbox()` stands it in: a server on 127.0.0.1 this process runs, which serves
// the pinned files and records every request it gets. That record is the issue's "network log". Every process a test
// starts gets a temporary HOME, XDG_CACHE_HOME and TMPDIR, and every proxy variable points at the same recorder, so a
// request for any other host lands in the log as `outside` and fails the judge that sees it.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../../..');
/** The fetcher and the lint: one script, in the checkout under test. */
export const SCRIPT = join(REPO, 'scripts', 'fetch-lock.mjs');
/** The lock file, relative to the folder the script runs in. */
export const LOCK = 'scripts/fetch-lock.json';
/** The cache, relative to HOME: a row's file is `<HOME>/.deepbuild/fetched/<path>`. */
export const CACHE = ['.deepbuild', 'fetched'];
/** The one variable that allows the network. */
export const NETWORK = 'DEEP_FETCH_NETWORK';
export const twin = (name) => join(HERE, 'twins', `${name}.mjs`);
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** A pinned commit: 40 hex characters. */
export const COMMIT = '5d0c3a9e7b1f24680ace13579bdf02468ace1357';
/** The pinned files: tiny, made here, served by the stand-in forge at COMMIT. */
export const FILES = [
  { path: 'lib/src/alpha.js', bytes: Buffer.from('export const alpha = 1;\n'), credit: 'Fixture Library authors, MIT' },
  { path: 'lib/src/beta.js', bytes: Buffer.from('export const beta = 2;\n'), credit: 'Fixture Library authors, MIT' },
  { path: 'lib/data/gamma.txt', bytes: Buffer.from('gamma 3\n'), credit: 'Fixture Data, CC0-1.0' },
];
/** A file the forge serves at COMMIT that no lock row lists. */
export const UNLISTED = { path: 'lib/src/unlisted.js', bytes: Buffer.from('export const unlisted = 4;\n') };

const stop = (child) => { if (child.exitCode === null && child.signalCode === null) try { process.kill(child.pid, 'SIGKILL'); } catch { /* it ended */ } };

/**
 * A sandbox removed when `done()` is called: a working folder with `scripts/`, a HOME, a TMPDIR and the stand-in forge.
 * `requests` is the network log: one entry per request the forge got, `{ method, url, path, outside }`.
 */
export async function sandbox() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1824-')));
  const home = join(dir, 'home'), temp = join(dir, 'tmp'), tree = join(dir, 'tree');
  for (const folder of [home, temp, join(tree, 'scripts')]) mkdirSync(folder, { recursive: true });
  const requests = [], served = new Map(), children = new Set();
  let origin = '';
  const server = createServer((request, response) => {
    // A request through the proxy variables arrives in absolute form; one for another host never leaves this machine.
    const target = new URL(request.url, origin);
    const outside = target.origin !== origin;
    const file = outside ? undefined : served.get(target.pathname);
    requests.push({ method: request.method, url: target.href, path: file?.path, outside });
    if (!file) { response.writeHead(outside ? 502 : 404).end(); return; }
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': file.bytes.length });
    response.end(request.method === 'HEAD' ? undefined : file.bytes);
  });
  // A client that tunnels through its proxy: a tunnel to the forge itself is handed to the forge, whose requests are
  // then recorded as any other; a tunnel to any other host is recorded as outside and refused.
  server.on('connect', (request, socket) => {
    if (`http://${request.url}` === origin) {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      server.emit('connection', socket);
      return;
    }
    requests.push({ method: 'CONNECT', url: request.url, outside: true });
    socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
  origin = `http://127.0.0.1:${server.address().port}`;
  /** A file's URL on the forge at `ref`: the shape of a forge's raw URL, `/<owner>/<repo>/<ref>/<path>`. */
  const url = (path, ref = COMMIT) => `${origin}/fixture/library/${ref}/${path}`;
  for (const file of [...FILES, UNLISTED]) served.set(new URL(url(file.path)).pathname, file);
  /** The lock row of a pinned file. */
  const row = (file) => ({ path: file.path, url: url(file.path), sha256: sha256(file.bytes), size: file.bytes.length, credit: file.credit });
  const writeLock = (rows = FILES.map(row)) => writeFileSync(join(tree, LOCK), `${JSON.stringify({ files: rows }, null, 2)}\n`);
  const env = (network) => ({
    PATH: process.env.PATH, HOME: home, XDG_CACHE_HOME: join(home, '.cache'), XDG_CONFIG_HOME: join(home, '.config'), TMPDIR: temp,
    HTTP_PROXY: origin, HTTPS_PROXY: origin, ALL_PROXY: origin, http_proxy: origin, https_proxy: origin, all_proxy: origin, NODE_USE_ENV_PROXY: '1',
    ...(network ? { [NETWORK]: '1' } : {}),
  });
  /** Runs `node <script> <args>` in the working folder; answers its exit, its output and the requests it caused. */
  const run = (script, args, { network = false } = {}) => new Promise((done) => {
    const from = requests.length;
    const child = spawn(process.execPath, [script, ...args], { cwd: tree, env: env(network), stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
    const timer = setTimeout(() => stop(child), 60_000);
    child.on('error', (error) => { output += `\n${error.message}`; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      children.delete(child);
      done({ status: signal ? `signal ${signal}` : status, output, lines: output.split('\n'), requests: requests.slice(from) });
    });
  });
  const done = async () => {
    for (const child of children) stop(child);
    server.closeAllConnections();
    await new Promise((closed) => server.close(closed));
    rmSync(dir, { recursive: true, force: true });
  };
  return { tree, home, cache: join(home, ...CACHE), cached: (file) => join(home, ...CACHE, file.path), url, row, writeLock, run, requests, done };
}

/** The end of a run's output, for a failure line. */
export const clip = (output) => output.trim().split('\n').slice(-6).join(' | ').slice(-600) || '(no output)';

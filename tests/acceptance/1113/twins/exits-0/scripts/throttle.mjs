// A planted wrong program for #1113's acceptance tests (twins/README.md): the blind job's own throttle, minus one rule.
// Wrong: it exits 0 whatever its child's status.
//   node scripts/throttle.mjs <build|bay-pair|test|timed> [--wait <min>] -- <command ...>
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, homedir, loadavg, constants } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLASSES = ['build', 'bay-pair', 'test', 'timed'];
const mac = process.platform === 'darwin';
const LIMITS = { build: mac ? 1 : 2, 'bay-pair': mac ? 1 : 3, test: mac ? 2 : 4, timed: 1 };
const dir = () => join(homedir(), '.deepbuild', 'throttle');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

function parents() {
  const map = new Map();
  for (const line of execFileSync('ps', ['-A', '-o', 'pid=,ppid='], { encoding: 'utf8' }).split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid) map.set(pid, ppid);
  }
  return map;
}
const chainOf = (pid, map) => { const chain = []; for (let at = pid; at && at > 1 && !chain.includes(at); at = map.get(at)) chain.push(at); return chain; };

function locked(act) {
  mkdirSync(dir(), { recursive: true });
  const mutex = join(dir(), 'mutex.d');
  for (;;) {
    try { mkdirSync(mutex); writeFileSync(join(mutex, 'pid'), String(process.pid)); break; } catch (error) { if (error.code !== 'EEXIST') throw error; }
    let owner = 0;
    try { owner = Number(readFileSync(join(mutex, 'pid'), 'utf8')); } catch {}
    if (owner && !alive(owner)) rmSync(mutex, { recursive: true, force: true });
    pause(3);
  }
  try {
    const file = join(dir(), 'table.json');
    let table;
    try { table = JSON.parse(readFileSync(file, 'utf8')); } catch { table = { grants: [], queue: [] }; }
    table.grants = table.grants.filter((grant) => alive(grant.pid));
    table.queue = table.queue.filter((request) => alive(request.pid));
    const result = act(table);
    writeFileSync(`${file}.${process.pid}`, JSON.stringify(table));
    renameSync(`${file}.${process.pid}`, file);
    return result;
  } finally {
    rmSync(mutex, { recursive: true, force: true });
  }
}

// DEEP_THROTTLE, verified: in the table, its holder alive and in this process's parent chain.
function inherited(table, chain) {
  const [kind, id] = (process.env.DEEP_THROTTLE ?? '').split(':');
  const grant = table.grants.find((g) => g.id === id && g.class === kind);
  return grant && alive(grant.pid) && chain.includes(grant.pid) ? grant : null;
}

const log = (grant, nested, wait) => appendFileSync(join(dir(), 'log'), `${new Date().toISOString()} class=${grant.class} grant=${nested ? 'nested' : 'top-level'} load=${loadavg()[0].toFixed(2)} cores=${cpus().length} wait=${wait} pid=${grant.pid} id=${grant.id}\n`);

function grantable(table, request, map) {
  const others = table.queue.filter((r) => r.rid !== request.rid);
  const order = (r) => [r.nested ? 0 : 1, r.at];
  const before = (a, b) => order(a)[0] - order(b)[0] || order(a)[1] - order(b)[1];
  const mine = chainOf(request.pid, map);
  const outside = table.grants.filter((g) => !mine.includes(g.pid));
  if (outside.some((g) => g.class === 'timed')) return false;
  if (request.class !== 'timed') {
    if (!request.nested && others.some((r) => r.class === 'timed')) return false;
    if (others.some((r) => r.class === request.class && before(r, request) < 0)) return false;
    return table.grants.filter((g) => g.class === request.class).length < LIMITS[request.class];
  }
  if (others.some((r) => r.class === 'timed' && before(r, request) < 0)) return false;
  if (!request.nested && loadavg()[0] >= cpus().length) return false;
  // Drain: every holder outside the chain has ended or has a descendant blocked in a throttle wait.
  const idle = (g) => table.queue.some((r) => r.pid !== g.pid && chainOf(r.pid, map).includes(g.pid));
  return outside.every((g) => (g.class === 'bay-pair' && !request.nested ? false : idle(g)));
}

/** Waits for a grant of `kind`, at most `wait` minutes; returns it, or null on a timeout. */
export function acquire(kind, { wait = 30, pid = process.pid } = {}) {
  if (!CLASSES.includes(kind)) throw Error(`unknown class ${kind}`);
  const rid = randomBytes(6).toString('hex');
  const first = locked((table) => {
    const map = parents();
    const from = inherited(table, chainOf(pid, map));
    if (from && (kind === 'build' || kind === 'test' || (kind === 'timed' && from.class === 'timed'))) {
      log({ ...from, class: kind }, true, wait);
      return { passed: from };
    }
    table.queue.push({ rid, class: kind, pid, nested: Boolean(from), at: Date.now() });
    return { nested: Boolean(from) };
  });
  if (first.passed) return { id: first.passed.id, class: first.passed.class, passed: true };
  const until = Date.now() + wait * 60_000;
  for (;;) {
    const got = locked((table) => {
      const request = table.queue.find((r) => r.rid === rid);
      if (!request) { table.queue.push({ rid, class: kind, pid, nested: first.nested, at: Date.now() }); return null; }
      if (Date.now() > until) { table.queue = table.queue.filter((r) => r.rid !== rid); return 'timeout'; }
      if (!grantable(table, request, parents())) return null;
      table.queue = table.queue.filter((r) => r.rid !== rid);
      const used = table.grants.filter((g) => g.class === 'bay-pair').map((g) => g.k);
      const grant = { id: rid, class: kind, pid, ...(kind === 'bay-pair' && { k: [1, 2, 3].find((k) => !used.includes(k)) }) };
      table.grants.push(grant);
      log(grant, first.nested, wait);
      return grant;
    });
    if (got === 'timeout') return null;
    if (got) {
      process.env.DEEP_THROTTLE = `${got.class}:${got.id}`;
      return got;
    }
    pause(50);
  }
}

export function release(grant) {
  if (!grant || grant.passed) return;
  locked((table) => { table.grants = table.grants.filter((g) => g.id !== grant.id); });
  if (process.env.DEEP_THROTTLE === `${grant.class}:${grant.id}`) delete process.env.DEEP_THROTTLE;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const split = args.indexOf('--');
  const [kind, ...options] = args.slice(0, split < 0 ? args.length : split);
  const command = split < 0 ? [] : args.slice(split + 1);
  const at = options.indexOf('--wait');
  const wait = at < 0 ? 30 : Number(options[at + 1]);
  if (!CLASSES.includes(kind) || !command.length || !(wait >= 0)) {
    console.log('BLOCKED throttle: usage: throttle.mjs <build|bay-pair|test|timed> [--wait <min>] -- <command>');
    process.exit(2);
  }
  const grant = await acquire(kind, { wait });
  if (!grant) {
    console.log(`INCONCLUSIVE no grant: ${kind} not granted within ${wait} min`);
    process.exit(1);
  }
  const child = spawn(command[0], command.slice(1), { stdio: 'inherit', env: { ...process.env, DEEP_THROTTLE: `${grant.class}:${grant.id}` } });
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
  child.on('error', (error) => { release(grant); console.log(`BLOCKED throttle: ${error.message}`); process.exit(127); });
  child.on('exit', (code, signal) => {
    release(grant);
    process.exit(0);
  });
}

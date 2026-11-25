// Spike #3445: every reading. Run from the repo root on a reference Mac, under the machine's timed grant
// (node scripts/throttle.mjs timed --wait 60 -- node docs/spikes/3445/measure.mjs …), against binaries build.sh built
// in release from a scratch copy of the tree: the base, or the base with one of patches/ applied.
//
//   stage <root>
//       The shipped packs staged as the hub stages them (packages/hub/dist/packs.js: readPack, stage, admit), and the
//       world's `packs` in the order a hub started again holds them. Needs `npm run build --workspaces`.
//   core --core <deep-show> --build <build.json> --root <root> --out <file>
//       One unkept process that fills the evidence store, then five fresh `deep-show canvas` processes. Each is sent
//       the world with the shipped packs, then `deep_kinds`' listing (its first reply, timed from just before the
//       process starts), the listing again (a warm process's reply: a reading), `costs` (whose reply holds the build's own
//       word for its profile) and `packs`, each line once the reply before it is read, as packages/hub/src/canvas.ts
//       sends them. A build with patches/timing.patch says on stderr what it compiled and when; those lines are kept
//       beside the output, and the first reply's row holds the counter, the time inside the counted calls and a row
//       for each.
//   bench --tree <copy of the tree> --out <file>
//       `node benchmarks/logic.mjs` in that copy: the metering benchmark's own output, kept as it printed it. The
//       copy is the base, or the base with patches/epochs-out.patch applied, built before (the benchmark builds
//       deep-logic itself and finds it built). What the copy held is kept beside the output.
//   tracker --bin <spike3445_tracker> --build <build.json> --out <folder>
//       tracker.rs's readings, one file a program and rewrite, in the shape of crates/deep-logic/metering.json.
//   golden --logic <deep-logic> --build <build.json> --fixture <golden fixture> --out <file>
//       The golden that build records for a kept golden's own piece, track and steps: deep-logic's reply to `golden`.
//
// A build.json names what a binary is: the tree it was built from, the patches applied, the cargo command and the
// profile cargo printed. No reading is taken from a binary without one.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, homedir, loadavg, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprint } from '../../../scripts/benchmark.mjs';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Milliseconds since the Unix epoch, with fractions, on the one clock every reply is read on. */
const now = () => performance.timeOrigin + performance.now();
// No home folder in a kept file: it is written `~`.
const tilde = (text) => text.split(homedir()).join('~');
const usage = () => Error(`usage: see the head of ${relative(root, fileURLToPath(import.meta.url))}`);

function options(args, names) {
  const out = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, '');
    if (!names.includes(name) || args[i + 1] === undefined) throw usage();
    out[name] = args[i + 1];
  }
  for (const name of names) if (out[name] === undefined) throw Error(`--${name} is missing`);
  return out;
}

/** What every output starts with: when, where, under which grant and at what load. */
const head = (kind) => ({ kind, date: new Date().toISOString(), fingerprint: fingerprint(), cores: availableParallelism(), lease: process.env.DEEP_THROTTLE ?? null, load: { start: loadavg() } });

/** A binary and the build.json that names it at its hash. */
function built(binary, build) {
  const bytes = readFileSync(binary);
  const made = JSON.parse(readFileSync(build, 'utf8'));
  const name = binary.split('/').pop();
  if (made.sha256?.[name] !== sha256(bytes)) throw Error(`${build} doesn't name ${binary} at its hash`);
  return { binary: { name, sha256: sha256(bytes), bytes: bytes.length }, made };
}

function write(file, out) {
  if (out.load) out.load.end = loadavg();
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, tilde(`${JSON.stringify(out, null, 1)}\n`));
  console.log(`wrote ${file}`);
}

async function stage(dir) {
  const { Packs, readPack } = await import(join(root, 'packages/hub/dist/packs.js'));
  const shipped = join(root, 'packs');
  const store = new Packs(dir);
  const rows = [];
  for (const folder of readdirSync(shipped).sort().filter((name) => existsSync(join(shipped, name, 'pack.json')))) {
    const pack = readPack(join(shipped, folder), true);
    store.stage(pack);
    store.admit(pack);
    rows.push({ folder, id: pack.id, version: pack.version, ref: pack.ref, digest: pack.digest });
  }
  // A hub started again reads its store's rows from disk: that order is the world's.
  const world = new Packs(dir).all().map(({ id, dir: at }) => ({ id, dir: relative(dir, at) }));
  writeFileSync(join(dir, 'staged.json'), `${JSON.stringify({ packs: rows, world }, null, 1)}\n`);
  console.log(`staged ${rows.length} packs under ${dir}`);
}

/**
 * One `deep-show canvas` process: each line sent once the reply before it is read. The world's answer and the first
 * call's reply are timed from just before the process starts; a later reply from just before its line is written.
 */
function core(binary, lines) {
  return new Promise((done, failed) => {
    const started = now();
    const child = spawn(binary, ['canvas'], { stdio: ['pipe', 'pipe', 'pipe'] });
    const wrote = [];
    const replies = [];
    let out = '';
    let said = '';
    const send = () => {
      if (wrote.length === lines.length) return child.stdin.end();
      const line = `${JSON.stringify(lines[wrote.length])}\n`;
      wrote.push(now());
      child.stdin.write(line);
    };
    child.stdin.on('error', () => undefined);
    child.stdout.setEncoding('utf8').on('data', (text) => {
      const at = now();
      out += text;
      for (let end = out.indexOf('\n'); end !== -1; end = out.indexOf('\n')) {
        replies.push({ startedMs: replies.length <= 1 ? started : wrote[replies.length], repliedMs: at, text: out.slice(0, end) });
        out = out.slice(end + 1);
        send();
      }
    });
    child.stderr.setEncoding('utf8').on('data', (text) => { said += text; });
    child.on('error', failed);
    child.on('close', (code) => done({ pid: child.pid, startedMs: started, exitedMs: now(), exit: code, replies, said }));
    send();
  });
}

/** What a timing build said of one process: its marks, and for its first reply the counter, the time and a row a counted call. */
function compiled(said, refs) {
  const marks = [];
  const other = [];
  for (const line of said.split('\n')) {
    if (line.startsWith('spike3445 ')) marks.push(JSON.parse(line.slice(10)));
    else if (line.trim()) other.push(line.slice(0, 300));
  }
  // The second `answered` is the first call's: the world line's answer comes first.
  const first = marks.filter((m) => m.mark === 'answered')[1];
  if (!first) return { marks, other };
  const programs = [];
  let checking = null;
  for (const m of marks) {
    if (m.at > first.at) break;
    if (m.mark === 'install') checking = { id: m.scope.find(([kind]) => kind === 'install')?.[1], calls: [] };
    else if (m.mark === 'installed' && checking) {
      const ref = `${checking.id}@${m.version}`;
      if (!refs.includes(ref)) throw Error(`the core checked ${ref}, which the world didn't hold`);
      for (const call of checking.calls) call.pack = ref;
      checking = null;
    } else if (m.compile) {
      const call = { pack: null, program: m.compile, ns: m.module_new_ns };
      programs.push(call);
      checking?.calls.push(call);
    }
  }
  return { marks, other, first: { compiles: first.compiles, compileNs: first.total_module_ns, programs } };
}

async function cores(args) {
  const { core: binary, build, root: staged, out: file } = options(args, ['core', 'build', 'root', 'out']);
  const out = { ...head('core'), ...built(binary, build) };
  const { packs, world } = JSON.parse(readFileSync(join(staged, 'staged.json'), 'utf8'));
  const evidence = mkdtempSync(join(tmpdir(), 'spike3445-evidence-'));
  // deep_kinds as an agent's first call asks it, the listing: the hub sends its arguments beside the call's name.
  const KINDS = { call: 'deep_kinds', op: 'list' };
  const asked = [KINDS, KINDS, { call: 'costs' }, { call: 'packs' }];
  const calls = asked.map(({ call }) => call);
  const lines = [
    { world: { evidence, sessions: {}, panels: { main: { rect: [0, 0, 800, 600] } }, docs: {}, packs: world.map(({ id, dir }) => ({ id, dir: join(staged, dir) })), record: {} } },
    ...asked.map((call) => ({ call })),
  ];
  out.packs = packs.map((pack) => pack.ref);
  out.world = world.map(({ id }) => id);
  out.calls = calls;
  out.replies = [];
  out.processes = [];
  const kept = [];
  try {
    for (let run = 0; run <= 5; run++) {
      const before = loadavg();
      const got = await core(binary, lines);
      const [ack, ...answers] = got.replies;
      if (got.exit !== 0 || answers.length !== calls.length || [ack, ...answers].some((r) => JSON.parse(r.text).ok !== true)) throw Error(`pid ${got.pid} exited ${got.exit} after ${got.replies.length} replies: ${got.said.slice(-600)} ${got.replies.at(-1)?.text.slice(0, 300)}`);
      const reply = (i) => JSON.parse(answers[i].text).reply;
      for (const i of [0, 1]) if (reply(i).error || !Array.isArray(reply(i).modules)) throw Error(`pid ${got.pid}'s deep_kinds gave no listing: ${answers[i].text.slice(0, 300)}`);
      const { marks, other, first } = compiled(got.said, out.packs);
      for (const m of marks) kept.push({ pid: got.pid, ...m });
      answers.forEach((r, i) => out.replies.push({
        pid: got.pid, reply: i + 1, call: calls[i], build: reply(2).build, startedMs: r.startedMs, repliedMs: r.repliedMs,
        ...(run === 0 ? { primes: true } : {}), ...(i === 0 && first ? first : {}),
      }));
      const rows = reply(3).packs ?? [];
      out.processes.push({
        pid: got.pid, primes: run === 0, load: [before, loadavg()], startedMs: got.startedMs, worldRepliedMs: ack.repliedMs, exitedMs: got.exitedMs,
        replyBytes: answers.map((r) => r.text.length), packs: rows.map(({ pack, version, state, checks }) => ({ pack, version, state, checks })), stderr: other,
      });
      const ms = (r) => (r.repliedMs - r.startedMs).toFixed(1);
      console.log(`pid ${got.pid}${run === 0 ? ' (fills the evidence store, unkept)' : ''}: first reply ${ms(answers[0])} ms, warm ${ms(answers[1])} ms, ${rows.filter((r) => r.state === 'installed').length}/${rows.length} packs installed, ${reply(2).build?.profile} build${first ? `, ${first.compiles} compiles in ${(first.compileNs / 1e6).toFixed(1)} ms` : ''}`);
    }
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
  if (kept.length) {
    const beside = file.replace(/\.json$/, '.marks.jsonl');
    const text = tilde(`${kept.map((m) => JSON.stringify(m)).join('\n')}\n`);
    writeFileSync(beside, text);
    out.marks = { file: beside.split('/').pop(), sha256: sha256(text), lines: kept.length };
  }
  write(file, out);
}

/** The metering benchmark itself, in a copy of the tree: its output as it printed it, and beside it what the copy was. */
function bench(args) {
  const { tree, out: file } = options(args, ['tree', 'out']);
  const git = (...a) => spawnSync('git', a, { cwd: tree, encoding: 'utf8' }).stdout.trim();
  const diff = spawnSync('git', ['diff'], { cwd: tree, encoding: 'utf8' }).stdout;
  const run = { ...head('bench'), command: 'node benchmarks/logic.mjs', tree: { commit: git('rev-parse', 'HEAD'), status: git('status', '--porcelain').split('\n').filter(Boolean), diffSha256: diff ? sha256(diff) : null } };
  const ran = spawnSync(process.execPath, ['benchmarks/logic.mjs'], { cwd: tree, encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'inherit'] });
  if (ran.status !== 0) throw Error(`benchmarks/logic.mjs exited ${ran.status} in ${tree}`);
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, ran.stdout);
  run.out = { file: file.split('/').pop(), sha256: sha256(ran.stdout) };
  write(file.replace(/\.json$/, '.run.json'), run);
  const record = JSON.parse(ran.stdout);
  console.log(`${file}: ns per fuel unit in the app ${record.runs.app.map((r) => r.toFixed(4)).join(' ')}, ${record.ns_per_fuel.app}`);
}

/** The middle of the sorted readings, the upper of two, and the three decimals the record keeps: benchmarks/logic.mjs's. */
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const round = (x) => Math.round(x * 1000) / 1000;

function tracker(args) {
  const { bin: binary, build, out: folder } = options(args, ['bin', 'build', 'out']);
  const start = head('tracker');
  const { binary: named, made } = built(binary, build);
  const ran = spawnSync(binary, [], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (ran.status !== 0) throw Error(`${binary} exited ${ran.status}: ${ran.stderr.slice(0, 2000)}`);
  const read = JSON.parse(ran.stdout);
  for (const row of read.rows) {
    // As the benchmark, which asks for one reading more than it keeps: the first is the one left out.
    const [unkept, ...runs] = row.runs.map((r) => r.ns_per_fuel);
    write(join(folder, `${row.program}-${row.rewrite}.json`), {
      ...start, command: `${named.name} (docs/spikes/3445/tracker.rs)`, binary: named,
      build: { profile: read.profile, toolchain: made.rustc }, made, engines: { app: read.engine },
      program: row.program, rewrite: row.rewrite, sha256: row.sha256, rewritten: row.rewritten, writes: read.writes,
      fuel: row.fuel, steps: row.steps, unkept, raw: row.runs,
      runs: { app: runs }, ns_per_fuel: { app: round(median(runs)) },
    });
    console.log(`${row.program} as ${row.rewrite}: ${runs.map((r) => r.toFixed(4)).join(' ')} ns per fuel unit, ${row.fuel.bench} fuel a step`);
  }
}

function golden(args) {
  const { logic: binary, build, fixture, out: file } = options(args, ['logic', 'build', 'fixture', 'out']);
  built(binary, build);
  const { piece, track, steps } = JSON.parse(readFileSync(fixture, 'utf8'));
  const ran = spawnSync(binary, [], { input: `${JSON.stringify({ call: 'golden', piece, track, steps })}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (ran.status !== 0 || JSON.parse(ran.stdout).ok !== true) throw Error(`${binary} exited ${ran.status}: ${ran.stderr.slice(0, 1000)} ${ran.stdout.slice(0, 400)}`);
  mkdirSync(dirname(resolve(file)), { recursive: true });
  writeFileSync(file, ran.stdout);
  console.log(`wrote ${file}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'stage' && rest[0]) await stage(resolve(rest[0]));
else if (command === 'core') await cores(rest);
else if (command === 'bench') bench(rest);
else if (command === 'tracker') tracker(rest);
else if (command === 'golden') golden(rest);
else throw usage();

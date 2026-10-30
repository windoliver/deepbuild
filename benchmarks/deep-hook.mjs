// deep-hook's overhead and fail-open time, for the perf lane's budgets (issue #315): node benchmarks/deep-hook.mjs <mode>.
// Each builds the release deep-hook, starts `deep hub run` on a temp home with two guard entries in rules.json,
// does its work, prints its readings as one JSON line, and stops the hub it started by PID.
//   overhead   hyperfine times 1,000 forwarded PreToolUse calls beside a native no-op binary, the floor:
//              the p95 of deep-hook minus the p95 of the floor
//   fail-open  50 PreToolUse calls against the hub stopped with SIGSTOP, each from spawn to exit: the p95
//   guards     (issue #304) 200 forwarded PreToolUse calls with rules.json holding every shipped default entry, and
//              200 with it empty, interleaved, each from spawn to exit: the p95 matching every entry adds; then
//              `deep-hook check` on one default's planted call and on its twin, 200 each: their p95s
//   backup     (issue #572) a 100 MB record, then 200 forwarded PreToolUse calls interleaved with a native no-op, each
//              from spawn to exit and each answered while `deep backup` copies the record: the p95 overhead
//   day-overhead   (issue #21) a day of 1,000 real tool calls, the hub up: p95 of the 2,000 hooks (spawn to exit)
//                  minus p95 of 1,000 runs of the floor between them
//   day-fail-open  (issue #21) the same day with the hub stopped by SIGSTOP while the hooks run: p95 of the 2,000
//                  hooks, spawn to exit, four calls at a time as Claude Code runs the hooks of parallel tool calls
// A day's calls are the fixture corpus's recorded Claude Code tool calls (adapters/corpus/claude-code, #47: what Claude
// Code really sent for Bash, Read, Edit, Write, Agent and the other tools), each with its PreToolUse and PostToolUse
// payload, replayed in turn into one session on a home with the shipped guard entries in rules.json until 1,000 calls
// have run. Before a day is timed, each distinct recorded call goes once through a forwarder to the hub, and a call
// whose acknowledgement carries a hold (hold_until_ms) is left out: the overhead budget is "except holds".
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const CLI = join(REPO, 'packages/cli/dist/main.js');
const HOOK = join(REPO, 'target/release/deep-hook');
const RULES = {
  v: 1,
  entries: {
    'no-kill-by-name': { match: 'shell:pkill *', scope: 'all_repos', mode: 'block', reason: 'Never kill processes by name.', next_step: 'Stop the process by its PID.', fail_closed: true },
    'listing-noted': { match: 'shell:ls*', scope: 'all_repos', mode: 'watch', reason: 'Listing is noted.', next_step: 'Nothing to do.', fail_closed: false },
  },
};
const p95 = (samples) => [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];

/** `deep hub run` on `home`, once it says it is ready. */
async function startHub(home) {
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((resolve, reject) => {
    hub.stdout.once('data', resolve);
    hub.once('exit', () => reject(Error('the hub exited before it was ready')));
  });
  return hub;
}
/** A home with rules.json and a running hub, and the PreToolUse JSON of one `ls` call in a session there. */
async function setUp(home) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  writeFileSync(join(home, '.deepbuild', 'rules.json'), JSON.stringify(RULES));
  const cwd = join(home, 'work');
  mkdirSync(cwd);
  const session = '6f1c2b9e-1111-4222-8333-444455556666';
  const transcript = join(home, '.claude', 'projects', 'work', `${session}.jsonl`);
  const hub = await startHub(home);
  const call = { session_id: session, transcript_path: transcript, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_bench' };
  return { hub, cwd, call: JSON.stringify(call) };
}
async function stop(hub) {
  if (hub.exitCode !== null || hub.signalCode !== null) return;
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  hub.kill('SIGCONT');
  hub.kill('SIGTERM');
  await exited;
}
/** The floor, a native no-op: a build output like deep-hook, kept under target/ after the run. */
function buildFloor() {
  const floor = join(REPO, 'target', 'release', 'noop');
  writeFileSync(`${floor}.rs`, 'fn main() {}\n');
  execFileSync('rustc', ['-C', 'opt-level=3', '-o', floor, `${floor}.rs`]);
  return floor;
}

const modes = {
  async overhead(home) {
    const floor = buildFloor();
    const { hub, cwd, call } = await setUp(home);
    try {
      const input = join(home, 'call.json');
      const out = join(home, 'hyperfine.json');
      writeFileSync(input, call);
      execFileSync('hyperfine', ['-N', '--runs', '1000', '--warmup', '20', '--input', input, '--export-json', out, floor, `${HOOK} claude-code PreToolUse`], { cwd, env: { ...process.env, HOME: home }, stdio: 'ignore' });
      const { results } = JSON.parse(readFileSync(out, 'utf8'));
      // hyperfine 2 exports measurements in place of times.
      if (!results.every((r) => Array.isArray(r.times))) throw Error('BLOCKED: hyperfine exported no times; install hyperfine 1.x');
      const [base, hook] = results.map((r) => r.times.map((t) => t * 1000));
      return { floorP95Ms: p95(base), hookP95Ms: p95(hook), overheadP95Ms: p95(hook) - p95(base) };
    } finally {
      await stop(hub);
    }
  },
  async 'fail-open'(home) {
    const { hub, cwd, call } = await setUp(home);
    hub.kill('SIGSTOP');
    try {
      const samples = [];
      for (let i = 0; i < 50; i++) {
        const t0 = performance.now();
        const r = spawnSync(HOOK, ['claude-code', 'PreToolUse'], { cwd, env: { ...process.env, HOME: home }, input: call });
        samples.push(performance.now() - t0);
        if (r.status !== 0) throw Error(`deep-hook didn't allow ls with the hub stopped: exit ${r.status}`);
      }
      return { failOpenP95Ms: p95(samples) };
    } finally {
      await stop(hub);
    }
  },

  async guards(home) {
    const { hub, cwd, call } = await setUp(home);
    const defaults = JSON.parse(readFileSync(join(REPO, 'crates/deep-hook/default-rules.json'), 'utf8'));
    const bare = join(home, 'bare');
    mkdirSync(join(bare, '.deepbuild'), { recursive: true });
    writeFileSync(join(bare, '.deepbuild', 'rules.json'), '{"v":1,"entries":{}}');
    writeFileSync(join(bare, '.deepbuild', 'config.json'), JSON.stringify({ hub: { address: `unix:${join(home, '.deepbuild', 'hub.sock')}` } }));
    writeFileSync(join(home, '.deepbuild', 'rules.json'), JSON.stringify(defaults));
    const timed = (args, env, input) => {
      const t0 = performance.now();
      const r = spawnSync(HOOK, args, { cwd, env: { ...process.env, ...env }, input });
      if (r.status !== 0) throw Error(`deep-hook ${args.join(' ')} exited ${r.status}: ${r.stderr}`);
      return performance.now() - t0;
    };
    const proof = defaults.proofs['no-kill-by-name'];
    const check = (c) => JSON.stringify({ entry: defaults.entries['no-kill-by-name'], call: c });
    try {
      const all = [];
      const none = [];
      const planted = [];
      const twin = [];
      for (let i = 0; i < 200; i++) {
        all.push(timed(['claude-code', 'PreToolUse'], { HOME: home }, call));
        none.push(timed(['claude-code', 'PreToolUse'], { HOME: bare }, call));
        planted.push(timed(['check'], { HOME: home }, check(proof.planted)));
        twin.push(timed(['check'], { HOME: home }, check(proof.twin)));
      }
      return { matchP95Ms: p95(all) - p95(none), checkPlantedP95Ms: p95(planted), checkTwinP95Ms: p95(twin) };
    } finally {
      await stop(hub);
    }
  },

  async backup(home) {
    await seed(join(home, '.deepbuild', 'ledger.db'), 100_000_000);
    const { hub, cwd, call } = await setUp(home);
    const env = { ...process.env, HOME: home };
    const timed = (command, args, input) => {
      const t0 = performance.now();
      const r = spawnSync(command, args, { cwd, env, input });
      if (r.status !== 0) throw Error(`${command} exited ${r.status}: ${r.stderr}`);
      return performance.now() - t0;
    };
    try {
      const hooks = [];
      const floors = [];
      for (let n = 0; hooks.length < 200; n++) {
        const folder = join(home, `backup-${n}`);
        const copying = spawn(process.execPath, [CLI, 'backup', folder], { env, stdio: 'ignore' });
        let running = true;
        const done = new Promise((resolve) => copying.on('exit', (code) => { running = false; resolve(code); }));
        while (running && hooks.length < 200) {
          const floor = timed('/usr/bin/true', []);
          const hook = timed(HOOK, ['claude-code', 'PreToolUse'], call);
          // Only a call answered while the backup ran counts.
          if (!running) break;
          floors.push(floor);
          hooks.push(hook);
        }
        if ((await done) !== 0) throw Error('deep backup failed');
        rmSync(folder, { recursive: true, force: true });
      }
      return { floorP95Ms: p95(floors), hookP95Ms: p95(hooks), overheadP95Ms: p95(hooks) - p95(floors) };
    } finally {
      await stop(hub);
    }
  },

  async 'day-overhead'(home) {
    const floor = buildFloor();
    const up = await daySetUp(home);
    try {
      const calls = day(await unheld(up), up.s);
      // A hook that spooled missed the hub it was timed against. The p95 ignores the slowest 5% of the hooks, so a
      // reading with fewer misses than that is still the hub up's; with that many or more, it says nothing about it.
      // The running hub replays and removes a spooled line as soon as the next hook reaches it, so the spool is read
      // after every hook, between the timed runs.
      const seen = new Set(spooled(home).map((l) => l.id));
      let missed = 0;
      const timed = (event, payload) => {
        const ms = up.hook(event, payload);
        for (const l of spooled(home)) if (!seen.has(l.id)) { seen.add(l.id); missed++; }
        return ms;
      };
      const hooks = [];
      const floors = [];
      for (const c of calls) {
        hooks.push(timed('PreToolUse', c.pre));
        const t0 = performance.now();
        spawnSync(floor, [], { cwd: up.s.cwd, env: up.env, input: '' });
        floors.push(performance.now() - t0);
        hooks.push(timed('PostToolUse', c.post));
      }
      if (missed * 20 >= hooks.length) throw Error(`INVALID: ${missed} of ${hooks.length} hooks spooled with the hub up (machine load), as many as the p95 ignores`);
      return { calls: calls.length, hooks: hooks.length, missed, floorP95Ms: p95(floors), hookP95Ms: p95(hooks), overheadP95Ms: p95(hooks) - p95(floors) };
    } finally {
      await stop(up.hub);
    }
  },
  async 'day-fail-open'(home) {
    const up = await daySetUp(home);
    try {
      const calls = day(await unheld(up), up.s);
      const hooks = [];
      let unspooled = 0;
      // The hub is stopped for a stretch of 50 calls (100 hooks) at a time: a stopped hub accepts nothing, and the
      // socket's listen queue holds 128 connections (kern.ipc.somaxconn), so the 129th hook of a longer stretch would
      // be refused at once and never wait out the deadline it is timed for. Between stretches the hub runs again
      // until it has taken the queue (a connection of ours gets its hello), then stops for the next.
      for (let at = 0; at < calls.length; at += STRETCH) {
        const stretch = calls.slice(at, at + STRETCH);
        const before = new Set(spooled(home).map((l) => l.id));
        const said = up.notes.length;
        up.hub.kill('SIGSTOP');
        for (let i = 0; i < stretch.length; i += 4) {
          const batch = stretch.slice(i, i + 4);
          for (const event of ['PreToolUse', 'PostToolUse']) hooks.push(...(await Promise.all(batch.map((c) => up.hookAsync(event, event === 'PreToolUse' ? c.pre : c.post)))));
        }
        // Every hook of the stretch waited the deadline out: it spooled its call marked late, or said its spool write
        // ran out of the hook's 50 ms (a busy disk; it still exited in time), naming the request's ID either way. One
        // refused at once spools unlate, one whose write failed outright says so without "within", and any hook
        // unaccounted for makes the reading say nothing about failing open. A write that ran out of time can still
        // land as the hook exits, so an ID may be both: it is counted once.
        const waited = spooled(home).filter((l) => !before.has(l.id));
        const unlate = waited.filter((l) => l.late !== true).length;
        const timedOut = up.notes.slice(said).flatMap((n) => [...n.matchAll(/could not spool (\S+) within/g)].map((m) => m[1]));
        const ids = new Set([...waited.filter((l) => l.late === true).map((l) => l.id), ...timedOut]);
        unspooled += timedOut.filter((id) => !waited.some((l) => l.id === id)).length;
        if (unlate || ids.size !== stretch.length * 2) throw Error(`INVALID: of ${stretch.length * 2} hooks, ${ids.size} waited the hub out (spooled late or ran out of time spooling) and ${unlate} spooled unlate; the hooks said: ${up.notes.slice(said).slice(-5).join(' | ') || 'nothing'}`);
        up.hub.kill('SIGCONT');
        await drained(up.socket);
      }
      if (up.notes.length) process.stderr.write(`deep-hook day: ${up.notes.length} hooks said something: ${up.notes.slice(-3).join(' | ')}\n`);
      return { calls: calls.length, hooks: hooks.length, unspooled, failOpenP95Ms: p95(hooks) };
    } finally {
      await stop(up.hub);
    }
  },
};

// ---- A day of real tool calls (#21).

const DEFAULT_RULES = join(REPO, 'crates/deep-hook/default-rules.json');
const CORPUS = join(REPO, 'adapters/corpus/claude-code');
const CALLS = 1000;
/** Calls per SIGSTOP stretch of day-fail-open: 100 hooks, under the listen queue's 128. */
const STRETCH = 50;
const jsonLines = (text) => text.split('\n').flatMap((raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? [v] : []; } catch { return []; } });
const newCallId = () => `toolu_bench${randomBytes(10).toString('hex')}`;

/** Every recorded tool call with both its hooks' payloads, as Claude Code sent them. */
function recordedCalls() {
  const out = [];
  for (const version of readdirSync(CORPUS).sort()) {
    if (!/^\d+\.\d+\.\d+$/.test(version)) continue;
    for (const set of readdirSync(join(CORPUS, version)).sort()) {
      const file = join(CORPUS, version, set, 'events.jsonl');
      if (!existsSync(file)) continue;
      const payloads = jsonLines(readFileSync(file, 'utf8')).map((l) => l.payload).filter(Boolean);
      for (const pre of payloads.filter((p) => p.hook_event_name === 'PreToolUse')) {
        const post = payloads.find((p) => p.hook_event_name === 'PostToolUse' && p.tool_use_id === pre.tool_use_id);
        if (post) out.push({ pre, post, from: `${version}/${set}` });
      }
    }
  }
  if (out.length < 20) throw Error(`BLOCKED: the fixture corpus holds only ${out.length} recorded tool calls with both hooks`);
  return out;
}
/** A recorded payload moved into the bench's session: its session, folder, transcript and call ID rewritten. */
function rehome(payload, s, call) {
  const out = JSON.parse(JSON.stringify(payload).split(String(payload.cwd)).join(s.cwd));
  return { ...out, session_id: s.id, transcript_path: s.transcript, cwd: s.cwd, tool_use_id: call };
}
/** Every request line deep-hook has spooled under `home`, whichever file the hub has moved it to (or removed, replayed, between the listing and the read). */
function spooled(home) {
  const folder = join(home, '.deepbuild', 'spool');
  if (!existsSync(folder)) return [];
  const text = (f) => { try { return readFileSync(join(folder, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
  return readdirSync(folder).filter((f) => f.endsWith('.jsonl')).flatMap((f) => jsonLines(text(f))).filter((l) => typeof l.id === 'string');
}
/** Resolves once the hub answers a new connection, so every connection queued ahead of it has been taken. */
function drained(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { client.destroy(); reject(Error('INVALID: the resumed hub answered no connection within 30 s')); }, 30_000);
    const client = net.connect(socket);
    client.once('data', () => { clearTimeout(timer); client.destroy(); resolve(); });
    client.once('error', (e) => { clearTimeout(timer); reject(Error(`INVALID: the resumed hub refused a connection: ${e.code}`)); });
  });
}

/** A home with the shipped guard entries, a running hub and one session started there. */
async function daySetUp(home) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  copyFileSync(DEFAULT_RULES, join(home, '.deepbuild', 'rules.json'));
  const cwd = join(home, 'work');
  mkdirSync(cwd);
  const id = randomUUID();
  const transcript = join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  const env = { ...process.env, HOME: home };
  const hub = await startHub(home);
  const s = { id, cwd, transcript };
  const hook = (event, payload) => {
    const t0 = performance.now();
    const r = spawnSync(HOOK, ['claude-code', event], { cwd, env, input: JSON.stringify(payload) });
    const ms = performance.now() - t0;
    if (r.status !== 0 && r.status !== 2) throw Error(`deep-hook ${event} exited ${r.status}: ${r.stderr}`);
    return ms;
  };
  // The same hook without blocking this process: the forwarder in unheld() runs here too, so a blocking spawn would starve it.
  // What the hooks said on stderr (a spool write that ran out of time, say), for an INVALID reading's reason.
  const notes = [];
  // Resolves with the time from spawn to exit once its stderr is read too: a process's exit can come before the
  // last of what it wrote there.
  const hookAsync = (event, payload) => new Promise((resolve, reject) => {
    const t0 = performance.now();
    let ms;
    const child = spawn(HOOK, ['claude-code', event], { cwd, env, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.setEncoding('utf8').on('data', (d) => (err += d));
    child.on('exit', () => (ms = performance.now() - t0));
    child.on('close', (code) => {
      if (err.trim()) notes.push(err.trim());
      if (code === 0 || code === 2) resolve(ms);
      else reject(Error(`deep-hook ${event} exited ${code}: ${err}`));
    });
    child.stdin.end(JSON.stringify(payload));
  });
  try {
    hook('SessionStart', { session_id: id, transcript_path: transcript, cwd, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-5-5' });
  } catch (error) {
    await stop(hub);
    throw error;
  }
  return { hub, home, env, s, hook, hookAsync, notes, socket: join(home, '.deepbuild', 'hub.sock') };
}

/** A socket in front of the hub's that keeps every line the hub wrote back. */
function forwarder(dir, target) {
  const path = join(dir, `fwd-${randomBytes(3).toString('hex')}.sock`);
  const up = [];
  const down = [];
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(target);
    sockets.add(client).add(upstream);
    client.on('data', (d) => up.push(d));
    upstream.on('data', (d) => down.push(d));
    client.pipe(upstream);
    upstream.pipe(client);
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
    client.on('close', () => upstream.end());
    upstream.on('close', () => client.end());
  });
  const f = { path, upText: () => Buffer.concat(up).toString('utf8'), downText: () => Buffer.concat(down).toString('utf8'), close: () => new Promise((resolve) => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }) };
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(path, () => resolve(f)); });
}

/** The recorded calls the hub answers at once: each run once through a forwarder, those acknowledged with a hold left out. */
async function unheld(up) {
  const f = await forwarder(up.home, up.socket);
  const config = join(up.home, '.deepbuild', 'config.json');
  writeFileSync(config, JSON.stringify({ hub: { address: `unix:${f.path}` } }));
  const tried = [];
  try {
    for (const pair of recordedCalls()) {
      const call = newCallId();
      tried.push({ pair, call });
      await up.hookAsync('PreToolUse', rehome(pair.pre, up.s, call));
      await up.hookAsync('PostToolUse', rehome(pair.post, up.s, call));
    }
  } finally {
    rmSync(config);
    await f.close();
  }
  // Each request names its call; the hub's acknowledgement names the request. A hook that missed the hub under load
  // (no acknowledgement) wasn't held, so its call stays in; the count is said on stderr.
  const requests = jsonLines(f.upText()).filter((l) => typeof l.id === 'string' && l.payload);
  const acks = new Map(jsonLines(f.downText()).filter((l) => typeof l.ack === 'string').map((l) => [l.ack, l.hold_until_ms]));
  const heldCalls = new Set(requests.filter((r) => acks.get(r.id) !== null && acks.get(r.id) !== undefined).map((r) => r.payload.tool_use_id));
  const missed = requests.filter((r) => !acks.has(r.id)).length;
  if (missed) process.stderr.write(`deep-hook day: ${missed} of ${requests.length} hooks got no acknowledgement in the pre-pass (machine load); their calls stay in\n`);
  const kept = [];
  const left = [];
  for (const { pair, call } of tried) {
    if (heldCalls.has(call)) left.push(`${pair.from} ${pair.pre.tool_name}`);
    else kept.push(pair);
  }
  if (left.length) process.stderr.write(`deep-hook day: ${left.length} recorded calls held by the hub are left out: ${left.join(', ')}\n`);
  if (kept.length < 20) throw Error(`BLOCKED: only ${kept.length} recorded calls are answered at once`);
  return kept;
}

/** 1,000 calls of the day in turn from the recorded ones, each with a call ID of its own. */
function day(calls, s) {
  const out = [];
  for (let i = 0; out.length < CALLS; i++) {
    const pair = calls[i % calls.length];
    const call = newCallId();
    out.push({ pre: rehome(pair.pre, s, call), post: rehome(pair.post, s, call) });
  }
  return out;
}

/** A record grown past `bytes` through @deepbuild/record, before the hub starts: one session's shell calls, ~7 KB each. */
async function seed(path, bytes) {
  const { openRecord } = await import(join(REPO, 'packages/record/dist/index.js'));
  let now = Date.now() - 86_400_000;
  const record = await openRecord({ path, now: () => now });
  const conn = { writer: 'hook', actor: 'you', scope: 'you', session: 'bench-572', agent: 'claude-code' };
  const command = 'npm test -- src/cart/checkout.test.ts --reporter verbose '.repeat(120);
  const size = () => ['', '-wal'].reduce((sum, f) => sum + (existsSync(path + f) ? statSync(path + f).size : 0), 0);
  let n = 0;
  try {
    while (size() < bytes) {
      const batch = [];
      for (let i = 0; i < 2000; i++) {
        now += 5;
        batch.push(record.append(conn, { v: 1, id: ulid(now, ++n), kind: n % 2 ? 'tool.after' : 'tool.before', ts: now, seq: String(BigInt(now) * 1_000_000n + BigInt(n % 1_000_000)), data: { kind: 'shell', paths: [], command: `${command}${n}` } }));
      }
      await Promise.all(batch);
      await record.sync();
    }
  } finally {
    await record.close();
  }
}
/** A ULID at `ms`, its random part the counter `n`, so every ID is new. */
function ulid(ms, n) {
  const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let out = '';
  for (let t = BigInt(ms), i = 0; i < 10; i++, t >>= 5n) out = crockford[Number(t & 31n)] + out;
  let tail = '';
  for (let r = BigInt(n), i = 0; i < 16; i++, r >>= 5n) tail = crockford[Number(r & 31n)] + tail;
  return out + tail;
}

const mode = process.argv[2];
if (!modes[mode]) throw Error(`Unknown mode ${mode}; one of: ${Object.keys(modes).join(', ')}`);
execFileSync('cargo', ['build', '--locked', '-q', '--release', '-p', 'deep-hook'], { cwd: REPO, stdio: 'inherit' });
const home = realpathSync(mkdtempSync('/tmp/deep-hook-bench-'));
try {
  console.log(JSON.stringify({ bench: 'deep-hook', mode, ...(await modes[mode](home)) }));
} finally {
  rmSync(home, { recursive: true, force: true });
}

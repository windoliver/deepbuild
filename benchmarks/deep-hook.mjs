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
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

/** A home with rules.json and a running hub, and the PreToolUse JSON of one `ls` call in a session there. */
async function setUp(home) {
  mkdirSync(join(home, '.deepbuild'), { recursive: true });
  writeFileSync(join(home, '.deepbuild', 'rules.json'), JSON.stringify(RULES));
  const cwd = join(home, 'work');
  mkdirSync(cwd);
  const session = '6f1c2b9e-1111-4222-8333-444455556666';
  const transcript = join(home, '.claude', 'projects', 'work', `${session}.jsonl`);
  const hub = spawn(process.execPath, [CLI, 'hub', 'run'], { env: { ...process.env, HOME: home }, stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((resolve, reject) => {
    hub.stdout.once('data', resolve);
    hub.once('exit', () => reject(Error('the hub exited before it was ready')));
  });
  const call = { session_id: session, transcript_path: transcript, cwd, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_bench' };
  return { hub, cwd, call: JSON.stringify(call) };
}
async function stop(hub) {
  const exited = new Promise((resolve) => hub.on('exit', resolve));
  hub.kill('SIGCONT');
  hub.kill('SIGTERM');
  await exited;
}

const modes = {
  async overhead(home) {
    // The floor is a build output like deep-hook, kept under target/ after the run.
    const floor = join(REPO, 'target', 'release', 'noop');
    writeFileSync(`${floor}.rs`, 'fn main() {}\n');
    execFileSync('rustc', ['-C', 'opt-level=3', '-o', floor, `${floor}.rs`]);
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
};

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

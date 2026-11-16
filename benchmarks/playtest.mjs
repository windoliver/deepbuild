// #184's budgets, the `playtest-maze` and `playtest-throughput` modes of benchmarks/canvas.mjs, on release builds of
// deep-drive (the replica's play mode) and deep-logic. The maze is the playtest plug-in's kit fixture
// (packages/checks/playtest/fixtures): a token moved one cell per arrow press, `won` at the exit.
//   playtest-maze: the playtest's own runner (packages/checks/playtest/run.ts) plays the maze's 40 runs of 120 s, 20 by
//     the route bot and 20 by a policy of seeded presses every 0.25 s, each with its replay, on two replicas:
//     maze_40_runs_s, its seconds. idle_work: the steps at which the maze played with no bot spends other fuel than the
//     logic module's own bake of it, so a piece played without the plug-in gains no work.
//   playtest-throughput: 20 runs of the 2-minute maze by the policy, each with its replay, on four replicas:
//     fixture_realtime_x, 20 × 120 s over the batch's seconds. With `--planted renders-unkept-frames`, the replicas are
//     a release build with deep-replica's `test-renders-unkept-frames`, which renders a frame every step.
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

const SPAN_S = 120;
const SEED = 184;
const FIXTURES = (root) => join(root, 'packages', 'checks', 'playtest', 'fixtures');
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/** The maze as the logic module's piece, its program and the route bot's inline. */
function maze(root) {
  const program = readFileSync(join(FIXTURES(root), 'maze.wasm'));
  const bot = readFileSync(join(FIXTURES(root), 'route-bot.wasm'));
  const [p, b] = [sha256(program), sha256(bot)];
  const params = { program: p, step_rate: 60, reads: ['arrow'], writes: { pos: { type: 'i32', count: 2 }, won: { type: 'i32' }, presses: { type: 'i32' } } };
  return {
    piece: { seed: SEED, class: 'figure', controls: { arrow: { kind: 'slider', range: [0, 3], increment: 1, default: 0 } }, items: { maze: { kind: 'logic@1', params } } },
    assets: { [p]: program.toString('base64'), [b]: bot.toString('base64') },
    route: { logic: { program: b, reads: ['maze.pos'], plays: { press: 'arrow' } } },
    policy: { policy: { pick: { arrow: { from: [0, 1, 2, 3], every: 0.25 } } } },
  };
}

/** `deep-drive` processes, each serving one play at a time over JSON lines. */
async function replicas(bin, n, out) {
  const started = await Promise.all(Array.from({ length: n }, async (_, i) => {
    const child = spawn(bin, ['--out', join(out, String(i))], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = '';
    const waiting = [];
    child.stdout.setEncoding('utf8').on('data', (d) => {
      buffer += d;
      for (let at = buffer.indexOf('\n'); at >= 0; at = buffer.indexOf('\n')) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        waiting.shift()?.(JSON.parse(line));
      }
    });
    const next = () => new Promise((done) => waiting.push(done));
    const ready = await next();
    if (ready.ready !== true) throw Error(`deep-drive didn't start: ${JSON.stringify(ready)}`);
    return { child, call: (line) => { const r = next(); child.stdin.write(`${JSON.stringify(line)}\n`); return r; } };
  }));
  const free = [...started];
  const queue = [];
  const play = async (line) => {
    const r = free.shift() ?? (await new Promise((done) => queue.push(done)));
    try {
      const reply = await r.call(line);
      if (reply.ok !== true) throw Error(`a play was refused: ${JSON.stringify(reply.error)}`);
      return reply;
    } finally {
      const waiter = queue.shift();
      if (waiter) waiter(r);
      else free.push(r);
    }
  };
  return { play, close: () => { for (const r of started) r.child.stdin.end(); } };
}

/** The maze's 40 runs and their replays, through the playtest's own runner, on two replicas: its seconds. */
async function mazeRuns(root, bin, fixture, out) {
  const { runPlaytest } = await import(join(root, 'packages', 'checks', 'playtest', 'run.ts'));
  const pool = await replicas(bin, 2, out);
  try {
    const input = { piece: 'maze@1', bots: [fixture.route, fixture.policy], runs: 20, seed: SEED, span: SPAN_S, stuck: { measure: 'maze.pos', by: 1, within: 10 }, goals: [{ name: 'won', when: 'maze.won' }] };
    const at = performance.now();
    const result = await runPlaytest(input, (_piece, run) => pool.play({ call: 'play', piece: fixture.piece, assets: fixture.assets, ...run }));
    const seconds = (performance.now() - at) / 1000;
    if (result.testsRun !== 40) throw Error(`the playtest counted ${result.testsRun} runs, not 40: ${JSON.stringify(result.failures.slice(0, 3))}`);
    return seconds;
  } finally {
    pool.close();
  }
}

/** The steps at which the maze played with no bot spends other fuel than deep-logic's bake of it. */
async function idleWork(root, bin, fixture, out) {
  const pool = await replicas(bin, 1, out);
  try {
    const bare = await pool.play({ call: 'play', piece: fixture.piece, assets: fixture.assets, seed: SEED, span: SPAN_S, values: [], frames: [] });
    const line = { call: 'bake', piece: { ...fixture.piece, assets: fixture.assets }, track: [], steps: bare.steps };
    const baked = spawnSync(join(root, 'target', 'release', 'deep-logic'), [], { input: `${JSON.stringify(line)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
    const bake = JSON.parse(baked.stdout.trim().split('\n').at(-1));
    const own = bake.steps.map((s) => s.items.maze.fuel);
    const fuel = bare.fuel.maze;
    return fuel.length === own.length ? fuel.filter((f, k) => f !== own[k]).length : Math.max(fuel.length, own.length);
  } finally {
    pool.close();
  }
}

/** 20 runs of the maze by the policy, each with its replay, on four replicas: their multiple of real time. */
async function throughput(bin, fixture, out) {
  const pool = await replicas(bin, 4, out);
  try {
    const at = performance.now();
    await Promise.all(Array.from({ length: 20 }, async (_, i) => {
      const seed = SEED * 1000 + i;
      const run = await pool.play({ call: 'play', piece: fixture.piece, assets: fixture.assets, seed, span: SPAN_S, bot: fixture.policy, values: [], frames: [0] });
      const again = await pool.play({ call: 'play', piece: fixture.piece, assets: fixture.assets, seed, span: SPAN_S, track: run.entries, values: [], frames: [] });
      if (again.final !== run.final) throw Error(`run ${i}'s replay doesn't reach its full-state hash`);
    }));
    return (20 * SPAN_S) / ((performance.now() - at) / 1000);
  } finally {
    pool.close();
  }
}

export async function playtest({ root, release, task, planted }) {
  const fingerprint = release('deep-replica', 'deep-drive');
  release('deep-logic', 'deep-logic');
  let bin = join(root, 'target', 'release', 'deep-drive');
  if (planted === 'renders-unkept-frames') {
    const built = spawnSync('cargo', ['build', '--locked', '--release', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'test-renders-unkept-frames', '--target-dir', join(root, 'target', 'unkept')], { cwd: root, stdio: ['ignore', 'ignore', 'inherit'] });
    if (built.status !== 0) throw Error(`the planted deep-drive build exited ${built.status}`);
    bin = join(root, 'target', 'unkept', 'release', 'deep-drive');
  }
  const fixture = maze(root);
  const out = mkdtempSync(join(tmpdir(), 'deep-playtest-bench-'));
  try {
    const once = task === 'playtest-maze'
      ? async () => ({ maze_40_runs_s: await mazeRuns(root, bin, fixture, out), idle_work: await idleWork(root, bin, fixture, out) })
      : async () => ({ fixture_realtime_x: await throughput(bin, fixture, out) });
    await once();
    const runs = [];
    for (let n = 0; n < 5; n++) runs.push(await once());
    console.log(JSON.stringify({ task, fingerprint, runs }));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// #2648 AC2: "The same hub retires at most 65% of the merge base's instructions a second, over 7 alternated rounds of
// 30 s (drafted from the four shares, which sum to 42% of its timer time)".
//
// AC1's hub (30 days of history, set up, no session), started from this checkout's tree and from the merge base's, each
// in a scratch folder of the same shape, each round on a fresh copy of one home. A round reads each hub's own process
// for 30 s after 15 s to settle, with the benchmarks' reader (benchmarks/process-reader.mjs, #2698); the sides alternate
// which runs first. The change's median instructions a second must be at most 65% of the merge base's. The wrong
// program is the merge base: on it the two sides are one program.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AC2, cleanup, copyWorld, gitEnv, median, mergeBaseCommit, REPO, run, setUpWorld, sleep, startHub, stopHub, tempDir, type World } from './helpers.ts';

afterAll(cleanup, 120_000);

const ROUNDS = 7;
const SPAN_MS = 30_000;
const SETTLE_MS = 15_000;
/** "at most 65% of the merge base's instructions a second". */
const SHARE = 0.65;

interface Reading { spanMs: number; processes: { pid: number; instructions: number | null; cpuMs: number | null; wakeups: number | null }[] }
type Reader = { startReading(pid: number): { stop(): Reading } };
const reader = async (): Promise<Reader> => (await import(pathToFileURL(join(REPO, 'benchmarks/process-reader.mjs')).href)) as Reader;

/** This checkout's deep-hook in a scratch tree: a hub starts only with one built under its checkout, and idle hubs never run it. */
function withDeepHook(dir: string): string {
  if (!existsSync(join(REPO, 'target', 'debug', 'deep-hook'))) throw Error(`BLOCKED: ${join(REPO, 'target', 'debug', 'deep-hook')} is not built; run cargo build -p deep-hook --locked first`);
  mkdirSync(join(dir, 'target', 'debug'), { recursive: true });
  copyFileSync(join(REPO, 'target', 'debug', 'deep-hook'), join(dir, 'target', 'debug', 'deep-hook'));
  chmodSync(join(dir, 'target', 'debug', 'deep-hook'), 0o755);
  return dir;
}

/**
 * The change's tree: this checkout's files as they are, its built packages included, cloned into a scratch folder of
 * the merge base's tree's shape, without .git and target/. Both sides then run from such a folder: in this job's first
 * run the checkout itself read about 4% more than an identical tree built in a scratch folder (README, Readings 9).
 */
async function changeTree(): Promise<string> {
  const dir = join(tempDir('dh2648-tree-'), 'tree');
  mkdirSync(dir);
  for (const entry of readdirSync(REPO)) {
    if (entry === '.git' || entry === 'target') continue;
    const done = await run('/bin/cp', ['-Rc', join(REPO, entry), join(dir, entry)], { timeoutMs: 1_200_000 });
    if (done.code !== 0) throw Error(`BLOCKED: this checkout can't be copied for its side: ${done.stderr.slice(-1500)}`);
  }
  return withDeepHook(dir);
}

/**
 * The merge base's tree, built: `git archive` of `git merge-base HEAD origin/main` into a scratch folder (no .git), its
 * packages installed and built there, and this checkout's deep-hook copied in. BLOCKED when any step fails.
 */
async function mergeBase(): Promise<{ commit: string; dir: string }> {
  const env = gitEnv();
  const commit = await mergeBaseCommit();
  const scratch = tempDir('dh2648-base-');
  const dir = join(scratch, 'tree');
  mkdirSync(dir);
  const tree = join(scratch, 'base.tar');
  const steps: [string, string[], string][] = [
    ['git', ['archive', '--format=tar', '-o', tree, commit], REPO],
    ['tar', ['-xf', tree, '-C', dir], dir],
    ['npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], dir],
    ['npm', ['run', 'build', '--workspaces'], dir],
  ];
  for (const [command, args, cwd] of steps) {
    let done = await run(command, args, { env, cwd, timeoutMs: 1_200_000 });
    // A first workspace build can fail on declaration order; the second passes (benchmarks/hub-churn.mjs).
    if (done.code !== 0 && command === 'npm' && args[0] === 'run') done = await run(command, args, { env, cwd, timeoutMs: 1_200_000 });
    if (done.code !== 0) throw Error(`BLOCKED: the merge base ${commit} can't be built here: ${command} ${args.join(' ')} exited ${done.code}: ${done.stderr.slice(-1500)}`);
  }
  return { commit, dir: withDeepHook(dir) };
}

interface Round { instructionsPerSecond: number | null; wakeupsPerSecond: number | null; cpuMsPerSecond: number | null }
/** One hub from `checkout` on a fresh copy of the template's home: its own process read for 30 s after 15 s to settle. */
async function idleRound(template: World, checkout: string, read: Reader): Promise<Round> {
  const w = await copyWorld(template);
  const hub = await startHub(w, { checkout });
  try {
    await sleep(SETTLE_MS);
    const reading = read.startReading(hub.pid);
    await sleep(SPAN_MS);
    const got = reading.stop();
    const own = got.processes.find((p) => p.pid === hub.pid);
    const second = (n: number | null | undefined) => (typeof n === 'number' ? n / (got.spanMs / 1000) : null);
    return { instructionsPerSecond: second(own?.instructions), wakeupsPerSecond: second(own?.wakeups), cpuMsPerSecond: second(own?.cpuMs) };
  } finally {
    await stopHub(hub);
  }
}

const millions = (n: number | null) => (n === null ? 'missing' : `${(n / 1e6).toFixed(2)} M`);

describe(`AC2 ${AC2} the idle hub retires at most 65% of the merge base's instructions a second`, () => {
  it(`AC2 ${AC2} over 7 alternated rounds of 30 s, the median instructions a second is at most 65% of the merge base's`, async () => {
    const read = await reader();
    const template = await setUpWorld(30);
    const base = await mergeBase();
    const sides = { change: await changeTree(), base: base.dir } as const;
    const rounds: { change: Round; base: Round }[] = [];
    for (let i = 0; i < ROUNDS; i++) {
      const order = i % 2 ? (['base', 'change'] as const) : (['change', 'base'] as const);
      const round: Partial<Record<'change' | 'base', Round>> = {};
      for (const side of order) round[side] = await idleRound(template, sides[side], read);
      rounds.push(round as { change: Round; base: Round });
    }
    const shown = rounds.map((r, i) => `round ${i + 1} (${i % 2 ? 'merge base first' : 'change first'}): change ${millions(r.change.instructionsPerSecond)}, merge base ${millions(r.base.instructionsPerSecond)} instructions a second; wakeups ${r.change.wakeupsPerSecond?.toFixed(1)} and ${r.base.wakeupsPerSecond?.toFixed(1)} a second; CPU ${r.change.cpuMsPerSecond?.toFixed(2)} and ${r.base.cpuMsPerSecond?.toFixed(2)} ms a second`).join('\n  ');
    console.log(`AC2 reading against the merge base ${base.commit}:\n  ${shown}`);
    const missing = rounds.flatMap((r, i) => [r.change, r.base].some((s) => s.instructionsPerSecond === null) ? [i + 1] : []);
    if (missing.length) throw Error(`INCONCLUSIVE: AC2 ${AC2}: the hub's instructions retired can't be read in rounds ${missing.join(', ')}; a count that can't be read is missing, never 0\n  ${shown}`);
    const change = median(rounds.map((r) => r.change.instructionsPerSecond!));
    const then = median(rounds.map((r) => r.base.instructionsPerSecond!));
    expect(change / then, `AC2 ${AC2}: the idle hub retired a median of ${millions(change)} instructions a second over ${ROUNDS} rounds of ${SPAN_MS / 1000} s, ${((change / then) * 100).toFixed(1)}% of the merge base's ${millions(then)} (${base.commit.slice(0, 12)}); at most ${SHARE * 100}% passes\n  ${shown}`).toBeLessThanOrEqual(SHARE);
  }, 3_600_000);
});

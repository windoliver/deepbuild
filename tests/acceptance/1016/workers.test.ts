// #1016 AC4: worker counts follow the pool. The repo's done.yaml marks `npm test` `jobs: n` with the flag it names,
// `jobs_flag: --maxWorkers` (README, Surfaces). Beside a leased stand-in build that holds 8 of the 11 tokens (it takes
// every token in the pipe and writes 3 back), `deep lease -- npm test` must start its runner, the stand-in npm, with 3
// workers; with no build running, with 11. Its wrong program computes the share ignoring the running build, starts 11
// beside it, and must fail.
import { describe, expect, it } from 'vitest';
import { AC4, CORES, entriesRepo, groups, joined, mustFail, sleep, TOKENS, tokensIn, until, World, type Leased } from './helpers.ts';

const FLAG = '--maxWorkers';
const FREE = 3;

/** The worker count the runner was given: the number after its flag, as `--maxWorkers=3` or `--maxWorkers 3` (the last one). */
function workersOf(argv: unknown): number | undefined {
  if (!Array.isArray(argv)) return undefined;
  let n: number | undefined;
  argv.forEach((word, i) => {
    const w = String(word);
    if (w.startsWith(`${FLAG}=`)) n = Number(w.slice(FLAG.length + 1));
    else if (w === FLAG && argv[i + 1] !== undefined) n = Number(argv[i + 1]);
  });
  return n;
}

interface Workers { beside?: number; besideArgv: unknown; alone?: number; aloneArgv: unknown; pipeBeside: number; outputs: string[] }

async function runnerStarts(w: World, repo: string, label: string): Promise<{ argv: unknown; out: Leased }> {
  const out = w.lease(['--', 'npm', 'test'], repo, { DH1016_LABEL: label });
  await Promise.race([out.done, sleep(120_000)]);
  return { argv: w.mark(label, 'ran')?.argv ?? null, out };
}

async function workerCounts(plant?: string, alone = true): Promise<Workers> {
  const w = new World({ cores: CORES, ...(plant ? { plant } : {}) });
  await w.startHub();
  try {
    const repo = entriesRepo(w);
    const build = w.lease(['--', 'holder'], repo, { DH1016_LABEL: 'build', DH1016_LEAVE: String(FREE) });
    await until(() => Boolean(w.mark('build', 'held')) || build.finished(), 120_000);
    const held = w.mark('build', 'held');
    const fifo = joined(held, '`deep lease -- holder`');
    groups.add(Number(held!.pgid));
    const pipeBeside = tokensIn(fifo);
    const beside = await runnerStarts(w, repo, 'beside');
    let x: Workers = { besideArgv: beside.argv, aloneArgv: null, pipeBeside, outputs: [beside.out.output()], ...(workersOf(beside.argv) !== undefined ? { beside: workersOf(beside.argv)! } : {}) };
    if (alone) {
      w.go('build');
      await Promise.race([build.done, sleep(60_000)]);
      await sleep(2000);
      const lone = await runnerStarts(w, repo, 'alone');
      x = { ...x, aloneArgv: lone.argv, outputs: [...x.outputs, lone.out.output()], ...(workersOf(lone.argv) !== undefined ? { alone: workersOf(lone.argv)! } : {}) };
    }
    // The Proof's reading: the worker counts.
    console.log(`AC4 ${plant ?? 'as built'}: the build held ${TOKENS - pipeBeside} of ${TOKENS} (pipe ${pipeBeside}); \`npm test\` beside it got ${JSON.stringify(beside.argv)}${alone ? `; alone it got ${JSON.stringify(x.aloneArgv)}` : ''}`);
    return x;
  } finally {
    await w.stopHub();
  }
}

function besideTheBuild(x: Workers): void {
  expect(x.besideArgv, `\`deep lease -- npm test\` must start the runner: ${x.outputs[0]}`).not.toBeNull();
  expect(x.beside, `beside a build holding 8 of the ${TOKENS} tokens, the runner must be given its worker count with ${FLAG}: it got ${JSON.stringify(x.besideArgv)}`).toBeDefined();
  expect(x.beside, `beside a build holding 8 of the ${TOKENS} tokens, \`npm test\` started its runner with ${x.beside} workers (${JSON.stringify(x.besideArgv)}); its share of the ${FREE} free tokens is ${FREE} workers`).toBe(FREE);
}

describe(`${AC4} worker counts follow the pool`, () => {
  it(`${AC4} an \`npm test\` entry marked \`jobs: n\` starts its runner with 3 workers beside a build that holds 8 tokens, and with 11 when no build runs`, async () => {
    const x = await workerCounts();
    besideTheBuild(x);
    expect(x.alone, `with no build running, \`npm test\` must start its runner with all ${TOKENS} tokens' workers: it got ${JSON.stringify(x.aloneArgv)}: ${x.outputs[1] ?? ''}`).toBe(TOKENS);
  }, 600_000);

  it(`${AC4} (wrong program) a share that ignores the running build (DEEP_HUB_PLANT=share-ignores-running-build) starts 11 and fails`, async () => {
    const x = await workerCounts('share-ignores-running-build', false);
    await mustFail('share-ignores-running-build', () => besideTheBuild(x), [`with ${TOKENS} workers`]);
  }, 600_000);
});

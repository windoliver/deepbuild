// #2126's scenarios, each run in a Node process of its own as the hub or an eval would run the call: `node
// scenario.mjs <gate|probe|cli>`, in the temp folder $DH2126_DIR. The process records every uncaught exception it sees
// (`process.on('uncaughtException')`), so one doesn't end it before the call settles, and its last stdout line is one
// JSON object: how the call settled, the uncaught exceptions, and the facts that show the scenario really happened.
// Every module is reached through its built package; runCli, which @deepbuild/config-eval's entry doesn't export,
// through that package's built launcher module (README).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.env.DH2126_DIR;
if (!DIR) throw Error('DH2126_DIR is not set');
const uncaught = [];
process.on('uncaughtException', (error) => { uncaught.push(`${error?.code ?? ''} ${error?.message ?? String(error)}`.trim()); });

const settle = async (call) => {
  try { return { resolved: true, value: await call() }; } catch (error) { return { rejected: true, name: error?.name, message: error?.message ?? String(error) }; }
};

/**
 * A git stopped before it reads its input: a claim's stage, its snapshot and then its checkout under one budget, on a
 * repo whose path list for git's stdin is over 1 MiB. The 5,400 tracked paths carry skip-worktree marks, which the
 * snapshot clears with `update-index --no-skip-worktree -z --stdin`. A tracked file of 1 MiB is there too, so where
 * the file system can clone it the checkout's `checkout-index -z --stdin` takes the rest as a path list as well.
 */
async function gate() {
  const realGit = process.env.STANDIN_REAL_GIT;
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd, args, input) => execFileSync(realGit, ['-c', 'user.name=dh2126', '-c', 'user.email=dh2126@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, ...(input === undefined ? {} : { input }) }).trim();
  const repo = join(DIR, 'repo');
  mkdirSync(join(repo, 'p'), { recursive: true });
  git(repo, ['init', '-q', '.']);
  writeFileSync(join(repo, 'big.bin'), Buffer.alloc(1 << 20, 0x61));
  const small = [];
  for (let i = 0; i < 5400; i++) {
    const path = `p/${String(i).padStart(5, '0')}-${'x'.repeat(190)}`;
    writeFileSync(join(repo, path), `${i}\n`);
    small.push(path);
  }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'tree']);
  git(repo, ['update-index', '--skip-worktree', '-z', '--stdin'], `${small.join('\0')}\0`);
  const pathListBytes = Buffer.byteLength(small.join('\0'));

  const { openRecord } = await import('@deepbuild/record');
  const { openAsks } = await import('@deepbuild/asks');
  const { openLeases } = await import('@deepbuild/leases');
  const { openSupervisor } = await import('@deepbuild/supervisor');
  const { openCheckouts } = await import('@deepbuild/gate');
  const record = await openRecord({ path: join(DIR, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, resources: [], leases });

  // From here every git the gate runs is the stand-in first on PATH.
  const mark = join(DIR, 'stdin-call-reached');
  process.env.STANDIN_MARK = mark;
  process.env.PATH = `${join(HERE, 'standin')}:${process.env.PATH}`;
  const checkouts = await openCheckouts({ store: join(DIR, 'store'), root: join(DIR, 'checkouts'), kinds: [], host: sup, leases, now: Date.now });
  const budget = checkouts.budget();
  const settled = await settle(async () => {
    const snap = await checkouts.snapshot(repo, budget);
    return checkouts.checkout({ worktree: repo, commit: snap.commit, runs: ['run:dh2126'], budget });
  });
  await checkouts.close().catch(() => undefined);
  await sup.close().catch(() => undefined);
  await record.close().catch(() => undefined);
  const stoppedAt = existsSync(mark) ? readFileSync(mark, 'utf8').trim().replace(/^(?:-c \S+ )*/, '').replace(/ --prefix=\S+/, '') : null;
  return { settled, pathListBytes, marked: stoppedAt !== null, stoppedAt };
}

/** A probe that exits before it reads its 2 MB input, run by runProbe's standalone path. */
async function probe() {
  const { runProbe } = await import('@deepbuild/conformance');
  const input = { data: 'x'.repeat(2_000_000) };
  const inputBytes = Buffer.byteLength(JSON.stringify({ ...input, checkout: DIR }));
  const settled = await settle(() => runProbe(join(HERE, 'exit-probe.mjs'), input, { checkout: DIR, deadline: 120_000, now: Date.now }, { kind: 'numbers', file: 'exit-probe.mjs' }));
  return { settled, inputBytes };
}

/** A judge or agent CLI that exits 1 before it reads its 300 KB prompt, run by runCli. */
async function cli() {
  const { runCli } = await import('../../../../packages/config-eval/dist/launcher.js');
  const prompt = 'x'.repeat(300_000);
  const settled = await settle(() => runCli([join(HERE, 'exits-at-once.sh')], prompt, DIR, { PATH: '/usr/bin:/bin' }, Date.now() + 120_000));
  return { settled, promptBytes: Buffer.byteLength(prompt) };
}

const scenarios = { gate, probe, cli };
const name = process.argv[2];
const run = scenarios[name];
if (!run) throw Error(`no scenario ${name}`);
const facts = await run();
process.stdout.write(`\n${JSON.stringify({ scenario: name, ...facts, uncaught })}\n`);
process.exit(0);

// #2126 hand run: one long-lived Node process, as the hub or an eval runs these calls, hands each kind of child an
// input it never reads. A `git` that stops before it reads its 1 MiB path list (killed by the gate's budget), a probe
// that is `process.exit(1)` with a 2 MB input, and a CLI that exits 1 before it reads a 300 KB prompt. Each call must
// fail cleanly and the process must stay up with no uncaught exception.
// Run from the repository root after `npm ci` and `npm run build --workspaces`: node docs/evidence/2126/e2e.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const FIX = join(ROOT, 'tests/acceptance/2126/fixtures');
const DIR = realpathSync(mkdtempSync(join(tmpdir(), 'e2e2126-')));
const uncaught = [];
/** Whether each call failed as its criterion expects: gate over budget at git's --stdin call, probe failed, CLI no lines. */
const clean = { gate: false, probe: false, cli: false };
process.on('uncaughtException', (e) => { uncaught.push(`${e?.code ?? ''} ${e?.message ?? e}`.trim()); });
const say = (s) => process.stdout.write(`${s}\n`);
const kb = (n) => `${(n / 1024).toFixed(0)} KiB`;
const head = execFileSync('git', ['-C', ROOT, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim();
say(`#2126 hand run · node ${process.version} · pid ${process.pid}`);
say(`HEAD ${head}`);
say('');

// 1. The gate: a claim's snapshot under one budget, on a repo whose path list for git's stdin is over 1 MiB.
{
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1' };
  const git = (cwd, args, input) => execFileSync(realGit, ['-c', 'user.name=e2e', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, ...(input === undefined ? {} : { input }) });
  const repo = join(DIR, 'repo');
  mkdirSync(join(repo, 'p'), { recursive: true });
  git(repo, ['init', '-q', '.']);
  writeFileSync(join(repo, 'big.bin'), Buffer.alloc(1 << 20, 0x61));
  const paths = [];
  for (let i = 0; i < 5400; i++) { const p = `p/${String(i).padStart(5, '0')}-${'x'.repeat(190)}`; writeFileSync(join(repo, p), `${i}\n`); paths.push(p); }
  git(repo, ['add', '-A']);
  git(repo, ['commit', '-q', '-m', 'tree']);
  git(repo, ['update-index', '--skip-worktree', '-z', '--stdin'], `${paths.join('\0')}\0`);
  const { openRecord } = await import('@deepbuild/record');
  const { openAsks } = await import('@deepbuild/asks');
  const { openLeases } = await import('@deepbuild/leases');
  const { openSupervisor } = await import('@deepbuild/supervisor');
  const { openCheckouts } = await import('@deepbuild/gate');
  const record = await openRecord({ path: join(DIR, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const leases = await openLeases({ record, now: Date.now });
  const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } }, resources: [], leases });
  process.env.STANDIN_REAL_GIT = realGit;
  process.env.STANDIN_MARK = join(DIR, 'stdin-call-reached');
  process.env.PATH = `${join(FIX, 'standin')}:${process.env.PATH}`;
  const checkouts = await openCheckouts({ store: join(DIR, 'store'), root: join(DIR, 'checkouts'), kinds: [], host: sup, leases, now: Date.now });
  say(`1. gate  · git stand-in stops before it reads a ${kb(Buffer.byteLength(paths.join('\0')))} path list; the 8 s budget kills it`);
  const at = Date.now();
  try { await checkouts.snapshot(repo, checkouts.budget()); say('   call resolved (unexpected)'); }
  catch (e) {
    say(`   call rejected after ${((Date.now() - at) / 1000).toFixed(1)} s: ${e.name}: ${e.message}`);
    clean.gate = e.name === 'OverBudget';
  }
  const stopped = existsSync(process.env.STANDIN_MARK) ? readFileSync(process.env.STANDIN_MARK, 'utf8').trim().replace(/^(?:-c \S+ )*/, '') : null;
  say(`   git stopped at: ${stopped ? `git ${stopped}` : 'no --stdin call (unexpected)'}`);
  if (!stopped?.endsWith(' --stdin')) clean.gate = false;
  await checkouts.close().catch(() => undefined);
  await sup.close().catch(() => undefined);
  await record.close().catch(() => undefined);
  say(`   uncaught exceptions so far: ${uncaught.length}`);
}

// 2. The probe runner: a probe that exits at once, handed a 2 MB input.
{
  const { runProbe } = await import('@deepbuild/conformance');
  const input = { data: 'x'.repeat(2_000_000) };
  say(`2. probe · probe is process.exit(1), input ${kb(Buffer.byteLength(JSON.stringify(input)))}`);
  const r = await runProbe(join(FIX, 'exit-probe.mjs'), input, { checkout: DIR, deadline: 120_000, now: Date.now }, { kind: 'numbers', file: 'exit-probe.mjs' });
  say(`   check outcome: ${r.outcome} · ${r.failures[0]?.message ?? ''}`);
  clean.probe = r.outcome === 'failed';
  say(`   uncaught exceptions so far: ${uncaught.length}`);
}

// 3. The judge or agent launcher: a CLI that exits 1 before it reads a 300 KB prompt.
{
  const { runCli } = await import(join(ROOT, 'packages/config-eval/dist/launcher.js'));
  const prompt = 'x'.repeat(300_000);
  say(`3. cli   · CLI exits 1 without reading stdin, prompt ${kb(prompt.length)}`);
  const lines = await runCli([join(FIX, 'exits-at-once.sh')], prompt, DIR, { PATH: '/usr/bin:/bin' }, Date.now() + 120_000);
  say(`   runCli resolved with ${lines.length} lines${lines.length === 0 ? ' (a failed call)' : ''}`);
  clean.cli = lines.length === 0;
  say(`   uncaught exceptions so far: ${uncaught.length}`);
}

rmSync(DIR, { recursive: true, force: true });
say('');
const cleanly = Object.values(clean).filter(Boolean).length;
const ok = uncaught.length === 0 && cleanly === 3;
say(ok
  ? `RESULT ok · 3 of 3 calls failed cleanly · uncaught exceptions: 0 · process ${process.pid} still up after ${process.uptime().toFixed(1)} s`
  : `RESULT FAIL · ${cleanly} of 3 calls failed cleanly · uncaught: ${uncaught.join('; ') || 0}`);
process.exitCode = ok ? 0 : 1;

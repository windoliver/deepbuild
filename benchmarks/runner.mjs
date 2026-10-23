// The runner's per-job overhead, for the perf lane's budgets (issue #159): node benchmarks/runner.mjs.
// One process opens a record, the asks core, the budget ledger, the supervisor and the runner in a temp folder
// with a stand-in claude (a shell script that answers at once in stream-json), then runs 10 read-only jobs through
// the runner, interleaved with 10 bare spawns of the same launch, and prints the median of each, their difference
// and the runner's resident memory as one JSON line. The issue's limits stay in tests/acceptance/159/budgets.test.ts.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { openLedger } from '../packages/budget/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openRunner } from '../packages/runner/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const ROUNDS = 10;
const ACCOUNT = '0b0b0b0b-1111-4222-8333-444444444444';
const facts = JSON.parse(readFileSync(new URL('../adapters/claude-code.facts.json', import.meta.url), 'utf8'));
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-runner-bench-')));
const home = join(dir, 'home');
const bin = join(dir, 'bin');
mkdirSync(home);
mkdirSync(bin);
writeFileSync(join(home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT } }));
const claude = join(bin, 'claude');
writeFileSync(claude, `#!/bin/sh
for a in "$@"; do [ "$a" = --version ] && { echo "${facts.versions.at(-1)} (Claude Code)"; exit 0; }; done
cat >/dev/null
echo '{"type":"system","subtype":"init","session_id":"00000000-0000-4000-8000-000000000159"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"Ok.","total_cost_usd":0,"session_id":"00000000-0000-4000-8000-000000000159"}'
`, { mode: 0o755 });
const bare = () => new Promise((resolve, reject) => {
  const t0 = performance.now();
  const child = spawn(claude, facts.launch.readOnlyJob.args, { cwd: dir, env: { HOME: home, PATH: '/usr/bin:/bin' }, stdio: ['pipe', 'pipe', 'ignore'] });
  child.stdout.resume();
  child.on('error', reject);
  child.on('exit', () => resolve(performance.now() - t0));
  child.stdin.end('Ok.');
});

const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const ledger = await openLedger({ record, asks, now: Date.now, price: async () => null });
const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
const runner = await openRunner({
  record, asks, supervisor, ledger, now: Date.now, root: join(dir, 'root'), loginPath: `${bin}:/usr/bin:/bin`, env: { HOME: home, PATH: '/usr/bin:/bin' },
  settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 172_800_000 } } },
});
try {
  const resets = Math.floor(Date.now() / 1000) + 3 * 3600;
  await runner.report({ agent: 'claude-code', account: ACCOUNT, rate_limits: { five_hour: { used_percentage: 5, resets_at: resets }, seven_day: { used_percentage: 5, resets_at: resets } } });
  // A warm-up: the binary is verified once, before the first job.
  await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Ok.' });
  const through = [];
  const direct = [];
  let rss = 0;
  for (let i = 0; i < ROUNDS; i++) {
    const t0 = performance.now();
    const rec = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Ok.' });
    if (rec.state !== 'finished') throw Error(`a job didn't finish: ${JSON.stringify(rec)}`);
    through.push(performance.now() - t0);
    rss = Math.max(rss, process.memoryUsage().rss);
    direct.push(await bare());
  }
  const readings = { runnerMs: median(through), bareMs: median(direct) };
  console.log(JSON.stringify({ ...readings, overheadMs: readings.runnerMs - readings.bareMs, rssMb: rss / 2 ** 20 }));
} finally {
  await runner.close();
  await supervisor.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}

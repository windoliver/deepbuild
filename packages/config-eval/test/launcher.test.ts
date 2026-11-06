// The default launcher (#112) against fake `claude` and `codex` executables on PATH, which print what the real ones'
// headless streams do: each test failed on the program it names.
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runEval } from '../src/index.js';
import { runCli } from '../src/launcher.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });

function world(sleep: number) {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'dce-launch-')));
  roots.push(box);
  const bin = join(box, 'bin');
  const repo = join(box, 'shop');
  mkdirSync(bin);
  mkdirSync(repo);
  // Each Claude Code run reports a 5-hour window, then its result: the probe (in an empty folder) 0.11, the base side's
  // run 0.13 at once, and the change side's 0.12 a second later, so the fuller reading isn't the last to arrive.
  writeFileSync(join(bin, 'claude'), `#!/bin/sh
cat > /dev/null
sleep ${sleep}
if grep -q thorough CLAUDE.md 2>/dev/null; then sleep 1; u=12; elif [ -f CLAUDE.md ]; then u=13; else u=11; fi
echo '{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour","utilization":0.'$u',"resetsAt":1793491200}}'
echo fixed > fix.txt
echo '{"type":"result","subtype":"success","is_error":false,"result":"Fixed it.","usage":{"input_tokens":100,"cache_read_input_tokens":30,"output_tokens":20}}'
`);
  writeFileSync(join(bin, 'codex'), `#!/bin/sh
cat > /dev/null
echo '{"type":"item.completed","item":{"type":"agent_message","text":"{\\"grades\\":[{\\"label\\":\\"A\\",\\"score\\":0.9},{\\"label\\":\\"B\\",\\"score\\":0.8}]}"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":5,"output_tokens":5}}'
`);
  for (const f of ['claude', 'codex']) chmodSync(join(bin, f), 0o755);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@shop.test', ...args], { cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init', '-q');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Shop\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  const commit = git('rev-parse', 'HEAD');
  const plan = (ms: number) => ({
    id: 'p1', cutoff: 1_000, tasks: ['t1'], fitted: [], repeats: 1, rule: 'paired-mean-one-sided-95' as const,
    variants: { base: { name: 'b', files: { 'CLAUDE.md': '# Shop\nBe brief.\n' } }, change: { name: 'c', files: { 'CLAUDE.md': '# Shop\nBe thorough.\n' } } },
    models: { agent: 'claude-haiku-5-5', judge: 'gpt-reserve' }, measures: [{ name: 'grade', better: 'higher' as const }, { name: 'tokens', better: 'lower' as const }], budget: { ms, plan_share: 1 },
  });
  return { box, plan, tasks: [{ id: 't1', at: 2_000, repo, commit, prompt: 'Fix the cart.' }], env: { PATH: `${bin}:/usr/bin:/bin`, HOME: box } };
}

it("reads the real agents' replies, tokens and 5-hour window, and the judge's grades, from their streams", async () => {
  // Failed on a launcher with no window reading (plan share null), one that kept the last reading to arrive rather
  // than the fullest, and one that read only the uncached input tokens.
  const w = world(0);
  const report = await runEval({ plan: w.plan(600_000), tasks: w.tasks, root: join(w.box, 'work'), env: w.env });
  expect(report.runs.map((r) => r.ok)).toEqual([true, true]);
  expect(report.runs.map((r) => r.metrics.tokens)).toEqual([150, 150]);
  expect(report.runs.map((r) => r.metrics.grade).sort()).toEqual([0.8, 0.9]);
  // The probe read 0.11 before the first run; the runs read 0.13, then 0.12.
  expect(report.usage.plan_share).toBeCloseTo(0.02, 9);
}, 60_000);

it('ends a run when its CLI exits, though a helper outside its process group still holds its output', async () => {
  // Failed on a launcher that waited for the output to close, which the helper held for its 30 seconds.
  const w = world(0);
  const helper = join(w.box, 'helper.pid');
  writeFileSync(join(w.box, 'bin', 'claude'), `#!/bin/sh
cat > /dev/null
echo fixed > fix.txt
perl -e 'setpgrp(0, 0); open(my $f, ">>", "${helper}"); print $f "$$\\n"; close $f; sleep 30' &
echo '{"type":"result","subtype":"success","is_error":false,"result":"Fixed it.","usage":{"input_tokens":100,"output_tokens":20}}'
`);
  const t0 = performance.now();
  try {
    const report = await runEval({ plan: w.plan(600_000), tasks: w.tasks, root: join(w.box, 'work'), env: w.env });
    expect(performance.now() - t0).toBeLessThan(20_000);
    expect(report.runs.map((r) => r.ok)).toEqual([true, true]);
  } finally {
    // Only the helpers this test started, by the PID each wrote.
    for (const pid of (existsSync(helper) ? readFileSync(helper, 'utf8') : '').split('\n').filter(Boolean)) {
      try { process.kill(Number(pid), 'SIGKILL'); } catch { /* gone */ }
    }
  }
}, 120_000);

it('stops a run at the eval\'s deadline, so an eval ends within its stated time', async () => {
  // Failed on a launcher that let each run go on for its own 30 minutes.
  const w = world(30);
  const t0 = performance.now();
  const report = await runEval({ plan: w.plan(2_000), tasks: w.tasks, root: join(w.box, 'work'), env: w.env });
  expect(performance.now() - t0).toBeLessThan(15_000);
  expect(report.runs.map((r) => r.ok)).toEqual([false, false]);
}, 60_000);

it("refuses a replay whose copied sign-in expires before the agents' deadline, naming when", async () => {
  // Failed on a launcher that copied the access token without reading when it expires, so later runs failed sign-in
  // and counted as failed pairs.
  const w = world(0);
  mkdirSync(join(w.box, '.claude'));
  writeFileSync(join(w.box, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'fake-access', refreshToken: 'fake-refresh', expiresAt: Date.now() + 60_000 } }));
  const report = await runEval({ plan: w.plan(600_000), tasks: w.tasks, root: join(w.box, 'work'), env: w.env });
  expect(report.runs).toEqual([]);
  expect(report.after.outcome).toBe('refused');
  expect(report.after.reason).toMatch(/sign-in expires at .*before the replay's runs end/);
}, 60_000);

it('refuses a model endpoint off this machine over plain http, which the tunnel cannot carry', async () => {
  // Failed on a launcher that set only HTTPS_PROXY, so each run's plain-http request to the endpoint was refused in
  // the sandbox and counted as a failed pair.
  const w = world(0);
  const report = await runEval({ plan: w.plan(600_000), tasks: w.tasks, root: join(w.box, 'work'), env: { ...w.env, ANTHROPIC_BASE_URL: 'http://model.example:8080' } });
  expect(report.runs).toEqual([]);
  expect(report.after.reason).toMatch(/http:\/\/model\.example:8080.*https/);
}, 60_000);

it('refuses a replay whose sandbox would read your home, where the CLI is installed in its top folder', async () => {
  // Failed on a launcher that granted the CLI's folder whatever it held, so with claude in your home's top folder the
  // agent could read your Claude, gh and ssh credentials.
  const w = world(0);
  writeFileSync(join(w.box, 'claude'), readFileSync(join(w.box, 'bin', 'claude')));
  chmodSync(join(w.box, 'claude'), 0o755);
  const report = await runEval({ plan: w.plan(600_000), tasks: w.tasks, root: join(w.box, 'work'), env: { ...w.env, PATH: `${w.box}:${w.env.PATH}` } });
  expect(report.runs).toEqual([]);
  expect(report.after.reason).toContain(`reads ${w.box}`);
  expect(report.after.reason).toMatch(/holds your home/);
}, 60_000);

it('refuses a replay whose sandbox would read your home through a link to it', async () => {
  // Failed on a launcher that resolved your home but not the folder on PATH it reached claude by, so with /home a link
  // (as on Fedora Silverblue) and claude a link in your home's top folder, it granted your home under the link's name.
  const w = world(0);
  const link = join(w.box, '..', `${w.box.split('/').pop()}-link`);
  symlinkSync(w.box, link);
  roots.push(link);
  symlinkSync(join(w.box, 'bin', 'claude'), join(w.box, 'claude'));
  const report = await runEval({ plan: w.plan(600_000), tasks: w.tasks, root: join(w.box, 'work'), env: { ...w.env, PATH: `${link}:${w.env.PATH}` } });
  expect(report.runs).toEqual([]);
  expect(report.after.reason).toContain(`reads ${link}`);
  expect(report.after.reason).toMatch(/holds your home/);
}, 60_000);

it("ends a run on the sandbox helper's exit line though it arrives in two pieces", async () => {
  // Failed on a reader that looked for "exit" inside each chunk of fd 3, so a line split across two chunks never ended
  // the run while the sandbox stayed up.
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'dce-fd3-')));
  roots.push(box);
  const pidFile = join(box, 'cli.pid');
  const cli = join(box, 'cli');
  writeFileSync(cli, `#!/bin/sh
echo $$ > "${pidFile}"
cat > /dev/null
echo '{"type":"result","subtype":"success","is_error":false,"result":"Fixed it."}'
printf '{"ex' >&3
sleep 0.5
printf 'it":0}\\n' >&3
sleep 30
`);
  chmodSync(cli, 0o755);
  const t0 = performance.now();
  try {
    const lines = await runCli([cli], 'go', box, { PATH: '/usr/bin:/bin' }, Date.now() + 60_000);
    expect(performance.now() - t0).toBeLessThan(15_000);
    expect(lines).toContainEqual(expect.objectContaining({ type: 'result', result: 'Fixed it.' }));
  } finally {
    // Only the group the fake wrote down: an empty file would read 0, and kill(0) is this runner's own group.
    const pgid = existsSync(pidFile) ? Number(readFileSync(pidFile, 'utf8')) : 0;
    if (pgid > 1) try { process.kill(-pgid, 'SIGKILL'); } catch { /* gone */ }
  }
}, 60_000);

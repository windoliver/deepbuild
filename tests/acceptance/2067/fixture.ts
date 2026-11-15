// Blind acceptance for #2067, base 1c4d1f0e2aaad8c6a6573848823566d04ff73d17.
// Enters through deep hub run, real deep-hook, .deepbuild/done.yaml and events.read/changes.read.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { startHub as launch, cleanup as cleanupHub } from '../16/helpers.ts';
import {
  ACCOUNT, CHECKS, COVERED, FIX, FLAG, Session, WORK_LINK, childEnv, claimsOf, cleanup, control, decision, draftFor, git,
  itemTask, lastPos, lockedFor, makeWorld, receipt, replyText, runOf, settle, taskVerdicts, workItem,
  type Ev, type Hub,
} from '../325/helpers.ts';
import { CRITERIA, LEGACY, RELEASE_SPEC, RELEASE_TEST } from '../325/scenarios.ts';

export const AC1 = '#2067.97392e0a', AC2 = '#2067.47a66ecb', AC3 = '#2067.fa764398', AC4 = '#2067.51b5aef6';
type Mainline = 'trunk' | 'develop' | 'remote-main' | 'remote-master' | 'missing' | 'unreadable' | 'local-main';
const PR = 'https://github.com/acme/shop/pull/12';
const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export async function clean() { await cleanupHub(); await cleanup(); }

export async function fixture(mode: Mainline, options: { undefinedCheck?: boolean; conflict?: boolean; passing?: boolean } = {}) {
  const spec = options.undefinedCheck ? RELEASE_SPEC.replace(/^  preflight:.*\n/m, '') : RELEASE_SPEC;
  const w = makeWorld({
    spec, files: { 'tests/release.test.js': RELEASE_TEST, 'src/merge.txt': 'base\n' },
    mainAhead: { 'src/limits.js': 'module.exports = { strict: true };\n', ...(options.conflict ? { 'src/merge.txt': 'main\n' } : {}) },
    drafts: [draftFor(2067, [{ text: CRITERIA.expired, check: CHECKS.expired }])],
    readings: [workItem(2067, 'Expired tokens are accepted', [CRITERIA.expired])],
  });
  const g = (...args: string[]) => git(w.tmp, w.repo, args);
  if (mode !== 'local-main') {
    g('branch', '-D', 'main');
    if (['trunk', 'develop', 'remote-main', 'remote-master'].includes(mode)) {
      const branch = mode.replace('remote-', '');
      // Last-fetched refs only. No live remote service, and no local default branch.
      g('remote', 'add', 'origin', join(w.tmp, 'offline-origin.git'));
      g('update-ref', `refs/remotes/origin/${branch}`, w.main);
      if (mode === 'trunk' || mode === 'develop') {
        g('symbolic-ref', 'refs/remotes/origin/HEAD', `refs/remotes/origin/${branch}`);
        // A green decoy proves the recorded default wins over the fallback's name.
        g('update-ref', 'refs/remotes/origin/main', w.base);
      }
    }
  }
  const bin = join(w.tmp, 'bin'), fetched = join(w.tmp, 'fetch-attempts');
  mkdirSync(bin);
  // The automatic PR review is unrelated to release-check selection. Reuse #1537's
  // external-model boundary fixture, with no findings, rather than start a real model.
  const reviewer = readFileSync(new URL('../1537/fixtures/fake-reviewer.pl', import.meta.url), 'utf8');
  writeFileSync(join(bin, 'claude'), reviewer.replace('__CONFIG__', Buffer.from(JSON.stringify({
    version: COVERED, model: 'claude-sonnet-5-5', findings: [],
  })).toString('base64')), { mode: 0o755 });
  const config = JSON.parse(readFileSync(join(w.root, 'config.json'), 'utf8'));
  writeFileSync(join(w.root, 'config.json'), JSON.stringify({ ...config, runner: { login_path: `${bin}:/usr/bin:/bin` } }));
  // An inert credential file keeps the runner out of the real OS keychain; the fake authenticates itself.
  writeFileSync(join(w.home, '.claude/.credentials.json'), '{}\n', { mode: 0o600 });
  writeFileSync(join(w.home, '.claude/settings.json'), '{}\n');
  const realGit = execFileSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nfor arg do\n  if [ "$arg" = fetch ]; then echo fetch >> ${q(fetched)}; exit 97; fi\ndone\nexec ${q(realGit)} "$@"\n`, { mode: 0o755 });
  const github = join(w.tmp, 'github.json');
  writeFileSync(github, '{"answers":[]}\n');
  const h = await launch({ home: w.home, env: {
    ...childEnv(w.home), PATH: `${bin}:${childEnv(w.home).PATH}`,
    GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_CONFIG_DIR: join(w.home, '.config/gh'),
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_PRICES: w.prices,
    DEEP_HUB_TEST_STOP_HOLD_MS: '120000', DEEP_HUB_TEST_GITHUB: github,
    // changes.read cannot contact a real forge (file: is not a fetch network protocol).
    DEEP_HUB_TEST_FORGE: 'file:///no-network-forge',
  } }, 120_000);
  const hub: Hub = { ...h, child: h.proc.child, exit: h.proc.exit.then(() => undefined), plant: undefined, stderr: h.proc.stderr };
  await control(hub, 'windows.report', { agent: 'claude-code', account: ACCOUNT,
    rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.round((Date.now() + 3_600_000) / 1000) } } });
  const s = new Session(w);
  await s.start();
  // One typed request binds the issue and authorizes PR creation without opening
  // a second task for an authority-answer turn. "Then stop" lets slow checks start.
  await s.typed(`Fix ${WORK_LINK(2067)} and open a pull request, then stop.`);
  await s.read('src/auth.js');
  const locked = await settle(hub, (ev) => { const task = itemTask(ev, s); return task !== undefined && lockedFor(ev, task).length > 0; }, 60_000);
  const task = itemTask(locked, s)!;
  expect(lockedFor(locked, task).length, 'the one issue definition locks').toBe(1);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  if (!options.passing) await s.edit(LEGACY.file, LEGACY.from, LEGACY.to);
  if (options.conflict) await s.edit('src/merge.txt', 'base\n', 'feature\n');
  // Establish passing ordinary requirements first, so no unrelated failure can hold Closes.
  const before = await lastPos(hub);
  const initial = await s.stop('Expired tokens are rejected.');
  // A loaded host can put even these tiny checks in the slow lane. Wait for a
  // terminal verdict, not specifically PASS, and diagnose the actual run records.
  const ordinary = await settle(hub, (ev) => taskVerdicts(ev, task, before).length > 0, 240_000);
  expect(taskVerdicts(ordinary, task, before).at(-1)?.data.outcome, `ordinary requirements pass before the PR: ${replyText(initial)}; hub: ${hub.stderr().slice(-2000)}; record: ${JSON.stringify(ordinary.filter((e) => e.log_pos > before && /^(claim|verdict|run)\./.test(e.kind)).map((e) => ({ kind: e.kind, id: e.id, claim: e.data.claim, task: e.data.task_ref, check: e.data.check, outcome: e.data.outcome })))}`).toBe('PASS');
  const committed = await s.bash('git commit -qam "Reject expired tokens"', () => { g('commit', '-qam', 'Reject expired tokens'); });
  expect(committed.allowed, 'fixture commit is allowed').toBe(true);
  if (mode === 'unreadable') {
    // A real ref whose object is absent: HEAD and the claim's checkout remain readable.
    // Distinct from missing: refs/heads/main exists, but Git cannot read its commit.
    writeFileSync(join(w.repo, '.git/refs/heads/main'), `${'f'.repeat(40)}\n`);
  }
  const baseBranch = mode === 'trunk' || mode === 'develop' ? mode : mode === 'remote-master' ? 'master' : 'main';
  const command = (body: string) => `gh pr create --base ${baseBranch} --title "Reject expired tokens" --body ${q(body)}`;
  // Probe the guard without publishing (even a simulated successful Closes must not create another PR).
  const create = async (body: string) => {
    const before = await s.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: command(body) }, tool_use_id: `probe-${randomUUID()}` });
    return { allowed: decision(before) === 'allow', before };
  };
  const part = await s.bash(command('Part of #2067'), () => ({ stdout: `${PR}\n`, stderr: '', interrupted: false, isImage: false }));
  expect(part.allowed, `Part of is allowed with your authority: ${replyText(part.before)}`).toBe(true);
  const since = await lastPos(hub);
  const stop = await s.stop(`Opened ${PR} (Part of #2067).`);
  const events = await settle(hub, (ev) => taskVerdicts(ev, task, since).length > 0, 120_000);
  const claim = claimsOf(events, task, since).at(-1);
  expect(claim, 'the PR stop creates a claim for the locked task').toBeDefined();
  const verdict = taskVerdicts(events, task, since).at(-1);
  expect(verdict, `the PR claim gets a verdict, not a timeout: ${replyText(stop)}; hub: ${hub.stderr().slice(-2000)}; record: ${JSON.stringify(events.filter((e) => e.log_pos > since && /^(claim|verdict|run)\./.test(e.kind)).map((e) => ({ kind: e.kind, id: e.id, claim: e.data.claim, task: e.data.task_ref, check: e.data.check, outcome: e.data.outcome })))}`).toBeDefined();
  expect(verdict!.data.claim, 'verdict belongs to this PR claim').toBe(`claim:${claim!.id}`);
  const change = await receipt(hub, `claim:${claim!.id}`);
  expect(Array.isArray(change.checks), 'the public receipt exists').toBe(true);
  const closesAfter = await create('Closes #2067');
  // Count every release run in this isolated hub, so another task cannot hide a duplicate.
  const release = (ev: Ev[]) => ev.filter((e) => e.kind === 'run.started' && runOf('preflight')({ started: e }))
    .map((started) => ({ started, finished: ev.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
  const evidence = {
    mode, undefinedCheck: !!options.undefinedCheck, conflict: !!options.conflict,
    claim: claim!.id, head: w.head(), main: w.main, verdict: verdict!.data.outcome, reasons: verdict!.data.reasons,
    checks: change.checks, releaseRuns: release(events).map((r) => ({ commit: r.started.data.commit, outcome: r.finished?.data.outcome })),
    closesAfter: { allowed: closesAfter.allowed, reason: replyText(closesAfter.before) },
  };
  console.log(`2067 evidence ${JSON.stringify(evidence)}`);
  expect(existsSync(fetched), 'mainline resolution must never fetch').toBe(false);
  return { w, g, s, hub, task, since, events, change, verdict: verdict!, release, closesAfter, evidence };
}

export function held(r: Awaited<ReturnType<typeof fixture>>) {
  expect.soft(r.closesAfter.allowed, 'Closes must remain refused after a non-PASS release claim').toBe(false);
  expect.soft(replyText(r.closesAfter.before), 'the refusal names preflight').toMatch(/preflight/i);
}
export function blocked(r: Awaited<ReturnType<typeof fixture>>, cause: RegExp) {
  expect.soft(r.verdict.data.outcome, 'preflight must be BLOCKED, not silently absent').toBe('BLOCKED');
  const check = r.change.checks.find((c: { check: string }) => c.check === 'preflight');
  expect.soft(check?.outcome, 'preflight stands on the claim as missing, not silently dropped').toBe('missing');
  const why = JSON.stringify(r.verdict.data.reasons);
  expect.soft(why, 'the verdict names preflight').toMatch(/preflight/i);
  expect.soft(why, 'the verdict names the missing outside-code cause').toMatch(cause);
  expect.soft(why, 'the cause belongs to you').toMatch(/\byou\b/i);
  held(r);
}


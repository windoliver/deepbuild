// Blind acceptance redraft: #2067 AC1, base 1c4d1f0e2aaad8c6a6573848823566d04ff73d17.
// Only public hooks and record reads; #325 supplies the real hub/hook/runner fixture support.
import { afterEach, expect, it } from 'vitest';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  ACCOUNT, CHECKS, COVERED, FIX, FLAG, NODE, SETTINGS, Session, childEnv, cleanup, control, decision, draftFor, git, lastPos,
  makeWorld, replyText, run, runOf, runsOf, settle, startHub, startOnItem, taskVerdicts,
  workItem, type Ev,
} from '../325/helpers.ts';
import { LEGACY, PR_URL, RELEASE_SPEC, RELEASE_TEST } from '../325/scenarios.ts';

const AC1 = 'AC1 #2067.97392e0a';
const n = 9;
const requirement = 'An expired token is rejected with 401';
const prCreate = (body: string) => `gh pr create --base trunk --title "Reject expired tokens" --body "${body}"`;

afterEach(cleanup, 60_000);

it(`${AC1} trunk PR fails on preflight at the merge and Closes is refused naming preflight`, async () => {
  const w = makeWorld({
    spec: RELEASE_SPEC,
    files: { 'tests/release.test.js': RELEASE_TEST },
    mainAhead: { 'src/limits.js': 'module.exports = { strict: true };\n' },
    drafts: [draftFor(n, [{ text: requirement, check: CHECKS.expired }])],
    readings: [workItem(n, 'Expired tokens are accepted', [requirement])],
  });
  // The only remote is a local bare fixture. Fetch its trunk once, before the hub starts;
  // origin/HEAD records its default branch as last fetched. No local main or master exists.
  git(w.tmp, w.repo, ['branch', '-m', 'main', 'trunk']);
  const origin = join(w.tmp, 'origin.git');
  git(w.tmp, w.tmp, ['clone', '-q', '--bare', '--no-hardlinks', w.repo, origin]);
  git(w.tmp, origin, ['symbolic-ref', 'HEAD', 'refs/heads/trunk']);
  git(w.tmp, w.repo, ['remote', 'add', 'origin', origin]);
  git(w.tmp, w.repo, ['fetch', '-q', '--no-tags', 'origin', '+refs/heads/trunk:refs/remotes/origin/trunk']);
  git(w.tmp, w.repo, ['remote', 'set-head', 'origin', 'trunk']);
  const branches = git(w.tmp, w.repo, ['for-each-ref', '--format=%(refname)', 'refs/heads']).split('\n');
  const remoteHead = git(w.tmp, w.repo, ['symbolic-ref', 'refs/remotes/origin/HEAD']);
  expect(branches, 'fixture has neither local main nor master').not.toContain('refs/heads/main');
  expect(branches, 'fixture has neither local main nor master').not.toContain('refs/heads/master');
  expect(remoteHead, 'fixture default branch is the recorded remote trunk').toBe('refs/remotes/origin/trunk');
  expect(git(w.tmp, w.repo, ['rev-parse', remoteHead])).toBe(w.main);

  // #1537's external-model stand-in, configured with no findings as in #1523. Keep the
  // real review gate and runner; never let a PR review fall back to an installed model.
  const bin = join(w.tmp, 'bin');
  mkdirSync(bin);
  const reviewer = readFileSync(new URL('../1537/fixtures/fake-reviewer.pl', import.meta.url), 'utf8');
  writeFileSync(join(bin, 'claude'), reviewer.replace('__CONFIG__', Buffer.from(JSON.stringify({
    version: COVERED, model: 'claude-sonnet-5-5', findings: [],
  })).toString('base64')), { mode: 0o755 });
  writeFileSync(join(w.root, 'config.json'), JSON.stringify({
    asks: SETTINGS, runner: { login_path: `${bin}:/usr/bin:/bin` }, plan: { reserve_pct: 10 },
  }));
  writeFileSync(join(w.home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: {
    accessToken: `sk-ant-oat01-FAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-FAKE${'y'.repeat(40)}`,
    expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max',
  } }), { mode: 0o600 });
  writeFileSync(join(w.home, '.claude', 'settings.json'), '{}\n');
  mkdirSync(join(w.root, 'wiki'));
  writeFileSync(join(w.root, 'wiki', 'review-rubric.md'), readFileSync(new URL('../1537/fixtures/rubric.md', import.meta.url)));
  const hub = await startHub(w);
  await control(hub, 'windows.report', {
    agent: 'claude-code', account: ACCOUNT,
    rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.round((Date.now() + 3 * 3_600_000) / 1000) } },
  });
  const s = new Session(w);
  const ref = await startOnItem(hub, s, n, AC1);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  await s.edit(LEGACY.file, LEGACY.from, LEGACY.to);
  const ordinary = await s.stop('Expired tokens are rejected, and legacy tokens are allowed again.');
  expect(decision(ordinary), `fixture ordinary checks must pass: ${replyText(ordinary)}`).toBe('allow');

  await s.typed('Can you open the pull request now?');
  const commit = await s.bash('git commit -qam "Reject expired tokens"', () => {
    git(w.tmp, w.repo, ['commit', '-qam', 'Reject expired tokens']);
  });
  expect(commit.allowed, 'fixture commit goes through the real hooks').toBe(true);
  const head = w.head();

  // Qualify the planted failure, independently of the hub: preflight passes on each tip
  // alone and fails on their conflict-free merge, on its assertion (not an import error).
  const probe = join(w.tmp, 'probe');
  git(w.tmp, w.tmp, ['clone', '-q', '--no-hardlinks', w.repo, probe]);
  const controls: { tree: string; code: number | null }[] = [];
  for (const [tree, revision, expected] of [['trunk', w.main, 0], ['head', head, 0], ['merge', head, 1]] as const) {
    git(w.tmp, probe, ['checkout', '-q', '--detach', revision]);
    if (tree === 'merge') git(w.tmp, probe, ['merge', '-q', '--no-edit', w.main]);
    const r = await run(NODE, ['--test', 'tests/release.test.js'], { cwd: probe, env: childEnv(w.home) });
    controls.push({ tree, code: r.code });
    expect(r.timedOut, `fixture preflight ${tree} must finish`).toBe(false);
    expect(r.code, `fixture preflight ${tree}: ${r.stdout}\n${r.stderr}`).toBe(expected);
    if (tree === 'merge') {
      expect(r.stdout, 'fixture merge fails on the preflight assertion').toContain('ERR_ASSERTION');
      expect(r.stdout).toContain('a strict code base never allows legacy tokens');
    }
  }

  // Play only GitHub's external response. The real PreToolUse decides whether it happens.
  let forgeWrites = 0;
  const ghResult = () => {
    forgeWrites++;
    return { stdout: `${PR_URL}\n`, stderr: '', interrupted: false, isImage: false };
  };
  const since = await lastPos(hub);
  const part = await s.bash(prCreate(`Part of #${n}`), ghResult);
  expect(part.allowed, `fixture opens its PR without claiming closure: ${replyText(part.before)}`).toBe(true);
  const stop = await s.stop(`Opened ${PR_URL} (Part of #${n}).`);
  const terminal = (all: Ev[]) => taskVerdicts(all, ref, since).filter((v) => v.data.outcome !== 'pending').at(-1);
  const events = await settle(hub, (all) => terminal(all) !== undefined, 120_000);
  const verdict = terminal(events);
  expect(verdict, 'fixture PR claim must be judged, not time out').toBeDefined();
  const runs = runsOf(events, ref, since);
  const releaseRuns = runs.filter(runOf('preflight'));

  // Observe Closes even on a faulty PASS/no-release hub, before any AC1 assertion fails.
  const closes = await s.bash(prCreate(`Closes #${n}`), ghResult);
  const observed = {
    branches, remoteHead, controls,
    ordinaryStop: decision(ordinary), prStop: decision(stop),
    verdict: verdict && { outcome: verdict.data.outcome, reasons: verdict.data.reasons },
    runs: runs.map(({ started, finished }) => ({
      check: started.data.check, outcome: finished?.data.outcome ?? 'running',
      commit: started.data.commit === head ? 'head' : started.data.commit === w.main ? 'trunk' : 'other',
    })),
    releaseRunsInRecord: events.filter((e) => e.kind === 'run.started' && runOf('preflight')({ started: e })).length,
    closes: { decision: decision(closes.before), reason: replyText(closes.before), forgeWrites },
  };
  // Only synthetic fixture data, no raw environment, credentials, transcripts or host paths.
  const evidence = JSON.stringify(observed, null, 2).replaceAll(w.tmp, '<fixture>');
  console.log(`${AC1} observation\n${evidence}`);

  // asserts: these five lines carry AC1; fixture checks above only qualify its premises.
  expect.soft(verdict?.data.outcome, `${AC1}: preflight must make the trunk PR FAIL; ${evidence}`).toBe('FAIL');
  expect.soft(JSON.stringify(verdict?.data.reasons), `${AC1}: FAIL must name preflight`).toMatch(/\bpreflight\b/);
  expect.soft(releaseRuns.some((r) => r.finished?.data.outcome === 'failed'), `${AC1}: preflight must run and fail on the merge, not disappear`).toBe(true);
  expect.soft(decision(closes.before), `${AC1}: gh pr create saying Closes must be refused for preflight`).toBe('deny');
  expect.soft(replyText(closes.before), `${AC1}: Closes refusal must name preflight`).toMatch(/\bpreflight\b/);
}, 360_000);

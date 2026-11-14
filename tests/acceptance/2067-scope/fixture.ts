// Blind supplementary #2067 acceptance, unchanged base 1c4d1f0.
// Reuses #325's real CLI/hook/session fixtures and #1537's external-model stand-in.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import { startHub as launch, cleanup as cleanupHub } from '../16/helpers.ts';
import {
  ACCOUNT, CHECKS, COVERED, FIX, FLAG, Session, WORK_LINK, childEnv, claimsOf, cleanup, control,
  decision, draftFor, git, itemTask, lastPos, lockedFor, makeWorld, receipt, replyText, runOf,
  settle, taskVerdicts, workItem, type Ev, type Hub, type WorldOptions,
} from '../325/helpers.ts';
import { CRITERIA, RELEASE_SPEC, RELEASE_TEST } from '../325/scenarios.ts';

export const q = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
export async function clean() { await cleanupHub(); await cleanup(); }
export function world(options: WorldOptions = {}) {
  return makeWorld({
    spec: RELEASE_SPEC, files: { 'tests/release.test.js': RELEASE_TEST },
    mainAhead: { 'src/limits.js': 'module.exports = { strict: true };\n' },
    drafts: [draftFor(2067, [{ text: CRITERIA.expired, check: CHECKS.expired }])],
    readings: [workItem(2067, 'Expired tokens are accepted', [CRITERIA.expired])], ...options,
  });
}
export async function start(w: ReturnType<typeof world>, gitBoundary?: string) {
  const g = (...args: string[]) => git(w.tmp, w.repo, args);
  const bin = join(w.tmp, 'bin');
  mkdirSync(bin);
  const reviewer = readFileSync(new URL('../1537/fixtures/fake-reviewer.pl', import.meta.url), 'utf8');
  writeFileSync(join(bin, 'claude'), reviewer.replace('__CONFIG__', Buffer.from(JSON.stringify({
    version: COVERED, model: 'claude-sonnet-5-5', findings: [],
  })).toString('base64')), { mode: 0o755 });
  if (gitBoundary) writeFileSync(join(bin, 'git'), gitBoundary, { mode: 0o755 });
  const config = JSON.parse(readFileSync(join(w.root, 'config.json'), 'utf8'));
  writeFileSync(join(w.root, 'config.json'), JSON.stringify({ ...config, runner: { login_path: `${bin}:/usr/bin:/bin` } }));
  writeFileSync(join(w.home, '.claude/.credentials.json'), '{}\n', { mode: 0o600 });
  writeFileSync(join(w.home, '.claude/settings.json'), '{}\n');
  const github = join(w.tmp, 'github.json');
  writeFileSync(github, '{"answers":[]}\n');
  const h = await launch({ home: w.home, env: {
    ...childEnv(w.home), PATH: `${bin}:${childEnv(w.home).PATH}`,
    GH_TOKEN: undefined, GITHUB_TOKEN: undefined, GH_CONFIG_DIR: join(w.home, '.config/gh'),
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts,
    DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_PRICES: w.prices,
    DEEP_HUB_TEST_STOP_HOLD_MS: '120000', DEEP_HUB_TEST_GITHUB: github,
    DEEP_HUB_TEST_FORGE: 'file:///no-network-forge',
  } }, 120_000);
  const hub: Hub = { ...h, child: h.proc.child, exit: h.proc.exit.then(() => undefined), plant: undefined, stderr: h.proc.stderr };
  await control(hub, 'windows.report', { agent: 'claude-code', account: ACCOUNT,
    rate_limits: { five_hour: { used_percentage: 5, resets_at: Math.round((Date.now() + 3_600_000) / 1000) } } });
  const s = new Session(w);
  await s.start();
  await s.typed(`Fix ${WORK_LINK(2067)} and open a pull request, then stop.`);
  await s.read('src/auth.js');
  const locked = await settle(hub, (ev) => { const task = itemTask(ev, s); return !!task && lockedFor(ev, task).length > 0; }, 60_000);
  const task = itemTask(locked, s)!;
  expect(lockedFor(locked, task), 'one locked issue definition').toHaveLength(1);
  await s.edit(FIX.file, FIX.from, FIX.to);
  await s.edit(FLAG.file, FLAG.from, FLAG.to);
  const before = await lastPos(hub);
  await s.stop('Expired tokens are rejected.');
  const ordinary = await settle(hub, (ev) => taskVerdicts(ev, task, before).length > 0, 240_000);
  expect(taskVerdicts(ordinary, task, before).at(-1)?.data.outcome, 'ordinary requirements pass before the PR').toBe('PASS');
  const committed = await s.bash('git commit -qam "Reject expired tokens"', () => { g('commit', '-qam', 'Reject expired tokens'); });
  expect(committed.allowed, 'fixture commit allowed').toBe(true);
  const command = (body: string) => `gh pr create --base main --title "Reject expired tokens" --body ${q(body)}`;
  const closes = async () => {
    const reply = await s.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: command('Closes #2067') }, tool_use_id: `probe-${randomUUID()}` });
    return { allowed: decision(reply) === 'allow', reason: replyText(reply) };
  };
  const claim = async () => {
    const since = await lastPos(hub);
    await s.stop('Opened https://github.com/acme/shop/pull/12 (Part of #2067).');
    const events = await settle(hub, (ev) => taskVerdicts(ev, task, since).length > 0, 120_000);
    const made = claimsOf(events, task, since).at(-1);
    const verdict = taskVerdicts(events, task, since).at(-1);
    expect(made, 'a fresh PR claim exists').toBeDefined();
    expect(verdict, 'PR verdict exists, not a timeout').toBeDefined();
    expect(verdict!.data.claim).toBe(`claim:${made!.id}`);
    const change = await receipt(hub, `claim:${made!.id}`);
    expect(Array.isArray(change.checks), 'public receipt exists').toBe(true);
    return { events, verdict: verdict!, change, id: made!.id };
  };
  const open = async () => {
    const part = await s.bash(command('Part of #2067'), () => ({ stdout: 'https://github.com/acme/shop/pull/12\n', stderr: '', interrupted: false, isImage: false }));
    expect(part.allowed, `Part of allowed with authority: ${replyText(part.before)}`).toBe(true);
    return claim();
  };
  return { w, g, s, hub, task, closes, claim, open };
}
export function releaseRuns(events: Ev[]) {
  return events.filter((e) => e.kind === 'run.started' && runOf('preflight')({ started: e }))
    .map((started) => ({ started, finished: events.find((e) => e.kind === 'run.finished' && e.data.run === started.data.run) }));
}
export function missing(r: Awaited<ReturnType<Awaited<ReturnType<typeof start>>['claim']>>, name: string, cause: RegExp) {
  const why = JSON.stringify(r.verdict.data.reasons);
  expect.soft(r.verdict.data.outcome, `${name} cannot vanish or be replaced by another check`).toBe('BLOCKED');
  // Names may be qualified to avoid collisions; no invented ID policy.
  expect.soft(r.change.checks.some((c: { check: string; outcome: string }) => c.check.includes(name) && c.outcome === 'missing'), `${name} stands as a missing check on the receipt`).toBe(true);
  expect.soft(why).toMatch(new RegExp(name, 'i'));
  expect.soft(why, 'missing outside-code cause').toMatch(cause);
  expect.soft(why, 'owner is you').toMatch(/\byou\b/i);
}

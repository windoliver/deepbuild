// AC1 #70.d09103cb, live: the R1 end-to-end suite passes on Ubuntu LTS and Fedora with Claude Code: the release
// preflight's live lanes, but for the parts moved to #1712, #1713, #1714, #1715 and #1716.
//
// By hand, in each VM, signed in there: it starts real Claude Code sessions on your plan. It runs every live lane of
// scripts/lanes.mjs's releaseLanes as listed there, leaving out only the moved parts below, by name. Each kept suite must
// report tests run, none failed, none skipped. Without the opt-in, the token or `claude` on PATH, or off Linux, it fails
// BLOCKED; nothing skips. The wrong-program test at the end starts no session and runs anywhere.
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> \
//     node node_modules/vitest/vitest.mjs run --root tests/acceptance/70/redraft-ac1 e2e.live.test.ts

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO, distribution, requireLinux } from '../helpers.ts';

/** The amended criterion's ID: SHA-256 of its text as the issue reads on 2026-11-08, trimmed, white space collapsed. */
const AC1 = 'AC1 #70.d09103cb';
const HOUR = 3_600_000;

interface Lane { name: string; commands: string[][] }
/**
 * The parts of AC1 the owner moved out (issue #70, 2026-11-08), each by the suite folder its tests live in and, when only
 * some of a suite moved, by the criterion ID its tests' titles carry (from that suite's helpers.ts). The Codex half of
 * #1712 has no lane in releaseLanes, so it needs no entry: this test runs no Codex session.
 */
interface Moved { to: string; what: string; path: string; id?: string }
const MOVED: Moved[] = [
  { to: '#1712', what: "#18's live suites", path: 'tests/acceptance/18/' },
  { to: '#1712', what: "#25's live suites", path: 'tests/acceptance/25/' },
  { to: '#1713', what: "#668's AC4", path: 'tests/acceptance/668/', id: '#668.3ee80c65' },
  { to: '#1714', what: "#27's AC2", path: 'tests/acceptance/27/', id: '#27.6e863673' },
  { to: '#1715', what: '#567', path: 'tests/acceptance/567/' },
  { to: '#1716', what: "#669's AC2", path: 'tests/acceptance/669/', id: '#669.b95b4d96' },
  { to: '#1716', what: "#669's AC4", path: 'tests/acceptance/669/', id: '#669.059078dc' },
  { to: '#1716', what: "#669's AC5", path: 'tests/acceptance/669/', id: '#669.b5400502' },
  { to: '#1716', what: '#1156', path: 'tests/acceptance/1156/' },
];
/** What the amendment keeps, at least: each must still be run by its lane, or the criterion lost a part by accident. */
const KEPT = [
  { lane: 'spine checkpoint', path: 'tests/acceptance/666/' },
  { lane: 'setup checkpoint', path: 'tests/acceptance/668/' },
  { lane: 'done gate checkpoint', path: 'tests/acceptance/669/' },
  { lane: 'claude code adapter live', path: 'tests/acceptance/27/' },
];

interface Run { lane: string; file: string; command: string[]; leaveOut: Moved[] }
/**
 * Which commands to run. A lane is live when a command of it opts into real sessions (DEEP_HARNESS_LIVE=1), so a live
 * lane added later is kept and must pass. A command whose suite moved whole is left out, named; one with moved criteria
 * runs with those tests filtered out by vitest's -t, a negative lookahead on their IDs.
 */
function plan(lanes: Lane[]): { runs: Run[]; left: string[]; missing: string[] } {
  const runs: Run[] = [], left: string[] = [];
  for (const lane of lanes.filter((l) => l.commands.some((c) => c.includes('DEEP_HARNESS_LIVE=1')))) {
    for (const command of lane.commands) {
      const at = command.indexOf('--root');
      const file = at >= 0 ? posix.join(command[at + 1]!, command.at(-1)!) : command.at(-1)!;
      const moved = MOVED.filter((m) => file.startsWith(m.path));
      const whole = moved.find((m) => !m.id);
      if (whole) left.push(`${lane.name}: ${file}, all of it (${whole.what}, moved to ${whole.to})`);
      else runs.push({ lane: lane.name, file, command, leaveOut: moved });
    }
  }
  const missing = KEPT.filter((k) => !runs.some((r) => r.lane === k.lane && r.file.startsWith(k.path))).map((k) => `${k.lane} running ${k.path}`);
  return { runs, left, missing };
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** vitest's -t: every test whose full name carries none of the moved IDs. */
const namePattern = (leaveOut: Moved[]) => `^(?!.*(?:${leaveOut.map((m) => escape(m.id!)).join('|')}))`;

interface Assertion { title: string; ancestorTitles: string[]; status: string; failureMessages: string[] }
interface Report { testResults: { name: string; message?: string; assertionResults: Assertion[] }[] }
/**
 * One command's run read from vitest's JSON report. A test carrying a moved ID is named and doesn't count, whatever its
 * state; every other test must have passed. A test skipped without a moved ID in its own title was dropped by the filter
 * (say, through a describe's title): that is a kept test dropped, and fails. A non-zero exit fails the run unless a test
 * explains it; one explained only by a moved test's failure doesn't count. A runner killed outright always fails.
 */
function judge(run: Run, status: number | null, report: Report | undefined): { wrong: string[]; named: string[] } {
  if (!report) return { wrong: [`${run.lane} (${run.file}): exit ${status}, no report`], named: [] };
  const wrong: string[] = [], named: string[] = [];
  let passed = 0, movedFailed = false;
  for (const file of report.testResults) {
    if (file.message) wrong.push(`${run.lane} (${run.file}): the file failed outside its tests: ${file.message.slice(0, 500)}`);
    for (const t of file.assertionResults) {
      const moved = run.leaveOut.find((m) => t.title.includes(m.id!));
      if (moved) {
        named.push(`${run.lane}: ${run.file} › ${t.title} (${t.status}; ${moved.what}, moved to ${moved.to})`);
        movedFailed ||= t.status === 'failed';
      }
      else if (t.status === 'passed') passed++;
      else if (t.status === 'failed') wrong.push(`${run.lane}: ${run.file} › ${t.title} failed: ${(t.failureMessages[0] ?? '').slice(0, 1000)}`);
      else wrong.push(`${run.lane}: ${run.file} › ${t.title} didn't run (${t.status}); it is kept, and only a moved criterion's test may be left out`);
    }
  }
  if (!passed) wrong.push(`${run.lane} (${run.file}): no kept test ran and passed`);
  if (status !== 0 && (status === null || status >= 128 || (!wrong.length && !movedFailed))) wrong.push(`${run.lane} (${run.file}): the runner exited ${status} with no failed test to explain it`);
  return { wrong, named };
}

function requireLive(): void {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error(`${AC1} BLOCKED: this test starts real Claude Code sessions on your plan; run it by hand with DEEP_HARNESS_LIVE=1, signed in, in each VM`);
  requireLinux();
  const version = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 30_000 });
  if (version.error || version.status !== 0) throw Error(`${AC1} BLOCKED: claude isn't runnable on PATH: ${version.error?.message ?? `exit ${version.status}`}`);
  if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw Error(`${AC1} BLOCKED: the sessions run under temporary homes and sign in with CLAUDE_CODE_OAUTH_TOKEN (make one with \`claude setup-token\`)`);
}
const releaseLanes = async () => ((await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { releaseLanes: Lane[] }).releaseLanes;

describe(`${AC1} The R1 end-to-end suite passes on Ubuntu LTS and Fedora with Claude Code: the release preflight's live lanes, but for the parts moved to #1712, #1713, #1714, #1715 and #1716`, () => {
  it(`${AC1} (live) on this distribution, every live lane of the release preflight passes with real Claude Code sessions, the moved parts left out by name`, async () => {
    requireLive();
    const on = distribution();
    const { runs, left, missing } = plan(await releaseLanes());
    expect(missing, `${AC1} the release preflight must still run each part the amendment keeps`).toEqual([]);
    const out = mkdtempSync('/tmp/dh70-');
    const wrong: string[] = [], named: string[] = [...left];
    for (const [i, run] of runs.entries()) {
      const report = join(out, `${i}.json`);
      const filter = run.leaveOut.length ? ['-t', namePattern(run.leaveOut)] : [];
      const [command, ...args] = run.command;
      const r = spawnSync(command!, [...args, ...filter, '--reporter=default', '--reporter=json', `--outputFile.json=${report}`], {
        cwd: REPO, env: { ...process.env, DEEP_HARNESS_LIVE: '1' }, encoding: 'utf8', timeout: 4 * HOUR, maxBuffer: 1 << 28,
      });
      writeFileSync(join(out, `${i}.log`), `${run.command.join(' ')} ${filter.join(' ')}\n${r.stdout}\n${r.stderr}`);
      const read = judge(run, r.status, existsSync(report) ? (JSON.parse(readFileSync(report, 'utf8')) as Report) : undefined);
      wrong.push(...read.wrong);
      named.push(...read.named);
      for (const m of run.leaveOut) if (!read.named.some((n) => n.includes(m.what))) named.push(`${run.lane}: ${run.file}: no test carries ${m.id} (${m.what}); nothing was left out for it`);
    }
    console.log(`${AC1} on ${on}: left out, moved by the owner on 2026-11-08:\n  ${named.join('\n  ')}\nlogs and reports: ${out}`);
    if (wrong.length) throw Error(`${AC1} on ${on} with Claude Code, these kept parts didn't pass:\n  ${wrong.join('\n  ')}\nleft out:\n  ${named.join('\n  ')}`);
  }, 12 * HOUR);

  it(`${AC1} (wrong program) a lanes list that lost a kept part, or a filter that drops a kept test, fails naming it`, async () => {
    const lanes = await releaseLanes();
    const real = plan(lanes);
    expect(real.missing, `${AC1} scripts/lanes.mjs must run each kept part`).toEqual([]);
    for (const m of MOVED.filter((x) => !x.id)) expect(real.left.join('\n'), `${AC1} ${m.what} must be left out by name`).toContain(m.what);
    expect(real.runs.flatMap((r) => r.leaveOut.map((m) => m.what)).sort()).toEqual(MOVED.filter((m) => m.id).map((m) => m.what).sort());
    // A lane gone, and #27's suite gone from its lane: each read as missing, by name.
    expect(plan(lanes.filter((l) => l.name !== 'done gate checkpoint')).missing).toEqual(['done gate checkpoint running tests/acceptance/669/']);
    const no27 = lanes.map((l) => ({ ...l, commands: l.commands.filter((c) => !c.includes('tests/acceptance/27')) }));
    expect(plan(no27).missing).toEqual(['claude code adapter live running tests/acceptance/27/']);
    // The filter: #668's AC4 out, its AC1 in, as vitest matches a full name.
    const setup = real.runs.find((r) => r.lane === 'setup checkpoint')!;
    const pattern = new RegExp(namePattern(setup.leaveOut));
    expect(pattern.test('AC4 #668.3ee80c65 `deep doctor` exits 0 AC4 #668.3ee80c65 (live) after setup')).toBe(false);
    expect(pattern.test('AC1 #668.f5be25d4 After `deep setup` AC1 #668.f5be25d4 (live) the real session')).toBe(true);
    // The judge: a moved test that failed is named and doesn't count; a kept test dropped or failed fails, named.
    const t = (title: string, status: string, ancestorTitles: string[] = []): Assertion => ({ title, status, ancestorTitles, failureMessages: status === 'failed' ? ['boom'] : [] });
    const report = (...tests: Assertion[]): Report => ({ testResults: [{ name: setup.file, assertionResults: tests }] });
    const ok = judge(setup, 1, report(t('AC1 #668.f5be25d4 (live) x', 'passed'), t('AC4 #668.3ee80c65 (live) y', 'failed')));
    expect(ok.wrong).toEqual([]);
    expect(ok.named.join()).toContain("#668's AC4, moved to #1713");
    const dropped = judge(setup, 0, report(t('AC1 #668.f5be25d4 (live) x', 'passed'), t('AC5 #668.e1e1081d (live) z', 'skipped', ['AC4 #668.3ee80c65 nested'])));
    expect(dropped.wrong.join(), `${AC1} a kept test the filter skipped must fail, named`).toContain('AC5 #668.e1e1081d (live) z didn\'t run (skipped)');
    expect(judge(setup, 1, report(t('AC1 #668.f5be25d4 (live) x', 'failed'))).wrong.join()).toContain('AC1 #668.f5be25d4 (live) x failed');
    expect(judge(setup, 0, report(t('AC4 #668.3ee80c65 (live) y', 'skipped'))).wrong.join()).toContain('no kept test ran and passed');
  });
});

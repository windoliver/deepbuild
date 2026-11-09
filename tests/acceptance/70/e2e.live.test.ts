// AC1 #70.3a94aeb5, live: the R1 end-to-end suite passes on Ubuntu LTS and Fedora with Claude Code and Codex.
//
// By hand, in each VM, signed in there: it starts real sessions on your plan. It runs the suites that already exist;
// README: AC1 says which they are and why. Each suite must report tests run, none failed and none skipped, since a
// suite that ran nothing proves nothing. Without the opt-in, a sign-in or a binary it fails BLOCKED; nothing skips.
//   DEEP_HARNESS_LIVE=1 CLAUDE_CODE_OAUTH_TOKEN=<from `claude setup-token`> CODEX_API_KEY=<key> \
//     node node_modules/vitest/vitest.mjs run tests/acceptance/70/e2e.live.test.ts

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC1, REPO, distribution, requireLinux } from './helpers.ts';

const HOUR = 3_600_000;
/** The release preflight's live lanes (scripts/lanes.mjs), which start real Claude Code sessions. */
const CLAUDE_LANES = ['spine checkpoint', 'setup checkpoint', 'done gate checkpoint', 'risky calls checkpoint', 'spine exit', 'claude code adapter live'];

function requireLive(agent: string): void {
  if (process.env.DEEP_HARNESS_LIVE !== '1') throw Error(`${AC1} BLOCKED: this test starts real sessions on your plan; run it by hand with DEEP_HARNESS_LIVE=1, signed in, in each VM`);
  requireLinux();
  const version = spawnSync(agent, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  if (version.error || version.status !== 0) throw Error(`${AC1} BLOCKED: ${agent} isn't runnable on PATH: ${version.error?.message ?? `exit ${version.status}`}`);
}
function ran(command: string, args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync(command, args, { cwd: REPO, env: { ...process.env, DEEP_HARNESS_LIVE: '1' }, encoding: 'utf8', timeout: HOUR, maxBuffer: 1 << 28 });
  return { status: r.status, stdout: r.stdout };
}

describe(`${AC1} The R1 end-to-end suite passes on Ubuntu LTS and Fedora with Claude Code and Codex`, () => {
  it(`${AC1} (live) on this distribution, every live lane of the release preflight passes with real Claude Code sessions`, async () => {
    requireLive('claude');
    if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) throw Error(`${AC1} BLOCKED: the sessions run under temporary homes and sign in with CLAUDE_CODE_OAUTH_TOKEN (make one with \`claude setup-token\`)`);
    const on = distribution();
    const { releaseLanes } = (await import(join(REPO, 'scripts/lanes.mjs'))) as { releaseLanes: { name: string; commands: string[][] }[] };
    const lanes = releaseLanes.filter((l) => CLAUDE_LANES.includes(l.name));
    expect(lanes.map((l) => l.name), `${AC1} the release preflight must hold each live lane this test reads`).toEqual(CLAUDE_LANES);
    const out = mkdtempSync('/tmp/dh70-');
    const wrong: string[] = [];
    for (const [i, command] of lanes.flatMap((l) => l.commands.map((c) => [l.name, c] as const)).entries()) {
      const [name, words] = command;
      const file = join(out, `${i}.json`);
      const r = ran(words[0]!, [...words.slice(1), '--reporter=json', `--outputFile=${file}`]);
      const report = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as { numTotalTests: number; numPassedTests: number; numFailedTests: number; numPendingTests: number } : undefined;
      if (r.status !== 0 || !report?.numPassedTests || report.numFailedTests || report.numPendingTests) wrong.push(`${name} (${words.at(-1)}): exit ${r.status}, ${JSON.stringify(report ?? 'no report')}`);
    }
    if (wrong.length) throw Error(`${AC1} on ${on} with Claude Code, these lanes didn't pass: ${wrong.join('; ')}`);
  }, 12 * HOUR);

  it(`${AC1} (live) on this distribution, #48's live sessions with real Codex pass`, () => {
    requireLive('codex');
    if (!process.env.CODEX_API_KEY && !existsSync(join(homedir(), '.codex', 'auth.json'))) throw Error(`${AC1} BLOCKED: the Codex sessions need CODEX_API_KEY or ~/.codex/auth.json`);
    const on = distribution();
    const r = ran(realpathSync(process.execPath), ['--test', '--test-concurrency=1', '--test-reporter=tap', '--test-name-pattern=[Cc]odex', 'tests/acceptance/48/harness.live.test.mjs']);
    const count = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(r.stdout)?.[1] ?? -1);
    expect({ exit: r.status, fail: count('fail'), skipped: count('skipped'), passed: count('pass') > 0 }, `${AC1} on ${on} with Codex: the live sessions must run, and pass, none skipped: ${r.stdout.slice(-2000)}`).toEqual({ exit: 0, fail: 0, skipped: 0, passed: true });
  }, 2 * HOUR);
});

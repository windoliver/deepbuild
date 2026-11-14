// #2417: `node scripts/spine.mjs judge` on a task whose issue it can't read. The real CLI runs with a `gh` stub first
// on PATH that fails every call and logs its argv, so the issue is unreadable and nothing is ever written to GitHub.
// README: the criteria, the readings and the base run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const spine = fileURLToPath(new URL('../../../scripts/spine.mjs', import.meta.url));

/** `spine.mjs judge` over the issues, with a gh that exits 1 for every call: what it printed, and what it asked of gh. */
function judgeSignedOut(issues) {
  const dir = mkdtempSync(join(tmpdir(), 'deep-2417-'));
  try {
    const log = join(dir, 'gh.log');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'gh'), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nprocess.exit(1);\n`);
    chmodSync(join(dir, 'bin', 'gh'), 0o755);
    // PATH holds the stub and the system folders git lives in, nothing of the user's: no other gh can answer.
    const env = { ...process.env, PATH: `${join(dir, 'bin')}:/usr/bin:/bin` };
    for (const name of ['DEEP_PROOF_ISSUES', 'GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'NODE_OPTIONS']) delete env[name];
    const seen = spawnSync('gh', ['--version'], { env, encoding: 'utf8' });
    assert.equal(seen.status, 1, 'harness: `gh` on the child\'s PATH is not the failing stub');
    const r = spawnSync(process.execPath, [spine, 'judge', ...issues.flatMap((n) => ['--issue', String(n)])], { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
    const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((line) => JSON.parse(line)).slice(1) : [];
    const said = `exit ${r.status}${r.signal ? ` (${r.signal})` : ''}\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}\ngh calls: ${JSON.stringify(calls.map((c) => c.slice(0, 3)))}`;
    assert.equal(r.error, undefined, `harness: the CLI didn't run to its end: ${r.error}`);
    assert.ok(calls.length, `harness: the CLI never asked the stub for an issue, so none was unreadable\n${said}`);
    const lines = r.stdout.split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { unparsed: line }; } });
    return { status: r.status, signal: r.signal, stderr: r.stderr, lines, said };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** No crash: no TypeError, no stack trace, no signal. */
function ranToItsEnd(r) {
  assert.doesNotMatch(r.stderr, /TypeError/, `the run stopped with a TypeError\n${r.said}`);
  assert.doesNotMatch(r.stderr, /^\s+at .+:\d+:\d+\)?$/m, `the run stopped with an uncaught error\n${r.said}`);
  assert.equal(r.signal, null, r.said);
}

/** The task's JSON line: its issue, verdict BLOCKED and a why that says something. */
function blockedLine(line, issue, said) {
  assert.equal(line?.issue, issue, `no JSON line for #${issue}\n${said}`);
  assert.equal(line.verdict, 'BLOCKED', `#${issue} is unreadable, so it reads BLOCKED\n${said}`);
  assert.ok(typeof line.why === 'string' && line.why.trim().length > 0, `#${issue}'s line carries no why\n${said}`);
}

test('#2417.47b7983a AC1: judge prints a task whose issue is unreadable as its JSON line, verdict BLOCKED with its why, and never stops with a TypeError', () => {
  const r = judgeSignedOut([44]);
  ranToItsEnd(r);
  assert.equal(r.lines.length, 1, `one task judged, one line on stdout\n${r.said}`);
  blockedLine(r.lines[0], 44, r.said);
});

test('#2417.a410064f AC2: after such a task the run goes on to judge the next one, and the run exits non-zero', () => {
  const r = judgeSignedOut([44, 47]);
  ranToItsEnd(r);
  assert.deepEqual(r.lines.map((line) => line.issue), [44, 47], `a line for #44, then one for #47\n${r.said}`);
  blockedLine(r.lines[0], 44, r.said);
  blockedLine(r.lines[1], 47, r.said);
  // Not every task is PASS, so the CLI's own exit 1 (its header); ranToItsEnd rules out node's exit 1 for a crash.
  assert.equal(r.status, 1, `the run exits 1 when a task isn't PASS\n${r.said}`);
});

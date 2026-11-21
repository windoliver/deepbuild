// #2569.97a55309: on a reference Mac left alone, #1477's three test files pass on main, or each failing test has its
// cause named. This runs the issue's own command in this checkout, `node scripts/affected.mjs --timed` on the three
// files, and reads what it prints: every test of the three files either passed, or is printed KNOWN with the cause
// scripts/known-failures.json names for it. A NEW FAIL is a failing test with no cause named. A test the run leaves
// INCONCLUSIVE or BLOCKED, a machine off the reference Macs, or a load above the core count at the run's start or end,
// reads INCONCLUSIVE here, never a pass. The run has a deadline and is stopped by its PID past it; a `lists_1477`
// process it leaves behind is stopped by its PID and fails the test. Off macOS it fails with a message starting
// `INCONCLUSIVE:`.
import { spawn } from 'node:child_process';
import { closeSync, openSync, readFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC3, GRACE_S, REPO, descendants, holds, inconclusive, laneProblem, leftAfter, processTable, requireMac, shown, sleep,
  stop, useDir, type JsonObject, type Proc,
} from './helpers.ts';

// #1477's three test files, as the issue's command names them. Their paths are joined here from their parts, and no
// string in this file holds one whole: scripts/affected.mjs selects every test file whose strings name a changed path,
// and the run below names these three as its change, so a whole path here would have that run start this file again.
const FOLDER = ['tests', 'acceptance', '1477'].join('/');
const FILES = ['built.test.ts', 'record.test.ts', 'redraft/record.test.ts'].map((file) => `${FOLDER}/${file}`);
const BASELINE = 'scripts/known-failures.json';
/** The run's deadline: the three files take about a quarter of an hour after their builds (their READMEs), more with the twins' builds. */
const RUN_MIN = 90;

const dir = useDir();

interface Row { state: string; rest: string }
interface Run { output: string; code: number | null; signal: string | null; timedOut: boolean; left: Proc[]; load: { start: number; end: number } }

/** `node scripts/affected.mjs --timed <the three files>` in this checkout, its output, and the benches it left. */
async function affected(): Promise<Run> {
  const log = join(dir(), 'affected.log');
  const fd = openSync(log, 'w');
  // The run queues and reports on its own: nothing of the vitest run this test is in reaches it.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:VITEST|DEEP_PROOF_VITEST_REPORT$|DEEP_BIN_DIR$|DEEP_AFFECTED_HELD$)/.test(key)));
  const start = loadavg()[0]!;
  const child = spawn(process.execPath, ['scripts/affected.mjs', '--timed', ...FILES], { cwd: REPO, stdio: ['ignore', fd, fd], env });
  const at: { exit: { code: number | null; signal: string | null } | null } = { exit: null };
  child.on('exit', (code, signal) => { at.exit = { code, signal }; });
  child.on('error', () => { at.exit ??= { code: null, signal: null }; });
  const ended = (): boolean => at.exit !== null;
  // Every process the run starts, as the process table shows them while it runs.
  const seen = new Map<string, Proc>();
  const look = (): void => { for (const p of descendants(processTable(), child.pid ?? -1)) seen.set(`${p.pid} ${p.started}`, p); };
  const deadline = performance.now() + RUN_MIN * 60_000;
  let timedOut = false;
  try {
    while (!ended() && performance.now() < deadline) { look(); await sleep(2000); }
    if (!ended()) {
      timedOut = true;
      // Its own stop: a SIGTERM to its PID, which it passes to its jobs.
      child.kill('SIGTERM');
      for (let i = 0; i < 60 && !ended(); i++) { look(); await sleep(1000); }
    }
    const end = loadavg()[0]!;
    const benches = [...seen.values()].filter((p) => /(?:^|\/)lists_1477[\w-]*(?:\s|$)/.test(p.command));
    const left = await leftAfter(benches, GRACE_S * 1000);
    return { output: readFileSync(log, 'utf8'), code: at.exit?.code ?? null, signal: at.exit?.signal ?? null, timedOut, left, load: { start, end } };
  } finally {
    if (!ended()) child.kill('SIGKILL');
    // Whatever the run started and left is stopped, each by its PID.
    const table = processTable();
    await stop([...seen.values()].filter((p) => holds(table, p)));
    closeSync(fd);
  }
}

/** The lines of the run's output that speak of #1477's files or of the vitest job that ran them. */
function rowsOf(output: string): Row[] {
  const rows: Row[] = [];
  for (const line of output.split('\n')) {
    const m = /^(NEW FAIL|KNOWN|INCONCLUSIVE|BLOCKED|INVALID|LISTED) (.*)$/.exec(line);
    if (m && (m[2]!.startsWith(`${FOLDER}/`) || /^vitest\b/.test(m[2]!))) rows.push({ state: m[1]!, rest: m[2]! });
  }
  return rows;
}
/** What a known failure's entry says past `fails on main <commit>`: its cause. */
const causeOf = (message: string): string => message.replace(/^fails on main(?:\s+[0-9a-f]{7,40})?\s*[:.,;]?\s*/i, '').trim();

describe(`${AC3} on a reference Mac left alone, #1477's three test files pass on main, or each failing test has its cause named`, () => {
  it(`${AC3} \`node scripts/affected.mjs --timed\` on #1477's three files, in this checkout: every test of theirs passes, or is KNOWN with its cause named in ${BASELINE}; none is a NEW FAIL, and the run ends within ${RUN_MIN} min leaving no lists_1477 process`, async () => {
    requireMac();
    const lane = (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as { fingerprint(): JsonObject };
    const before = await laneProblem(lane.fingerprint(), { start: loadavg()[0]!, end: loadavg()[0]! });
    if (before) inconclusive(`this isn't a reference Mac left alone, so the run isn't started: ${before}`);
    const total = FILES.reduce((n, file) => n + (readFileSync(join(REPO, file), 'utf8').match(/^\s*it\(/gm) ?? []).length, 0);
    expect(total, `#1477's three files hold tests`).toBeGreaterThan(0);

    const run = await affected();
    const tail = run.output.split('\n').filter((line) => /^[A-Z]{2,}[A-Z ]* /.test(line)).slice(-40).join('\n');
    console.log(`node scripts/affected.mjs --timed ${FILES.join(' ')}: exit ${run.code ?? run.signal}, load ${run.load.start.toFixed(1)} at its start and ${run.load.end.toFixed(1)} at its end\n${tail}`);
    expect(run.timedOut, `the run ends within ${RUN_MIN} min; it was stopped by its PID. Its output ends:\n${run.output.slice(-3000)}`).toBe(false);
    expect(run.left.map((p) => `pid ${p.pid}: ${p.command}`), `${GRACE_S} s after the run ended, lists_1477 processes it started are still running (#2569.b4a750e6); they were stopped by PID: ${shown(run.left)}`).toEqual([]);
    const summary = /^(PASS|NO NEW FAILURES|FAIL|INCONCLUSIVE|BLOCKED|INVALID) affected: (\d+) new, (\d+) already failing on main, (\d+) inconclusive or blocked, (\d+) listed skips, (\d+) passed, in /m.exec(run.output);
    if (!summary) return expect.fail(`${/^BLOCKED /m.test(run.output) ? 'BLOCKED' : 'INCONCLUSIVE'}: the run printed no summary of its tests (exit ${run.code ?? run.signal}), so none of them is read; this is not a pass. Its output ends:\n${run.output.slice(-3000)}`);
    const after = await laneProblem(lane.fingerprint(), run.load);
    if (after) inconclusive(`the run wasn't on a reference Mac left alone: ${after}`);

    const rows = rowsOf(run.output);
    const fresh = rows.filter((row) => row.state === 'NEW FAIL');
    expect(fresh.map((row) => row.rest), `${fresh.length} of #1477's ${total} tests fail with no cause named (NEW FAIL: not in ${BASELINE})`).toEqual([]);
    const unsure = rows.filter((row) => row.state !== 'NEW FAIL' && row.state !== 'KNOWN');
    if (unsure.length) inconclusive(`the run left ${unsure.length} of #1477's results unjudged: ${unsure.map((row) => `${row.state} ${row.rest}`).join('\n')}`);

    const known = rows.filter((row) => row.state === 'KNOWN');
    const failures = (JSON.parse(readFileSync(join(REPO, BASELINE), 'utf8')) as { failures: Record<string, string> }).failures;
    for (const row of known) {
      const id = Object.keys(failures).filter((key) => row.rest === key || row.rest.startsWith(`${key}: `)).sort((a, b) => b.length - a.length)[0];
      expect(id, `the failing test \`${row.rest.slice(0, 300)}\` is in ${BASELINE}`).toBeDefined();
      expect(causeOf(failures[id!]!), `${BASELINE} names the cause of \`${id}\`, past "fails on main": ${JSON.stringify(failures[id!])}`).not.toBe('');
    }
    const passed = Number(summary[6]);
    expect(passed + known.length, `every one of #1477's ${total} tests passed (${passed}) or failed with its cause named (${known.length})`).toBe(total);
    console.log(`#1477's three files: ${passed} passed, ${known.length} failing with a named cause${known.map((row) => `\n  KNOWN ${row.rest}`).join('')}`);
  }, (RUN_MIN + 10) * 60_000);
});

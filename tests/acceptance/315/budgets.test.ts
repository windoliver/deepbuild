// #315 AC8 and AC9: deep-hook's numbers. Each timed call is first shown to be the call the issue means (the
// matcher ran and named its entries; a late hub's call was failed open and spooled marked late; the fail_closed
// entry denied), so a number never comes from a program that skipped the work. The overhead budget (AC2 and the
// "under 10 ms at p95" half of AC8) is budgets-overhead-redraft.test.ts (blind redraft, AC2-AC8-REDRAFT.md, #745). The numbers count only on a
// reference Mac (Mac15,7 or Mac15,12) on mains power, Low Power Mode off, no thermal warning, and are judged by the
// design's rule for timing results (five runs; PASS when all are within the limit, FAIL when all are over it by
// more than the margin, otherwise INCONCLUSIVE); anywhere else they are skipped as INCONCLUSIVE, never passed.
// The merge-base comparison is the perf lane's (scripts/benchmark.mjs, benchmarks/budgets.json), as #16's is.
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import {
  bash, buildDeepHook, childEnv, cleanup, decision, environmentProblem, forwarder, hook, hookTimed, hyperfinePath, jsonLines, judge, makeHome,
  MATCHED, newSession, NODE, p95, readSpool, REPO, run, setAddress, shown, startHub, stopHub, tempDir, writeRules, type Hub, type Session,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const problem = environmentProblem();
const TASKS = { 'deep-hook-overhead': 'overhead', 'deep-hook-fail-open': 'fail-open' } as const;

/** A home with rules.json, a running hub and one session: what every forwarded call below goes to. */
async function upHome(): Promise<{ home: string; hub: Hub; s: Session }> {
  const home = makeHome();
  writeRules(home);
  const hub = await startHub({ home });
  return { home, hub, s: newSession(home) };
}

/** The matcher ran: with the hub up, `ls` and `pkill -f node` go with the entries they match, by name. */
async function matcherRuns(binary: string): Promise<void> {
  const { home, hub, s } = await upHome();
  const f = await forwarder(tempDir(), hub.socket);
  setAddress(home, `unix:${f.path}`);
  for (const command of ['ls', 'pkill -f node']) await hook(home, s, 'PreToolUse', bash(s, command), { binary });
  await f.close();
  await stopHub(hub);
  const sent = jsonLines(f.upText()).filter((l) => l.event === 'PreToolUse');
  for (const command of ['ls', 'pkill -f node']) {
    const request = sent.find((l) => l.payload?.tool_input?.command === command);
    expect([...(request?.matched ?? [])].sort(), `with the hub up, the request for \`${command}\` names the entries it matched: ${JSON.stringify(request?.matched)}`).toEqual([...MATCHED[command]!].sort());
  }
}

/** A home whose hub is stopped with SIGSTOP: every call there fails open, late. */
async function lateHome(): Promise<{ home: string; hub: Hub; s: Session; resume(): Promise<void> }> {
  const { home, hub, s } = await upHome();
  process.kill(hub.pid, 'SIGSTOP');
  return { home, hub, s, resume: async () => { process.kill(hub.pid, 'SIGCONT'); await stopHub(hub); } };
}
/** The late hub's calls are failed open: `ls` allowed and spooled marked late, `pkill -f node` denied. */
function failsOpen(binary: string, late: { home: string; s: Session }): void {
  const ls = bash(late.s, 'ls');
  const allowed = hookTimed(late.home, late.s, 'PreToolUse', ls, { binary, timeoutMs: 10_000 });
  expect(decision(allowed), `with the hub stopped by SIGSTOP, \`ls\` is allowed: ${shown(allowed)}`).toBe('allow');
  const spooled = readSpool(late.home).requests.find((r) => r.json.payload?.tool_use_id === ls.tool_use_id);
  expect(spooled?.json.late, `the call is spooled marked late: ${JSON.stringify(spooled?.json).slice(0, 300)}`).toBe(true);
  const denied = hookTimed(late.home, late.s, 'PreToolUse', bash(late.s, 'pkill -f node'), { binary, timeoutMs: 10_000 });
  expect(decision(denied), `with the hub stopped by SIGSTOP, \`pkill -f node\` is denied: ${shown(denied)}`).toBe('deny');
}

describe('AC8 #315.515d4e08 budgets on the reference Mac in the local preflight, compared with the merge base', () => {
  it('AC8 the perf lane has deep-hook\'s two tasks, each a #315 first measurement, valid against the merge base\'s budgets', async () => {
    const { validateBudgets } = (await import(join(REPO, 'scripts/benchmark.mjs'))) as { validateBudgets(current: unknown, base: unknown): void };
    const current = JSON.parse(readFileSync(join(REPO, 'benchmarks/budgets.json'), 'utf8')) as { tasks: { id: string; command: string[]; initialReason: string }[] };
    const base = execFileSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' }).trim();
    validateBudgets(current, JSON.parse(execFileSync('git', ['show', `${base}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8' })));
    for (const [id, mode] of Object.entries(TASKS)) {
      const task = current.tasks.find((t) => t.id === id);
      expect(task, `budgets.json has a task ${id}`).toBeDefined();
      expect(task!.command, `${id} runs the deep-hook bench in ${mode} mode`).toEqual(['node', 'benchmarks/deep-hook.mjs', mode]);
      expect(String(task!.initialReason), `${id} says why, naming issue #315`).toMatch(/#315/);
    }
  });

  it.each(Object.values(TASKS))('AC8 `node benchmarks/deep-hook.mjs %s` runs and exits 0', async (mode) => {
    const r = await run(NODE, [join(REPO, 'benchmarks/deep-hook.mjs'), mode], { timeoutMs: 900_000 });
    expect(r.code, `benchmarks/deep-hook.mjs ${mode}: ${r.stderr.slice(-2000)}`).toBe(0);
  }, 900_000);

  it('AC8 under 50 ms to fail open: a PreToolUse against a hub stopped with SIGSTOP, from spawn to exit, p95 of 50 calls', async (ctx: TestContext) => {
    const binary = await buildDeepHook({ release: true });
    const first = await lateHome();
    try {
      failsOpen(binary, first);
    } finally {
      await first.resume();
    }
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const runs: number[] = [];
    // A fresh stopped hub for each run: connections a stopped hub never accepts fill its listen queue, and past that
    // a connect is refused at once, which would time the hub-not-there path instead of the late one.
    for (let i = 0; i < 5; i++) {
      const late = await lateHome();
      try {
        const samples: number[] = [];
        for (let k = 0; k < 50; k++) samples.push(hookTimed(late.home, late.s, 'PreToolUse', bash(late.s, 'ls'), { binary, timeoutMs: 10_000 }).ms);
        runs.push(p95(samples));
      } finally {
        await late.resume();
      }
    }
    judge(ctx, 'AC8 fail open p95 (ms)', runs, 50);
  }, 900_000);

  it('AC8 peak memory under 10 MB forwarding, failing open and failing closed, and a release binary under 3 MB', async (ctx: TestContext) => {
    const binary = await buildDeepHook({ release: true });
    await matcherRuns(binary);
    const late = await lateHome();
    try {
      failsOpen(binary, late);
    } finally {
      await late.resume();
    }
    if (problem) ctx.skip(`INCONCLUSIVE (reading only): ${problem}`);
    const peak = (home: string, s: Session, command: string): number => {
      const r = spawnSync('/usr/bin/time', ['-l', binary, 'claude-code', 'PreToolUse'], { cwd: s.cwd, env: childEnv(home), input: JSON.stringify(bash(s, command)), encoding: 'utf8' });
      const bytes = Number(/(\d+)\s+maximum resident set size/.exec(r.stderr)?.[1]);
      if (!Number.isFinite(bytes) || bytes <= 0) throw Error(`BLOCKED: no peak RSS from /usr/bin/time -l: ${r.stderr}`);
      return bytes / 1e6;
    };
    const runs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const up = await upHome();
      const stopped = await lateHome();
      try {
        runs.push(Math.max(peak(up.home, up.s, 'ls'), peak(stopped.home, stopped.s, 'ls'), peak(stopped.home, stopped.s, 'pkill -f node')));
      } finally {
        await stopHub(up.hub);
        await stopped.resume();
      }
    }
    judge(ctx, 'AC8 peak memory (MB)', runs, 10);
    const size = statSync(binary).size;
    expect(size, `the release binary ${binary} is ${size} bytes, under 3 MB (3,000,000 bytes)`).toBeLessThan(3_000_000);
  }, 900_000);
});

/** Option names of hyperfine that take a value (hyperfine 1.x), so the commands left are its positional arguments. */
const VALUED = new Set(['-r', '--runs', '-m', '--min-runs', '-M', '--max-runs', '-w', '--warmup', '-p', '--prepare', '-c', '--cleanup', '-s', '--setup', '-S', '--shell', '--export-json', '--export-csv', '--export-markdown', '--export-asciidoc', '--export-orgmode', '-n', '--command-name', '--input', '--output', '--style', '-u', '--time-unit', '-L', '--parameter-list', '-P', '--parameter-scan', '-D', '--parameter-step-size', '--sort', '--reference', '--conclude']);
function commandsOf(argv: string[]): string[] {
  const commands: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--reference' || a.startsWith('--reference=')) { commands.push(a.includes('=') ? a.slice(a.indexOf('=') + 1) : argv[++i] ?? ''); continue; }
    if (a.startsWith('-')) { if (VALUED.has(a)) i++; if (a === '-P' || a === '--parameter-scan') i += 2; continue; }
    commands.push(a);
  }
  return commands;
}
const isNative = (path: string): boolean => {
  try {
    const head = readFileSync(path).subarray(0, 4);
    return [0xcffaedfe, 0xcefaedfe, 0xcafebabe, 0x7f454c46].includes(head.readUInt32BE(0));
  } catch {
    return false;
  }
};
const resolveCommand = (word: string): string => (word.includes('/') ? word : spawnSync('/bin/sh', ['-c', `command -v ${word}`], { encoding: 'utf8' }).stdout.trim());

describe('AC9 #315.23cd76ed overhead is measured with hyperfine against a native no-op binary as the floor', () => {
  it('AC9 `node benchmarks/deep-hook.mjs overhead` runs hyperfine, timing deep-hook beside a native binary that does nothing', async (ctx: TestContext) => {
    const bench = join(REPO, 'benchmarks/deep-hook.mjs');
    expect(existsSync(bench), 'the overhead bench benchmarks/deep-hook.mjs exists').toBe(true);
    const real = hyperfinePath();
    if (!real) ctx.skip('INCONCLUSIVE: hyperfine is not installed, so the bench can\'t be run');
    // A hyperfine of our own first on PATH: it writes down the arguments it was given, then runs the real one.
    const bin = join(tempDir(), 'bin');
    mkdirSync(bin);
    const log = join(bin, 'argv.log');
    writeFileSync(join(bin, 'hyperfine'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done >> '${log}'\nprintf '\\n' >> '${log}'\nexec '${real}' "$@"\n`);
    chmodSync(join(bin, 'hyperfine'), 0o755);
    const r = await run(NODE, [bench, 'overhead'], { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` }, timeoutMs: 900_000 });
    expect(r.code, `benchmarks/deep-hook.mjs overhead: ${r.stderr.slice(-2000)}`).toBe(0);
    expect(existsSync(log), 'the bench ran hyperfine').toBe(true);
    const invocations = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\0').filter((a) => a.length));
    const fits = invocations.some((argv) => {
      const commands = commandsOf(argv);
      const words = commands.map((c) => c.trim().split(/\s+/)[0] ?? '');
      const timesDeepHook = commands.some((c) => /deep-hook/.test(c));
      const floor = words.map(resolveCommand).find((p) => p && !/deep-hook/.test(p) && isNative(p) && (() => {
        const done = spawnSync(p, [], { encoding: 'utf8', input: '', timeout: 5000 });
        return done.status === 0 && done.stdout === '' && done.stderr === '';
      })());
      return timesDeepHook && floor !== undefined;
    });
    expect(fits, `hyperfine timed deep-hook beside a native no-op binary; it was run with ${JSON.stringify(invocations)}`).toBe(true);
  }, 900_000);
});

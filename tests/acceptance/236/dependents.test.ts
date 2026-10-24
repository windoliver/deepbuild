// The halves of #236's criteria whose surface another issue builds: AC4's read-only job run by the runner (#159),
// and AC13's command check (#30), an environment's stack (#36, built by #331) and a check kind that spawns a child
// itself. Each reaches its issue's published surface: `@deepbuild/runner`'s `openRunner`, `@deepbuild/checks-command`'s
// `runCommandCheck` and `commandCheckKind`, and the hub's `deep env up|down` with `DEEP_HUB_TEST_HOST` (README, What
// depends on other issues). The halves the supervisor owns are tested in contain.test.ts, hub.test.ts and host.test.ts.
//
// "Every start" is read from outside the host: while the work runs, the test lists every process whose command line
// carries the scenario's own marker and requires each one's process group to be one the recording host's log shows
// a start for (the supervisor gives each started process its own group, which its children keep). A process spawned
// around the host shows up there in a group no start names, and the failure names the check kind or the stack.
import { execFile, execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, type TestContext } from 'vitest';
import type { CheckRunnerFill, CheckSpec } from '../../../packages/conformance/src/index.ts';
import { openLedger } from '../../../packages/budget/src/index.ts';
import { commandCheckKind, runCommandCheck } from '../../../packages/checks-command/src/index.ts';
import { openRunner } from '../../../packages/runner/src/index.ts';
import type { Host } from '../../../packages/supervisor/src/index.ts';
import {
  CLI, childEnv, cleanup, closeListeners, DAY, home, NODE, REPO, runId, sleep, startHub, stopHub, sub, tempDir, ulid, waitFor, type Line,
} from './helpers.ts';
import { dataOf, openWorld } from './world.ts';

afterEach(async () => { await closeListeners(); await cleanup(); }, 30_000);

/** Seatbelt is the backend under test: elsewhere these are a reading of nothing, never a pass. */
function macOnly(ctx: TestContext): void {
  if (process.platform !== 'darwin') ctx.skip(`INCONCLUSIVE: Seatbelt, the backend under test, is macOS only; this is ${process.platform}`);
}

// ---- AC4: the runner (#159) and a stand-in for Claude Code.

/** Claude Code's stand-in: #159's fake CLI (tests/acceptance/159/fixtures/fake-claude.pl), which starts the stdio MCP
 *  servers its --mcp-config names in the job's folder, as Claude Code does. It is the boundary DeepBuild doesn't own. */
function installFakeClaude(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const facts = JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] };
  const text = readFileSync(join(REPO, 'tests/acceptance/159/fixtures/fake-claude.pl'), 'utf8')
    .replace("'__VERSION__'", `'${facts.versions[facts.versions.length - 1]!}'`)
    .replace('__SLOW__', '0').replace('__EVIL__', '0').replace('__STARTUP__', '0');
  const path = join(dir, 'claude');
  writeFileSync(path, text, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}
/** A made-up Claude Code sign-in under the test's HOME: no real account, no real token. */
function fakeSignIn(): string {
  const h = home();
  const account = '0a0a0a0a-2360-4236-8236-000000000236';
  mkdirSync(join(h, '.claude'), { recursive: true });
  writeFileSync(join(h, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: account, emailAddress: 'dh236@example.invalid', organizationUuid: 'org-dh236' }, mcpServers: {}, projects: {} })}\n`);
  writeFileSync(join(h, '.claude', '.credentials.json'), `${JSON.stringify({ claudeAiOauth: { accessToken: `sk-ant-oat01-dh236FAKE${'x'.repeat(40)}`, refreshToken: `sk-ant-ort01-dh236FAKE${'y'.repeat(40)}`, expiresAt: 4102444800000, scopes: ['user:inference'], subscriptionType: 'max' } })}\n`, { mode: 0o600 });
  if (!existsSync(join(h, '.claude', 'settings.json'))) writeFileSync(join(h, '.claude', 'settings.json'), '{}\n');
  return account;
}

describe('AC4 #236.cc0de139 a read-only job\'s undeclared write is refused by the sandbox, and recorded', () => {
  it('AC4 a read-only job run by the runner (#159) whose extension or MCP server writes outside what it declared is refused by the sandbox and the refusal recorded', async (ctx) => {
    macOnly(ctx);
    const bin = installFakeClaude(sub(tempDir(), 'bin'));
    const account = fakeSignIn();
    const outside = sub(tempDir(), 'outside');
    const w = await openWorld();
    const ledger = await openLedger({ record: w.record, asks: w.asks, now: w.clock.now, price: async () => 0.5 });
    const runner = await openRunner({
      record: w.record, asks: w.asks, supervisor: w.sup, ledger, now: w.clock.now, root: sub(w.dir, 'root'),
      loginPath: `${join(bin, '..')}:/usr/bin:/bin`, env: { HOME: home(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8' },
      settings: { plan: { reserve_pct: 10 }, asks: { unblock: { deadline_ms: 2 * DAY } } },
    });
    try {
      // A plan window with room, so the job starts now.
      const resets = Math.floor((w.clock.now() + 3 * 3_600_000) / 1000);
      await runner.report({ agent: 'claude-code', account, rate_limits: { five_hour: { used_percentage: 5, resets_at: resets }, seven_day: { used_percentage: 20, resets_at: resets + 5 * 86_400 } } });
      // The MCP server writes into the job's own folder and into a folder nobody declared; the job declares no write.
      const elsewhere = join(outside, 'notes.md');
      const server = { command: '/bin/sh', args: ['-c', `echo written > notes.md; echo written > ${elsewhere}`] };
      const rec = await runner.run({ kind: 'read', agent: 'claude-code', prompt: 'Read the notes.', deadline_ms: 120_000, mcp: { notes: server } });
      expect(rec.state, `BLOCKED: the read-only job didn't run, so its MCP server never tried the write: ${JSON.stringify(rec)}`).toBe('finished');
      for (const target of [join(rec.folder, 'notes.md'), elsewhere]) {
        expect(existsSync(target), `the MCP server's write of ${target} went through`).toBe(false);
        const denial = await waitFor(async () => (await w.events('sandbox.denied')).find((e) => dataOf(e).run === rec.job && dataOf(e).target === target), 15_000,
          `a sandbox.denied event naming the job's run ${rec.job} and ${target}`);
        expect(String(dataOf(denial).operation), `the refusal of ${target} names a write`).toMatch(/write/);
      }
    } finally {
      await runner.close();
      await w.close();
    }
  }, 120_000);
});

// ---- AC13: a recording host in place of `local`, and a watch on the process table.

interface HostCall { call: 'start' | 'signal' | 'wait'; run: string; signal?: string; pid?: number; pgid?: number; status?: string }
/** A host@1 that logs every start, signal and wait (and what a start returned), then hands it on to `local`. */
function recording(local: Host): { host: Host; calls: HostCall[] } {
  const calls: HostCall[] = [];
  const host: Host = {
    name: local.name,
    async start(spec) {
      const entry: HostCall = { call: 'start', run: spec.run };
      calls.push(entry);
      const started = await local.start(spec);
      if (started.status === 'started') Object.assign(entry, { pid: started.pid, pgid: started.pgid, status: started.status });
      return started;
    },
    async signal(run, signal) { calls.push({ call: 'signal', run, signal }); return local.signal(run, signal); },
    async wait(run) { calls.push({ call: 'wait', run }); return local.wait(run); },
    facts: () => local.facts(),
  };
  return { host, calls };
}
/** The same host@1, as a module the hub loads through DEEP_HUB_TEST_HOST: it appends each call to `log`. */
function recordingModule(dir: string): { module: string; log: string } {
  const module = join(dir, 'recording-host.mjs');
  const log = join(dir, 'host.log');
  writeFileSync(module, `import { appendFileSync } from 'node:fs';
const log = (entry) => appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');
export default function recording(local) {
  return {
    name: local.name,
    async start(spec) {
      log({ call: 'start', run: spec.run });
      const started = await local.start(spec);
      if (started.status === 'started') log({ call: 'started', run: spec.run, pid: started.pid, pgid: started.pgid });
      return started;
    },
    async signal(run, signal) { log({ call: 'signal', run, signal }); return local.signal(run, signal); },
    async wait(run) { log({ call: 'wait', run }); return local.wait(run); },
    facts: () => local.facts(),
  };
}
`);
  writeFileSync(log, '');
  return { module, log };
}
const logOf = (file: string): Line[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Line);

/** Every running process whose command line holds `marker`: its PID, group and command, as `ps` lists them. */
function marked(marker: string): { pid: number; pgid: number; command: string }[] {
  const out = execFileSync('/bin/ps', ['-A', '-ww', '-o', 'pid=,pgid=,command='], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  return out.split('\n').filter((l) => l.includes(marker)).map((l) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)!;
    return { pid: Number(m[1]), pgid: Number(m[2]), command: m[3]! };
  }).filter((p) => p.pid !== process.pid);
}
/** Watches the process table until stopped, collecting every marked process it sees. */
function watch(marker: string): { stop(): Promise<Map<number, { pgid: number; command: string }>> } {
  const seen = new Map<number, { pgid: number; command: string }>();
  let on = true;
  const loop = (async () => {
    while (on) {
      for (const p of marked(marker)) if (!seen.has(p.pid)) seen.set(p.pid, { pgid: p.pgid, command: p.command });
      await sleep(25);
    }
  })();
  return { stop: async () => { on = false; await loop; return seen; } };
}
/** Fails naming `who` when a marked process ran in a group no start in the host's log names. */
function everyStartLogged(who: string, seen: Map<number, { pgid: number; command: string }>, startedGroups: number[]): void {
  if (seen.size === 0) throw Error(`BLOCKED: no process of ${who} was seen running, so there is nothing to hold to the host's log`);
  for (const [pid, p] of seen) {
    if (!startedGroups.includes(p.pgid)) {
      throw Error(`${who} started a process the host's log doesn't show: PID ${pid} in group ${p.pgid} (${p.command.slice(0, 200)}); the log's starts are groups ${JSON.stringify(startedGroups)}`);
    }
  }
}

/** A checkout whose suite is one node:test file that passes after 1.5 s; the file's name carries the marker. Its console
 *  report (which prints durations) goes to /dev/null, so two runs print the same bytes and their digests can be
 *  compared; the kind reads the tests that ran from node:test's own report, which the redirect doesn't touch. */
function checkout(marker: string): { dir: string; spec: CheckSpec } {
  const dir = sub(tempDir(), 'checkout');
  writeFileSync(join(dir, `${marker}.test.mjs`), `import test from 'node:test';
import assert from 'node:assert/strict';
test('adds', async () => { await new Promise((r) => setTimeout(r, 1500)); assert.equal(1 + 1, 2); });
`);
  return { dir, spec: { kind: 'command', runner: `node --test ${marker}.test.mjs > /dev/null`, inputs: [], depth: 'unit', oracle: 'code', contract: null } };
}

/** Runs the fill `kind` (built on `host`) on a fresh checkout, holding every process it ran to the host's log. */
async function kindThroughHost(make: (host: Host) => CheckRunnerFill): Promise<void> {
  const w = await openWorld();
  try {
    const rec = recording(w.sup);
    const kind = make(rec.host);
    const marker = `dh236mark${ulid().toLowerCase()}`;
    const c = checkout(marker);
    const seen = watch(marker);
    const result = await kind.run(c.spec, { checkout: c.dir, deadline: 60_000, now: () => Date.now() });
    const processes = await seen.stop();
    expect(result.outcome, `BLOCKED: the check kind ${kind.kind} didn't run its suite: ${JSON.stringify(result)}`).toBe('passed');
    everyStartLogged(`the check kind ${kind.kind}`, processes, rec.calls.filter((c) => c.call === 'start' && c.pgid).map((c) => c.pgid!));
  } finally {
    await w.close();
  }
}

/** A planted check kind: the command kind, except that it first runs the check's command itself, around the host. */
function spawnsItself(host: Host): CheckRunnerFill {
  const base = commandCheckKind(host);
  return {
    ...base,
    kind: 'command-spawns-itself',
    run: async (spec, ctx) => {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/bin/sh', ['-c', spec.runner], { cwd: ctx.checkout, env: { PATH: `${join(NODE, '..')}:/usr/bin:/bin`, HOME: home() }, stdio: 'ignore' });
        child.once('error', reject);
        child.once('exit', () => resolve());
      });
      return base.run(spec, ctx);
    },
  };
}

describe('AC13 #236.6e7cc737 checks and environments start, signal and wait only through host@1', () => {
  it('AC13 a command check\'s run (#30), with a recording test host in place of local, shows every start, signal and wait, and its verdict and evidence equal those on local', async (ctx) => {
    macOnly(ctx);
    const w = await openWorld();
    try {
      const run = async (host: Host, marker: string) => {
        const c = checkout(marker);
        const seen = watch(marker);
        const r = await runCommandCheck({ host, run: runId(), spec: c.spec, checkout: c.dir, deadline: 60_000 });
        return { r, seen: await seen.stop() };
      };
      // The marker is the test file's name, so it must be the same on both for the outputs to compare.
      const marker = `dh236mark${ulid().toLowerCase()}`;
      const onLocal = await run(w.sup, marker);
      const rec = recording(w.sup);
      const onHost = await run(rec.host, marker);
      expect(onLocal.r.outcome, `BLOCKED: the command check didn't pass on local: ${JSON.stringify(onLocal.r)}`).toBe('passed');
      const calls = rec.calls.filter((c) => c.run === onHost.r.run).map((c) => c.call);
      expect(calls, 'the command check\'s run started its process through the host').toContain('start');
      expect(calls, 'the command check\'s run waited for its process through the host').toContain('wait');
      expect(rec.calls.filter((c) => c.run !== onHost.r.run), 'host calls for a run other than the check\'s').toEqual([]);
      everyStartLogged('the command check kind', onHost.seen, rec.calls.filter((c) => c.call === 'start' && c.pgid).map((c) => c.pgid!));
      const verdict = (x: typeof onLocal.r) => ({
        outcome: x.outcome, testsRun: x.testsRun, failures: x.failures, evidence: x.evidence, exit: x.exit, digests: x.output.sha256, attempts: x.attempts,
      });
      expect(verdict(onHost.r), 'the verdict and evidence on the recording host equal those on local').toEqual(verdict(onLocal.r));
    } finally {
      await w.close();
    }
  }, 120_000);

  it('AC13 an environment\'s stack (#36), with a recording test host in place of local, shows every start, signal and wait in its log', async (ctx) => {
    macOnly(ctx);
    const dir = tempDir();
    const host = recordingModule(dir);
    const root = sub(dir, 'root');
    const hub = await startHub(root, { DEEP_HUB_TEST_HOST: host.module });
    const marker = `dh236mark${ulid().toLowerCase()}`;
    const folder = sub(dir, 'app');
    // The repo's dev script: a server that answers 200 on its leased port, in a file whose name carries the marker.
    writeFileSync(join(folder, `${marker}.pl`), `use IO::Socket::INET;
my $s = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $ENV{PORT}, Listen => 5, ReuseAddr => 1) or die "listen: $!";
while (my $c = $s->accept) { my $req = <$c>; print $c "HTTP/1.0 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok"; close $c; }
`);
    sub(folder, '.deepbuild');
    writeFileSync(join(folder, '.deepbuild', 'done.yaml'), `environment:\n  up: exec /usr/bin/perl ${marker}.pl\n  ports: [PORT]\n  ready:\n    http: http://127.0.0.1:\${PORT}/\n    within: 30\n`);
    const deep = (verb: string) => new Promise<Line>((resolve, reject) => {
      execFile(NODE, [CLI, 'env', verb, '--root', root, '--json'], { cwd: folder, env: childEnv(), timeout: 60_000 }, (error, stdout, stderr) => {
        try { resolve(JSON.parse(stdout.trim().split('\n').pop()!) as Line); } catch { reject(Error(`BLOCKED: deep env ${verb} printed no JSON (${String(error)}): ${stdout}${stderr}`)); }
      });
    });
    try {
      const up = await deep('up');
      const run = (up.run ?? up.environment?.run) as string | undefined;
      expect(run, `BLOCKED: deep env up named no run: ${JSON.stringify(up)}`).toMatch(/^run:/);
      const stack = await waitFor(() => { const m = marked(marker); return m.length ? m : undefined; }, 10_000, `the stack's ${marker}.pl process`);
      const starts = logOf(host.log).filter((l) => l.call === 'started' && l.run === run).map((l) => l.pgid as number);
      expect(logOf(host.log).some((l) => l.call === 'start' && l.run === run), `the stack's run ${run} started through the host`).toBe(true);
      everyStartLogged(`the environment's stack ${run}`, new Map(stack.map((p) => [p.pid, p])), starts);
      const down = await deep('down');
      const calls = logOf(host.log).filter((l) => l.run === run).map((l) => l.call as string);
      expect(calls, `deep env down signalled the stack ${run} through the host (${JSON.stringify(down)})`).toContain('signal');
      expect(calls, `the stack ${run} was waited for through the host`).toContain('wait');
      await waitFor(() => marked(marker).length === 0, 15_000, `the stack's processes to be gone after deep env down`);
    } finally {
      await stopHub(hub);
    }
  }, 120_000);

  it('AC13 (wrong program) a check kind that spawns a child process itself leaves a start out of the log and fails, naming the check kind', async (ctx) => {
    macOnly(ctx);
    // The scenario runs: the honest kind passes the same harness, so a harness that fails everything fails here.
    await kindThroughHost(commandCheckKind);
    await expect(kindThroughHost(spawnsItself)).rejects.toThrow(/the check kind command-spawns-itself started a process the host's log doesn't show/);
  }, 120_000);
});

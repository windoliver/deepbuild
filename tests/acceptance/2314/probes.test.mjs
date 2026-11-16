import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { openAsks } from '@deepbuild/asks';
import { openRecord } from '@deepbuild/record';
import { openExtensionHost, openTrust, packageDigest } from '@deepbuild/extension-host';
import { openSupervisor } from '@deepbuild/supervisor';

// Resolve public exports now; install-time registration defers loading them until a run.
const numbers = import.meta.resolve('@deepbuild/checks-numbers');
const work = import.meta.resolve('@deepbuild/checks-work');
const findings = import.meta.resolve('@deepbuild/conformance/findings');

async function events(record, after = 0) {
  const all = [];
  for (;;) {
    const page = await record.read({ after, limit: 1000 });
    all.push(...page);
    if (page.length < 1000) return all;
    after = page.at(-1).log_pos;
  }
}

// OS observation only, never process-name killing. lstart guards teardown against PID reuse.
function processes() {
  const ps = spawnSync('/bin/ps', ['-A', '-o', 'pid=,ppid=,pgid=,lstart=,args='], {
    encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' }, maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(ps.status, 0, `BLOCKED: cannot read the process table: ${ps.stderr}`);
  return ps.stdout.split('\n').flatMap(line => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/.exec(line);
    return m ? [{ pid: +m[1], ppid: +m[2], pgid: +m[3], start: m[4], args: m[5] }] : [];
  });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error; // Permission/observation errors never prove absence.
  }
}

function stopRecorded(processesStarted) {
  const current = processes();
  for (const owned of processesStarted) {
    if (!current.some(p => p.pid === owned.pid && p.start === owned.start)) continue;
    try { process.kill(owned.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

function assertLifecycle(log, checkout) {
  const tracked = log.filter(e => e.kind === 'process.tracked' && e.data.cwd === checkout);
  assert.ok(tracked.length > 0, 'AC1: the probe must record process.tracked through host@1');
  for (const start of tracked) {
    assert.equal(start.writer, 'core', 'ownership must be recorded by the real supervisor');
    assert.ok(log.some(end => end.kind === 'process.ended' && end.writer === 'core'
      && end.data.run === start.data.run && end.data.pid === start.data.pid && end.log_pos > start.log_pos),
    'AC1: each tracked probe process must have process.ended before runCheck resolves');
  }
  return tracked;
}

describe('issue #2314: check probes use the real host@1', { concurrency: false, timeout: 60_000 }, () => {
  let root, checkout, record, supervisor, host;

  before(async () => {
    assert.ok(['darwin', 'linux'].includes(process.platform), 'BLOCKED: a real platform sandbox is required');
    root = realpathSync(mkdtempSync(join(tmpdir(), 'deep-2314-')));
    checkout = join(root, 'checkout');
    const folder = join(root, 'extension');
    const home = join(root, 'home');
    for (const path of [checkout, folder, home]) mkdirSync(path);
    const db = new DatabaseSync(join(checkout, 'sample.db'));
    db.exec('CREATE TABLE counts (n INTEGER); INSERT INTO counts VALUES (7);');
    db.close();
    cpSync(new URL('./fixtures/detached-probe.mjs', import.meta.url), join(checkout, 'detached-probe.mjs'));

    // A release-listed adapter registers actual public fills, unchanged context included.
    // Lazy imports let real sandboxed conformance registration run without extra grants.
    writeFileSync(join(folder, 'index.ts'), `
      export default function(deep) {
        deep.registerCheck('ext.probes-2314.numbers', async (spec, ctx) =>
          (await import(${JSON.stringify(numbers)})).numbersFill().run(spec, ctx));
        deep.registerCheck('ext.probes-2314.data', async (spec, ctx) =>
          (await import(${JSON.stringify(work)})).workFill('data').run(spec, ctx));
        deep.registerCheck('ext.probes-2314.probe_cleanup', async (spec, ctx) =>
          (await import(${JSON.stringify(findings)})).runProbe(
            spec.probe, { marker: spec.marker }, ctx, { kind: 'probe-cleanup', file: spec.probe }));
      }
    `);
    const manifest = { id: 'acceptance/probes-2314', version: '1.0.0', digest: '', checks: ['ext.probes-2314.numbers', 'ext.probes-2314.data', 'ext.probes-2314.probe_cleanup'] };
    writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
    manifest.digest = packageDigest(folder);
    writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));

    record = await openRecord({ path: join(root, 'ledger.db'), now: Date.now });
    const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
    supervisor = await openSupervisor({ record, asks, now: Date.now,
      settings: { asks: { unblock: { deadline_ms: 60_000 } } } });
    host = await openExtensionHost({ record, asks, supervisor, home, now: Date.now,
      trust: await openTrust({ record, now: Date.now }),
      release: [{ id: manifest.id, version: manifest.version, digest: manifest.digest }] });
    await host.ready();
    const installed = await host.install({ from: folder, builtBy: null });
    const checked = await host.check(installed);
    assert.equal(checked.passed, true, `BLOCKED: extension conformance: ${checked.reasons.join('; ')}`);
    const loaded = await host.load(installed);
    assert.equal(loaded.status, 'loaded', `BLOCKED: extension load: ${JSON.stringify(loaded)}`);
    assert.equal(loaded.place, 'hub', 'the runners must receive the hub-bound check context');
  });

  after(async () => {
    try {
      await host?.close();
      // This record belongs solely to this test; no other run token is touched.
      if (record && supervisor) {
        const runs = new Set((await events(record)).filter(e => e.kind === 'process.tracked').map(e => e.data.run));
        for (const run of runs) await supervisor.cleanup(run);
      }
    } finally {
      await supervisor?.close();
      await record?.close();
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  for (const [kind, spec] of [
    ['numbers', { kind: 'numbers', runner: 'sqlite', numbers: [
      { where: 'fixture count', stated: '7', query: { database: 'sample.db', sql: 'SELECT n FROM counts' } },
    ], added: [] }],
    ['data', { kind: 'data', runner: 'sqlite', database: 'sample.db', query: 'SELECT n FROM counts', rows: [{ n: 7 }] }],
  ]) {
    it(`AC1: checks-${kind === 'data' ? 'work' : 'numbers'} records tracked and ended for its real probe`, async () => {
      const before = (await events(record)).at(-1)?.log_pos ?? 0;
      const result = await host.runCheck(`ext.probes-2314.${kind}`, spec, { checkout, deadline: 10_000 });
      assert.equal(result.outcome, 'passed', JSON.stringify(result));
      assert.equal(result.testsRun, 1, 'the real SQLite assertion ran');
      assert.deepEqual(result.failures, []);
      // Installation/conformance starts cannot satisfy these assertions.
      assertLifecycle(await events(record, before), checkout);
    });
  }

  it('AC2: a detached probe descendant is gone when the overran run resolves', { timeout: 30_000 }, async () => {
    const marker = `acceptance-2314-${randomUUID()}`;
    const probe = join(checkout, 'detached-probe.mjs');
    const before = (await events(record)).at(-1)?.log_pos ?? 0;
    const owned = [];
    const pending = host.runCheck('ext.probes-2314.probe_cleanup', { probe, marker }, { checkout, deadline: 4000 });
    // Observe the child immediately at resolution, before any record reads or teardown.
    let child;
    const observed = pending.then(result => ({ result, childAlive: child ? alive(child.pid) : null }));
    try {
      const until = Date.now() + 3000;
      while (!child && Date.now() < until) {
        const table = processes();
        child = table.find(p => p.args.endsWith(` ${marker}`));
        if (child) {
          owned.push(child);
          const parent = table.find(p => p.pid === child.ppid);
          assert.ok(parent?.args.includes(probe), 'the detached child really belongs to this probe');
          owned.push(parent);
          assert.equal(child.pgid, child.pid, 'detached:true made the child its own process-group leader');
          assert.notEqual(child.pgid, parent.pgid, 'the child escaped the probe process group');
          assert.equal(alive(child.pid), true, 'the child was running before the deadline');
        } else await sleep(20);
      }
      assert.ok(child, 'BLOCKED: the probe must start its detached child before the deadline');
      const { result, childAlive } = await observed;
      assert.equal(result.outcome, 'overran', JSON.stringify(result));
      assert.equal(childAlive, false, 'AC2: detached descendant must already be gone when runCheck resolves overran');
      const log = await events(record, before);
      const tracked = assertLifecycle(log, checkout);
      assert.ok(tracked.some(e => e.data.pid === child.pid), 'AC2: the supervisor tracked the escaped descendant');
    } finally {
      // Cleanup is deliberately after the liveness snapshot/assertion, never its cause.
      stopRecorded(owned);
      await observed;
    }
  });
});

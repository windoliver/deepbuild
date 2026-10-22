// The environment kit's down rule reads the process table for the run token. (The second invariant: what the kit
// can't see is BLOCKED, never a pass.) Two kit runs on the same fixture at once share no run token, so neither
// sees the other's processes.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanFills, runKit, slotKits } from '../index.js';
import type { EnvironmentFill, Handle } from './environment.js';

const kit = () => slotKits().find((k) => k.slot === 'environment@1')!;
const path = process.env.PATH;
afterEach(() => { process.env.PATH = path; });

describe('the environment kit and the process table', () => {
  it('reads BLOCKED, not PASS, when ps can\'t be run', async () => {
    const k = kit();
    const [fill] = cleanFills(k);
    process.env.PATH = '/nonexistent';
    const report = await runKit(k, fill!, { parts: ['fixed'] });
    expect(report.cases.map((c) => c.outcome)).toEqual(['BLOCKED', 'BLOCKED']);
    expect(report.cases[0]!.message).toMatch(/ps failed/);
  });

  it('reads BLOCKED, not PASS or FAIL, when lsof ends with 1 and an error, as it does when it found nothing', async () => {
    const k = kit();
    const [fill] = cleanFills(k);
    // An lsof that fails the way the real one does on an operational error: status 1 with a word on stderr.
    const dir = mkdtempSync(join(tmpdir(), 'deep-env-lsof-'));
    writeFileSync(join(dir, 'lsof'), '#!/bin/sh\necho "lsof: can\'t read the open files table" >&2\nexit 1\n');
    chmodSync(join(dir, 'lsof'), 0o755);
    process.env.PATH = `${dir}:/bin:/usr/bin:/usr/sbin`;
    try {
      const report = await runKit(k, fill!, { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['BLOCKED', 'listeners_unknown'], ['BLOCKED', 'listeners_unknown']]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never signals a process it did not start, however its command line is dressed', async () => {
    const k = kit();
    const [clean] = cleanFills(k) as EnvironmentFill[];
    const decoys: ChildProcess[] = [];
    // A fill whose down also starts a bystander carrying the run token and the kit's own script names.
    const dressed: EnvironmentFill = {
      ...clean!,
      up: (spec, lease) => {
        const decoy = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)', fileURLToPath(new URL('../../runtime/environment/server.mjs', import.meta.url)), fileURLToPath(new URL('../../runtime/environment/helper.mjs', import.meta.url)), lease.token], { stdio: 'ignore' });
        decoys.push(decoy);
        return clean!.up(spec, lease);
      },
    };
    try {
      const report = await runKit(k, dressed, { parts: ['fixed'] });
      // The bystander carries the token after down, so the fill is refused for leaving a process; and it still runs.
      expect(report.cases.map((c) => c.outcome)).toEqual(['FAIL', 'FAIL']);
      expect(report.cases[0]!.message).toMatch(/still carries the run token/);
      expect(decoys.map((d) => d.exitCode === null && d.signalCode === null)).toEqual([true, true]);
    } finally {
      for (const d of decoys) d.kill('SIGKILL');
    }
  });

  it('refuses a handle whose pid is no process of the environment, so "gone after down" has something to be gone from', async () => {
    const k = kit();
    // A fill that runs the fixture server as the reference does, but names a pid that was never its environment.
    const [clean] = cleanFills(k) as EnvironmentFill[];
    const real = new Map<string, Handle>();
    const bogus: EnvironmentFill = {
      ...clean!,
      up: (spec, lease) => { const h = clean!.up(spec, lease); real.set('bogus', h); return { ...h, pid: 2 ** 30 }; },
      down: () => { const h = real.get('bogus'); if (h) clean!.down(h); },
    };
    try {
      const report = await runKit(k, bogus, { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'pid_not_environment'], ['FAIL', 'pid_not_environment']]);
    } finally {
      const h = real.get('bogus');
      if (h) clean!.down(h);
    }
  });

  it('passes an environment whose health answer is far larger than the probe\'s buffer, token and all', async () => {
    const k = kit();
    // A server of its own: health answers the token beside 200 KB of diagnostics; its command line carries the run token.
    const script = `
      const [port, token] = process.argv.slice(1);
      require('node:http').createServer((q, s) => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, notes: 'x'.repeat(200_000), token })); })
        .listen(Number(port), '127.0.0.1');
      process.on('SIGTERM', () => process.exit(0));`;
    const children: ChildProcess[] = [];
    const big: EnvironmentFill = {
      slot: 'environment@1', revision: 1,
      up: (spec, lease) => new Promise<Handle>((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script, String(lease.port), spec.token, lease.token], { stdio: 'ignore' });
        children.push(child);
        const until = Date.now() + 5000;
        const poll = (): void => {
          fetch(`http://127.0.0.1:${lease.port}${spec.health}`).then(() => resolve({ id: `big-${child.pid}`, port: lease.port, pid: child.pid! }), () => (Date.now() < until ? setTimeout(poll, 20) : reject(Error('the big server did not come up'))));
        };
        poll();
      }) as unknown as Handle,
      down: (handle) => { for (const c of children) if (c.pid === handle.pid) c.kill('SIGTERM'); },
    };
    try {
      const report = await runKit(k, big, { parts: ['fixed'] });
      expect(report.cases.map((c) => `${c.outcome}${c.message ? `: ${c.message}` : ''}`)).toEqual(['PASS', 'PASS']);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  });

  // A fill around a server given as a `node -e` script taking `[port, token, runToken]`; up resolves once `/ping` answers.
  const scripted = (script: string, children: ChildProcess[]): EnvironmentFill => ({
    slot: 'environment@1', revision: 1,
    up: (spec, lease) => new Promise<Handle>((resolve, reject) => {
      const child = spawn(process.execPath, ['-e', script, String(lease.port), spec.token, lease.token], { stdio: 'ignore' });
      children.push(child);
      const until = Date.now() + 5000;
      const poll = (): void => {
        fetch(`http://127.0.0.1:${lease.port}/ping`).then(() => resolve({ id: `scripted-${child.pid}`, port: lease.port, pid: child.pid! }), () => (Date.now() < until ? setTimeout(poll, 20) : reject(Error('the scripted server did not come up'))));
      };
      poll();
    }) as unknown as Handle,
    down: (handle) => { for (const c of children) if (c.pid === handle.pid) c.kill('SIGTERM'); },
  });

  it('refuses an environment that takes the health request at once and holds its answer until it is ready', async () => {
    const k = kit();
    // Ready is reported (the server listens and pings) while the first health answer waits 1.5 s; later ones are instant.
    const script = `
      const [port, token] = process.argv.slice(1);
      let held = false;
      require('node:http').createServer((q, s) => {
        if (q.url === '/ping') { s.writeHead(204); s.end(); return; }
        const answer = () => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, token })); };
        if (held) answer(); else { held = true; setTimeout(answer, 1500); }
      }).listen(Number(port), '127.0.0.1');
      process.on('SIGTERM', () => process.exit(0));`;
    const children: ChildProcess[] = [];
    try {
      const report = await runKit(k, scripted(script, children), { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'ready_before_health'], ['FAIL', 'ready_before_health']]);
      expect(report.cases[0]!.message).toMatch(/held the request/);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  });

  it('refuses an environment that listens on a second port besides its lease', async () => {
    const k = kit();
    const script = `
      const [port, token] = process.argv.slice(1);
      const http = require('node:http');
      const handler = (q, s) => { if (q.url === '/ping') { s.writeHead(204); s.end(); return; } s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, token })); };
      http.createServer(handler).listen(Number(port), '127.0.0.1');
      http.createServer(handler).listen(0, '127.0.0.1');
      process.on('SIGTERM', () => process.exit(0));`;
    const children: ChildProcess[] = [];
    try {
      const report = await runKit(k, scripted(script, children), { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'unleased_port'], ['FAIL', 'unleased_port']]);
      expect(report.cases[0]!.message).toMatch(/besides the lease/);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  });

  it('refuses an environment that opens a second listener only while going down', async () => {
    const k = kit();
    // On SIGTERM the server closes its leased listener, opens another port, and exits 400 ms later.
    const script = `
      const [port, token] = process.argv.slice(1);
      const http = require('node:http');
      const handler = (q, s) => { if (q.url === '/ping') { s.writeHead(204); s.end(); return; } s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, token })); };
      const main = http.createServer(handler).listen(Number(port), '127.0.0.1');
      process.on('SIGTERM', () => { main.close(); http.createServer(handler).listen(0, '127.0.0.1'); setTimeout(() => process.exit(0), 400); });`;
    const children: ChildProcess[] = [];
    try {
      const report = await runKit(k, scripted(script, children), { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'unleased_port'], ['FAIL', 'unleased_port']]);
      expect(report.cases[0]!.message).toMatch(/while going down/);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  });

  it('refuses an environment with a process under it that carries no run token, before down could lose it', async () => {
    const k = kit();
    const server = fileURLToPath(new URL('../../runtime/environment/server.mjs', import.meta.url));
    const children: ChildProcess[] = [];
    // The fixture server with a quiet grandchild: one the lease's contract doesn't cover.
    const quiet: EnvironmentFill = {
      slot: 'environment@1', revision: 1,
      up: (spec, lease) => new Promise<Handle>((resolve, reject) => {
        const dir = mkdtempSync(join(tmpdir(), 'deep-env-test-'));
        const ready = join(dir, 'ready');
        const child = spawn(process.execPath, [server, String(lease.port), spec.health, spec.token, String(spec.warmup), ready, lease.token, 'quiet'], { stdio: 'ignore' });
        children.push(child);
        const until = Date.now() + 5000;
        const poll = (): void => { if (existsSync(ready)) { rmSync(dir, { recursive: true, force: true }); resolve({ id: `quiet-${child.pid}`, port: lease.port, pid: child.pid! }); } else if (Date.now() < until) setTimeout(poll, 20); else reject(Error('the quiet server did not come up')); };
        poll();
      }) as unknown as Handle,
      down: (handle) => { for (const c of children) if (c.pid === handle.pid) c.kill('SIGTERM'); },
    };
    const grandchildren = (): string[] => execFileSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('/environment/helper.mjs') && !l.trim().split(/\s+/).some((w) => w.startsWith('run-')));
    try {
      const report = await runKit(k, quiet, { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'untagged_process'], ['FAIL', 'untagged_process']]);
      // The quiet grandchildren are not the kit's to stop: still there, and this test's to end.
      expect(grandchildren().length).toBeGreaterThanOrEqual(2);
    } finally {
      for (const c of children) c.kill('SIGKILL');
      for (const line of grandchildren()) { const pid = Number(line.trim().split(/\s+/)[0]); if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  });

  it('passes the clean fill on the same fixture in two kit runs at once', async () => {
    const k = kit();
    const reports = await Promise.all([0, 1].map(() => runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] })));
    expect(reports.flatMap((r) => r.cases.map((c) => `${c.outcome}${c.message ? `: ${c.message}` : ''}`))).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });
});

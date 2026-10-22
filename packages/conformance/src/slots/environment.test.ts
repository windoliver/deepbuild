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
      // The run token rides inside an option, as a real server's command line might carry it.
      const child = spawn(process.execPath, ['-e', script, String(lease.port), spec.token, `--run-token=${lease.token}`], { stdio: 'ignore' });
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

  it('reads BLOCKED, not FAIL, when the health route gives no answer within the kit\'s own probe limit', async () => {
    const k = kit();
    // The health answer is held past 2.5 s; no rule names a deadline, so the kit has no answer, not a wrong one.
    const script = `
      const [port, token] = process.argv.slice(1);
      require('node:http').createServer((q, s) => {
        if (q.url === '/ping') { s.writeHead(204); s.end(); return; }
        setTimeout(() => { s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, token })); }, 4000);
      }).listen(Number(port), '127.0.0.1');
      process.on('SIGTERM', () => process.exit(0));`;
    const children: ChildProcess[] = [];
    try {
      const report = await runKit(k, scripted(script, children), { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['BLOCKED', 'probe_timeout'], ['BLOCKED', 'probe_timeout']]);
    } finally {
      for (const c of children) c.kill('SIGKILL');
    }
  }, 15_000);

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

  it('refuses an environment whose tagged sibling process, beside the handle\'s, listens on a port of its own', async () => {
    const k = kit();
    const [clean] = cleanFills(k) as EnvironmentFill[];
    const siblings: ChildProcess[] = [];
    // The reference environment plus a process carrying the run token that the fill starts beside it, listening elsewhere.
    const withSibling: EnvironmentFill = {
      ...clean!,
      up: (spec, lease) => {
        const sibling = spawn(process.execPath, ['-e', 'require("node:http").createServer().listen(0, "127.0.0.1"); process.on("SIGTERM", () => process.exit(0));', lease.token], { stdio: 'ignore' });
        siblings.push(sibling);
        return clean!.up(spec, lease);
      },
      down: (handle) => { clean!.down(handle); for (const s of siblings) s.kill('SIGTERM'); },
    };
    try {
      const report = await runKit(k, withSibling, { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'unleased_port'], ['FAIL', 'unleased_port']]);
      expect(report.cases[0]!.message).toMatch(/besides the lease/);
    } finally {
      for (const s of siblings) s.kill('SIGKILL');
    }
  });

  it('refuses an environment whose tagged sibling has a child without the run token', async () => {
    const k = kit();
    const [clean] = cleanFills(k) as EnvironmentFill[];
    const siblings: ChildProcess[] = [];
    // A tagged sibling, listening on nothing, whose own child carries no token.
    const withQuietGrandchild: EnvironmentFill = {
      ...clean!,
      up: (spec, lease) => {
        const sibling = spawn(process.execPath, ['-e', 'const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(() => {}, 20_000)"], { stdio: "ignore" }); process.on("SIGTERM", () => { c.kill("SIGKILL"); process.exit(0); }); setTimeout(() => {}, 20_000);', lease.token], { stdio: 'ignore' });
        siblings.push(sibling);
        const until = Date.now() + 3000;
        // Wait for the child to appear in the table, so the kit's first reading sees it.
        while (Date.now() < until && !execFileSync('ps', ['-Awwo', 'ppid=,command='], { encoding: 'utf8' }).split('\n').some((l) => l.trim().startsWith(`${sibling.pid} `))) { /* spin */ }
        return clean!.up(spec, lease);
      },
      down: (handle) => { clean!.down(handle); for (const s of siblings) s.kill('SIGTERM'); },
    };
    try {
      const report = await runKit(k, withQuietGrandchild, { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'untagged_process'], ['FAIL', 'untagged_process']]);
    } finally {
      for (const s of siblings) s.kill('SIGTERM');
    }
  });

  it('refuses an environment that binds the leased port on every interface rather than 127.0.0.1', async () => {
    const k = kit();
    const script = `
      const [port, token] = process.argv.slice(1);
      require('node:http').createServer((q, s) => { if (q.url === '/ping') { s.writeHead(204); s.end(); return; } s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ ok: true, token })); })
        .listen(Number(port), '0.0.0.0');
      process.on('SIGTERM', () => process.exit(0));`;
    const children: ChildProcess[] = [];
    try {
      const report = await runKit(k, scripted(script, children), { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['FAIL', 'unleased_port'], ['FAIL', 'unleased_port']]);
      expect(report.cases[0]!.message).toMatch(/\*:\d+/);
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

  it('asks a down that threw once more at the case\'s end, so the fill\'s failure leaves nothing it can stop', async () => {
    const k = kit();
    const [clean] = cleanFills(k) as EnvironmentFill[];
    const asked: Handle[] = [];
    // A fill whose asynchronous down rejects the first time it is asked and, the second time, stops the server after a pause.
    const flaky: EnvironmentFill = {
      ...clean!,
      down: (async (handle: Handle) => {
        asked.push(handle);
        if (asked.filter((h) => h.id === handle.id).length === 1) throw new Error('down refused');
        await new Promise((resolve) => setTimeout(resolve, 300));
        clean!.down(handle);
      }) as unknown as EnvironmentFill['down'],
    };
    const report = await runKit(k, flaky, { parts: ['fixed'] });
    expect(report.cases.map((c) => `${c.outcome}: ${c.message}`)).toEqual(['FAIL: the fill threw: Error: down refused', 'FAIL: the fill threw: Error: down refused']);
    // Each environment was asked twice, and the second asking was waited for: by now nothing of them is left.
    expect(asked.map((h) => h.id)).toEqual([asked[0]!.id, asked[0]!.id, asked[2]!.id, asked[2]!.id]);
    const left = execFileSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('/environment/server.mjs') && asked.some((h) => l.includes(` ${h.port} `)));
    expect(left).toEqual([]);
  });

  it('leaves no helper of its own when its fixture server cannot bind the leased port', async () => {
    const k = kit();
    const planted = k.planted.find((p) => p.name === 'leaves-grandchild')!.fill as EnvironmentFill;
    const squatters: ChildProcess[] = [];
    const tokens: string[] = [];
    // The planted fill that starts a helper, with the leased port taken before its server can bind it.
    const squatted: EnvironmentFill = {
      ...planted,
      up: (spec, lease) => {
        tokens.push(lease.token);
        const squatter = spawn(process.execPath, ['-e', `require('node:net').createServer().listen(${lease.port}, '127.0.0.1'); setTimeout(() => {}, 20_000);`], { stdio: 'ignore' });
        squatters.push(squatter);
        const until = Date.now() + 3000;
        while (Date.now() < until) { try { execFileSync('lsof', ['-nP', '-iTCP:' + lease.port, '-sTCP:LISTEN'], { stdio: 'ignore' }); break; } catch { /* not yet */ } }
        return planted.up(spec, lease);
      },
    };
    try {
      const report = await runKit(k, squatted, { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['BLOCKED', 'fixture_down'], ['BLOCKED', 'fixture_down']]);
      const helpers = execFileSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('/environment/helper.mjs') && tokens.some((t) => l.includes(t)));
      expect(helpers).toEqual([]);
    } finally {
      for (const s of squatters) s.kill('SIGKILL');
    }
  });

  it('has its fixture server end the helper it started when the ready marker cannot be written', async () => {
    const server = fileURLToPath(new URL('../../runtime/environment/server.mjs', import.meta.url));
    const run = 'run-marker-test-token';
    // The marker's folder does not exist, so the marker can't be written after the helper was started.
    const child = spawn(process.execPath, [server, '0', '/health', 'tok', '10', '/nonexistent-deep-env/ready', run, 'helper'], { stdio: 'ignore' });
    const helpers = (): string[] => execFileSync('ps', ['-Awwo', 'pid=,command='], { encoding: 'utf8' }).split('\n').filter((l) => l.includes('/environment/helper.mjs') && l.includes(run));
    try {
      // The server listens (on a port of its own) and the marker step has run once the helper is gone; give it a moment.
      const until = Date.now() + 3000;
      while (Date.now() < until && (helpers().length > 0 || child.exitCode !== null)) await new Promise((resolve) => setTimeout(resolve, 20));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(child.exitCode).toBeNull();
      expect(helpers()).toEqual([]);
    } finally {
      child.kill('SIGKILL');
      for (const line of helpers()) { const pid = Number(line.trim().split(/\s+/)[0]); if (pid > 1) try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    }
  });

  it('reads BLOCKED, with the environment still taken down, when a fill\'s down never settles', async () => {
    const k = kit();
    const [clean] = cleanFills(k) as EnvironmentFill[];
    const handles: Handle[] = [];
    // A down whose promise never settles; the test takes the environments down itself afterwards.
    const stuck: EnvironmentFill = {
      ...clean!,
      down: ((handle: Handle) => { handles.push(handle); return new Promise<void>(() => undefined); }) as unknown as EnvironmentFill['down'],
    };
    try {
      const report = await runKit(k, stuck, { parts: ['fixed'] });
      expect(report.cases.map((c) => [c.outcome, ...c.codes])).toEqual([['BLOCKED', 'step_timeout'], ['BLOCKED', 'step_timeout']]);
      expect(report.cases[0]!.message).toMatch(/down did not settle within 5000 ms/);
    } finally {
      for (const h of handles) clean!.down(h);
    }
  }, 30_000);

  it('passes the clean fill on the same fixture in two kit runs at once', async () => {
    const k = kit();
    const reports = await Promise.all([0, 1].map(() => runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] })));
    expect(reports.flatMap((r) => r.cases.map((c) => `${c.outcome}${c.message ? `: ${c.message}` : ''}`))).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });
});

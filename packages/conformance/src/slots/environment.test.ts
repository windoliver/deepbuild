// The environment kit's down rule reads the process table for the run token. (The second invariant: what the kit
// can't see is BLOCKED, never a pass.) Two kit runs on the same fixture at once share no run token, so neither
// sees the other's processes.
import { spawn, type ChildProcess } from 'node:child_process';
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

  it('passes the clean fill on the same fixture in two kit runs at once', async () => {
    const k = kit();
    const reports = await Promise.all([0, 1].map(() => runKit(k, cleanFills(k)[0]!, { parts: ['fixed'] })));
    expect(reports.flatMap((r) => r.cases.map((c) => `${c.outcome}${c.message ? `: ${c.message}` : ''}`))).toEqual(['PASS', 'PASS', 'PASS', 'PASS']);
  });
});

// #2077: failures must stop the evaluator before a caught process error can become an application.
// Real runner, record and supervisor; faults deny an OS operation or a read at the injected record seam.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, expect, it, vi } from 'vitest';
import { alive, cleanup, coveredVersions, install, tempDir, ulid, waitFor } from '../../../tests/acceptance/159/helpers.ts';
import { openWorld, room } from '../../../tests/acceptance/159/world.ts';

afterAll(cleanup, 120_000);
const spec = { kind: 'eval' as const, agent: 'claude-code' as const, prompt: 'Evaluate removal', deadline_ms: 60_000 };
const shell = (folder: string, command: string) => ({ argv: ['/bin/sh', '-c', command], cwd: folder, env: { PATH: '/usr/bin:/bin' } });
const result = `printf '%s\\n' '{"type":"result","result":"done","total_cost_usd":0.25}'`;
async function world() {
  const bin = tempDir();
  install(bin, { version: coveredVersions().at(-1)! });
  const w = await openWorld({ loginPath: `${bin}:/usr/bin:/bin` });
  await room(w);
  return { w, bin };
}

for (const failure of ['leftover', 'cleanup exception', 'window report rejection'] as const) {
  it(`aborts before a caught ${failure} can apply, without calling unconfirmed cleanup stopped`, async () => {
    const { w } = await world();
    const dir = tempDir(), marker = join(dir, 'pid'), go = join(dir, 'go'), applied = join(dir, 'applied');
    let pid = 0, caught = '', attempted = false;
    const kill = process.kill.bind(process);
    const raw = w.record.raw.bind(w.record);
    let denyKill: ReturnType<typeof vi.spyOn> | undefined;
    let denyRead: ReturnType<typeof vi.spyOn> | undefined;
    let failingDisk: Database.Database | undefined;
    try {
      const job = await w.runner.submit(spec, async (c) => {
        try {
          const reading = failure === 'window report rejection'
            ? `printf '%s\\n' '{"rate_limits":{"five_hour":{"used_percentage":10}}}';` : '';
          await c.execute(shell(c.folder, `echo $$ > '${marker}'; while [ ! -f '${go}' ]; do sleep 0.05; done; ${reading} ${result}; exec sleep 60`), { write: [dir] }, 'prompt', Date.now() + 40_000);
        } catch (error) { caught = String(error); }
        // runEval catches failed samples; the real caller checks this signal before applying a comparison.
        attempted = true;
        c.signal.throwIfAborted();
        writeFileSync(applied, 'unsafe application');
        return 'adopted';
      });
      await waitFor(() => existsSync(marker), 10_000, 'owned process');
      pid = Number(readFileSync(marker, 'utf8'));
      const started = await waitFor(async () => (await w.events('process.tracked')).find((e) => (e.data as { pid: number }).pid === pid), 10_000, 'tracked process');
      const run = (started.data as { run: string }).run;
      if (failure !== 'window report rejection') {
        denyKill = vi.spyOn(process, 'kill').mockImplementation((target, signal) => {
          if (target === pid && signal !== 0) throw Object.assign(Error('fixture OS refuses signal'), { code: 'EPERM' });
          return kill(target, signal);
        });
        if (failure === 'cleanup exception') {
          failingDisk = new Database(join(w.dir, 'ledger.db'));
          failingDisk.exec("CREATE TRIGGER refuse_cleanup BEFORE INSERT ON events WHEN NEW.kind = 'run.cleaned' BEGIN SELECT RAISE(ABORT, 'fixture cleanup storage failure'); END");
        }
      } else denyRead = vi.spyOn(w.record, 'raw').mockImplementation((sql, params) => {
        if (sql === 'SELECT max(log_pos) AS head FROM events') return Promise.reject(Error('fixture window record unavailable'));
        return raw(sql, params);
      });
      writeFileSync(go, 'go');
      const end = await waitFor(async () => {
        const s = await w.runner.status(job.job);
        return ['stopping', 'stopped', 'refused', 'finished'].includes(s.state) && s;
      }, 25_000, 'evaluation refusal');
      expect(attempted, 'the evaluator caught the failed sample and reached its application guard').toBe(true);
      expect(caught).toMatch(failure === 'window report rejection' ? /window record unavailable/ : /cleanup unconfirmed/);
      expect(existsSync(applied), 'a caught process failure must abort before the evaluator can apply').toBe(false);
      expect(end.state).toBe(failure === 'window report rejection' ? 'stopped' : 'stopping');
      expect(end.result).toBeUndefined();
      if (failure !== 'window report rejection') {
        expect(alive(pid), 'cleanup really left an owned process alive').toBe(true);
        expect((await w.events('job.ended')).some((e) => e.subject === job.job)).toBe(false);
      }
      if (failure === 'leftover') {
        expect((await w.events('run.cleaned')).filter((e) => e.subject === run).map((e) => e.data)).toContainEqual(expect.objectContaining({ outcome: 'unfinished', left: [`pid:${pid}`] }));
      }
    } finally {
      failingDisk?.exec('DROP TRIGGER refuse_cleanup'); failingDisk?.close();
      denyKill?.mockRestore(); denyRead?.mockRestore();
      if (pid && alive(pid)) kill(pid, 'SIGKILL'); // Only the process this test started, after removing the fault.
      await w.close();
    }
  }, 90_000);
}

it('execute checks the verified CLI again before sending a prompt after a held supervisor start', async () => {
  const { w, bin } = await world();
  const holder = `run:${ulid()}`, dir = tempDir(), prompted = join(dir, 'prompted');
  const starts = vi.spyOn(w.sup, 'start'); // Observation only: every call still runs the real supervisor.
  try {
    await w.sup.start({ run: holder, ...shell(dir, 'exec sleep 60'), leases: [{ kind: 'worktree' }] });
    const job = await w.runner.submit(spec, async (c) => {
      const launch = { ...shell(c.folder, `if IFS= read -r line; then printf '%s' "$line" > '${prompted}'; fi; ${result}`), leases: [{ kind: 'worktree' }] };
      await c.execute(launch, { write: [dir] }, 'must not be sent\n', Date.now() + 40_000);
      return 'incorrectly finished';
    });
    const start = await waitFor(() => starts.mock.calls.map(([s]) => s).find((s) => s.cwd === job.folder && s.leases?.length), 10_000, 'eval start');
    await waitFor(async () => (await w.sup.status(start.run)).state === 'held', 10_000, 'held lease');
    install(bin, { version: '999.0.0', evil: true });
    await w.sup.cleanup(holder);
    const end = await w.runner.wait(job.job);
    expect(existsSync(prompted), 'a verified CLI swap during start must withhold the prompt, even with a trusted shell launcher').toBe(false);
    expect(end.state).toBe('refused');
    expect(end.refused).toMatch(/changed after it was verified/);
    expect(end.result).toBeUndefined();
    expect((await w.events('run.cleaned')).some((e) => e.subject === start.run && (e.data as { outcome: string }).outcome === 'clean')).toBe(true);
  } finally { starts.mockRestore(); await w.sup.cleanup(holder); await w.close(); }
}, 90_000);

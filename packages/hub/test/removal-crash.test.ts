// #2077: a crash between the adopted file replacement and its decision is recoverable, without another eval.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { CLI, NODE, REPO, childEnv, own, sleep, type Hub, type Line } from '../../../tests/acceptance/303/helpers.ts';
import { AFTER, BEFORE, FILE, RULE, allEvents, cleanup, deep, fixture, jobs, lessons, start, stopHub, until, window, type Fixture } from '../../../tests/acceptance/2077/helpers.ts';

afterAll(cleanup, 120_000);
async function cutting(w: Fixture, kind: string): Promise<Hub> {
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env: childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_VFS: JSON.stringify({ cutAt: { kind, nth: 1 } }),
    NODE_OPTIONS: `--import=${fileURLToPath(new URL('../../../tests/acceptance/2077/boundary.mjs', import.meta.url))}`,
    PATH: `${join(w.tmp, 'bin')}:${dirname(NODE)}:/usr/bin:/bin`,
  }), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '', out = '';
  child.stderr!.setEncoding('utf8').on('data', (s: string) => { err += s; });
  const exit = new Promise<void>((done) => child.once('exit', () => done()));
  const ready = await Promise.race([
    new Promise<Line>((done) => child.stdout!.setEncoding('utf8').on('data', (s: string) => { out += s; if (out.includes('\n')) done(JSON.parse(out.split('\n')[0]!)); })),
    exit.then(() => ({} as Line)), sleep(30000).then(() => ({} as Line)),
  ]);
  expect(ready.ready, err).toBe(true);
  return { pid: child.pid!, child, exit, socket: String(ready.socket), root: w.root, home: w.home, readyAt: Date.now(), clock: undefined, plant: undefined, stderr: () => err };
}

for (const [point, edited] of [['sync_intent', false], ['sync_flush', false], ['sync_flush', true]] as const) {
  it(`recovers adopted removal after ${point}${edited ? ', preserving a subsequent edit' : ''}`, async () => {
    const w = await fixture('adopt');
    const hub = await cutting(w, point);
    try {
      const lesson = (await lessons(w)).find((l) => l.text === RULE)!;
      await window(hub, 5, Date.now() + 3600_000);
      expect((await deep(w, ['memory', 'remove', lesson.id])).code).toBe(0);
      const job = (await jobs(hub)).find((j) => j.kind === 'eval')!;
      writeFileSync(w.release, 'go\n');
      const ended = await Promise.race([hub.exit.then(() => true), sleep(120_000).then(() => false)]);
      expect(ended, `the hub cuts after ${point}, not after it claims success`).toBe(true);
      const file = join(w.repo, FILE);
      expect(readFileSync(file, 'utf8')).toBe(point === 'sync_intent' ? BEFORE : AFTER);
      const yours = `${AFTER}\r\nA person's change after the crash.\r\n`;
      if (edited) writeFileSync(file, yours);
      const recovered = await start(w);
      try {
        const events = await until(() => allEvents(recovered), (es) => es.some((e) => e.kind === 'decision.created' && e.subject === job.job) || edited);
        expect(readFileSync(file, 'utf8')).toBe(edited ? yours : AFTER);
        const decisions = events.filter((e) => e.kind === 'decision.created' && e.subject === job.job);
        if (!edited) { expect(decisions).toHaveLength(1); expect(JSON.stringify(decisions)).toContain(lesson.id); }
        else expect(decisions).toEqual([]);
        expect((await jobs(recovered)).filter((j) => j.kind === 'eval')).toHaveLength(1);
      } finally { await stopHub(recovered); }
      const again = await start(w);
      try {
        expect(readFileSync(file, 'utf8')).toBe(edited ? yours : AFTER);
        expect((await allEvents(again)).filter((e) => e.kind === 'decision.created' && e.subject === job.job)).toHaveLength(edited ? 0 : 1);
        expect((await jobs(again)).filter((j) => j.kind === 'eval')).toHaveLength(1);
      } finally { await stopHub(again); }
    } finally { writeFileSync(w.release, 'go\n'); await stopHub(hub); }
  }, 240_000);
}

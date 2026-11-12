// A job runs on when the session that asked for it closes (#1925): the request's connection closing takes that request
// off the job, as a cancel does (#1923), but stops nothing, so the tool's run goes on and its row stays. An explicit
// cancel of the last request waiting on the job still stops it.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Jobs } from '../src/jobs.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

/** Jobs over a host whose one tool runs until it is stopped, noting the stop it was given and each row shown. */
function world() {
  const root = mkdtempSync(join(tmpdir(), 'job-close-'));
  dirs.push(root);
  const seen: { stop?: AbortSignal; rows: boolean[] } = { rows: [] };
  const tool = { tool: 'encode-a@1.0.0', plugin: 'test', build: 'b', descriptor: { tool: 'encode-a@1.0.0', params: {}, run: { dir: 'tool', entry: 'encode.mjs' }, qualification: null } };
  const host = {
    jobs: () => [{ kind: 'test.encode', plugin: 'test', descriptor: { schema: { params: {}, inputs: {} }, outputs: { video: {} }, key: [], output_checks: [], qualification: { fixtures: [] } }, tools: [tool] }],
    jobParams: () => ({}),
    runJobTool: (_tool: string, _kind: string, _params: unknown, _inputs: unknown, _call: unknown, stop: AbortSignal) => {
      seen.stop = stop;
      return new Promise((_, reject) => stop.addEventListener('abort', () => reject(Error('stopped'))));
    },
  };
  const jobs = new Jobs({
    root, now: Date.now, host: () => host as never, keep: async () => '0'.repeat(64), has: async () => false,
    read: async () => new Uint8Array(), adopt: async () => {}, send: async () => { throw Error('nothing is sent'); }, raise: async () => 'ask:none',
    row: (_job, running) => { seen.rows.push(running); },
  });
  return { jobs, seen };
}

it('a job runs on when the session that asked for it closes, and stops when its last request is cancelled', async () => {
  for (const closed of [true, false]) {
    const { jobs, seen } = world();
    const answer = jobs.run({ kind: 'test.encode', tool: 'encode-a@1.0.0', params: null, inputs: [] }, 'mcp:1');
    for (let i = 0; i < 200 && !seen.stop; i++) await new Promise((r) => setTimeout(r, 5));
    jobs.gone('mcp:1', closed);
    expect(await answer, 'the request leaves its job either way').toMatchObject({ status: 'cancelled' });
    await new Promise((r) => setTimeout(r, 20));
    const why = closed ? 'its session closed' : 'its last request was cancelled';
    expect(seen.stop!.aborted, why).toBe(!closed);
    expect(seen.rows.at(-1), `the job's row once ${why}`).toBe(closed);
  }
});

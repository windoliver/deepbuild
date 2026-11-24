// A fixture of a kind's qualification runs on the tools whose own params take it (#3035), so a kind of several
// formats qualifies each tool on its format's fixtures. A tool whose params take none of them has nothing to qualify
// on, so it is refused before anything runs: narrowing its params is no way around the qualification. And a tool
// whose JSON output differs from a fixture's is refused naming where it first differs, not by both outputs whole.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { JobTools } from '../src/jobs.js';

const folder = mkdtempSync(join(tmpdir(), 'job-fixtures-'));
mkdirSync(join(folder, 'tool'));
writeFileSync(join(folder, 'tool', 'run.mjs'), '');
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const format = (names: string[]) => ({ type: 'object', properties: { from: { enum: names } }, required: ['from'], additionalProperties: false });
const kind = (expect: string) => ({
  schema: { params: format(['text', 'table']), inputs: { file: {} } }, outputs: { out: {} }, key: ['tool', 'params', 'inputs'], output_checks: [],
  qualification: { fixtures: [{ name: 'a-text', params: { from: 'text' }, inputs: { file: 'abc' }, expect: { out: expect } }] },
});
/** The install of one tool of `test.read`, on a supervisor whose every run writes `answer`; and the runs it started. */
function install(tool: string, from: string[], expect: string, answer = '') {
  const started: unknown[] = [];
  const supervisor = {
    start: async (run: { output: { stdout(chunk: Buffer): void } }) => { started.push(run); run.output.stdout(Buffer.from(answer)); return { status: 'started' }; },
    wait: async () => ({ code: 0 }), cleanup: async () => undefined, signal: async () => undefined,
  };
  const tools = new JobTools({ entries: {}, home: folder, now: () => 0, plant: undefined, files: { read: () => ({}), save: () => undefined }, supervisor } as never);
  const descriptor = { tool, params: format(from), run: { dir: 'tool', entry: 'run.mjs' }, qualification: {} };
  const done = tools.qualify(
    { id: 'test/reads', version: '1.0.0', folder } as never,
    { jobs: ['test.read'], job_tools: [{ kind: 'test.read', tool }] } as never,
    { jobKinds: new Map([['test.read', kind(expect)]]), jobTools: [{ kind: 'test.read', tool: descriptor }] } as never,
  );
  return { done, started };
}

it('refuses a tool whose params take none of its kind\'s fixtures, naming the tool, and starts no run', async () => {
  const { done, started } = install('reads-tables@1.0.0', ['table'], 'ABC');
  await expect(done).rejects.toThrow(/reads-tables@1\.0\.0 takes the params of none of test\.read's qualification fixtures/);
  expect(started, 'no run of the tool was started').toEqual([]);
});

it('refuses a tool whose JSON output differs from a fixture\'s, naming the first path where it does', async () => {
  const wrote = JSON.stringify({ outputs: { out: Buffer.from('{"rows":{"a":1,"b":[1,3]},"title":"abc"}').toString('base64') } });
  const { done } = install('reads-text@1.0.0', ['text'], '{"rows":{"a":1,"b":[1,2]},"title":"abc"}', wrote);
  const refusal = await done.then(() => 'installed', (e: Error) => e.message);
  expect(refusal).toMatch(/reads-text@1\.0\.0 fails test\.read's qualification at the fixture a-text: its out differs from the fixture's at \/rows\/b\/1: it wrote 3, where the fixture expects 2/);
  expect(refusal, 'what the two outputs share is left out').not.toContain('title');
});

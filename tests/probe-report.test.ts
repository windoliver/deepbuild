// Exercise each public fill against a real child with a broken wire report. Only the OS launch boundary is replaced.
import { spawn as realSpawn } from 'node:child_process';
import { expect, it, vi } from 'vitest';
import { workFill, type DataSpec } from '@deepbuild/checks-work';
import { numbersFill, type NumbersSpec } from '@deepbuild/checks-numbers';

const wire = vi.hoisted(() => ({ text: '' }));
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawn: (_program: string, _args: string[], options: Parameters<typeof realSpawn>[2]) =>
    actual.spawn(process.execPath, ['-e', `process.stdin.resume(); process.stdin.on('end', () => process.stdout.end(${JSON.stringify(wire.text)}));`], options) };
});
const common = { runner: 'sqlite', inputs: [], depth: 'unit', oracle: 'code', contract: null } as const;
const data: DataSpec = { ...common, kind: 'data', database: 'fixture.db', query: 'select 1', rows: [{ n: 1 }] };
const numbers: NumbersSpec = { ...common, kind: 'numbers', numbers: [], added: [] };
const ctx = { checkout: process.cwd(), deadline: 1000, now: Date.now };
const fills = [
  { name: 'work', run: () => workFill('data').run(data, ctx) },
  { name: 'numbers', run: () => numbersFill().run(numbers, ctx) },
];
for (const fill of fills) {
  for (const [label, text] of [
    ['invalid JSON', '{broken\n'],
    ['null', 'null\n'],
    ['incomplete success', '{"outcome":"passed"}\n'],
    ['unknown outcome', '{"outcome":"green","testsRun":1,"failures":[],"read":[]}\n'],
    ['fractional count', '{"outcome":"passed","testsRun":0.5,"failures":[],"read":[]}\n'],
  ]) {
    it(`${fill.name} closes ${label} as a failed run, not an uncaught exception or a success`, async () => {
      wire.text = text!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          Promise.resolve().then(fill.run),
          new Promise<string>(resolve => { timer = setTimeout(() => resolve('unsettled'), 2000); }),
        ]);
        expect(result).toMatchObject({ outcome: 'failed', testsRun: 0, failures: [{ assertion: false }] });
      } finally { clearTimeout(timer); }
    });
  }
  it(`${fill.name} keeps a complete successful report`, async () => {
    wire.text = '{"outcome":"passed","testsRun":1,"failures":[],"read":["fixture.db"]}\n';
    expect(await fill.run()).toEqual({ outcome: 'passed', testsRun: 1, failures: [], read: ['fixture.db'], evidence: [], mask: null });
  });
}

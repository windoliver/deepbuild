import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const AT_THE_BASE = {
  'tests/acceptance/348/inbound.test.ts': '9d943ab61407a60e8430117cda5d3feb2d6402e7c37cbb6af04409c8299f3685',
  'tests/acceptance/348/fixtures/inbound/deepbuild.json': '5be74ddbaa4bb6cb2d41253f41084bdfb8312c8fc03308ad4d348ac8806b61e4',
  'tests/acceptance/348/fixtures/inbound/index.ts.fixture': 'c72260715188410b9215349e3888bd8f3afbb8bf78b0afc8c9544a5a4c0f37bd',
};

function run(command: string, args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: REPO, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (c: Buffer) => { output += c.toString('utf8'); });
    child.stderr.on('data', (c: Buffer) => { output += c.toString('utf8'); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}

describe('AC6 #2370 #348\'s AC12 runs unchanged and passes', () => {
  it('AC6 #2370 #348\'s inbound.test.ts and its inbound fixture are as at the base, and its two AC12 tests pass: one 127.0.0.1 listener serves the chosen route, the rest never reach the package, and turned off nothing listens', async () => {
    const now = Object.fromEntries(Object.keys(AT_THE_BASE).map((path) => [path, createHash('sha256').update(readFileSync(`${REPO}${path}`)).digest('hex')]));
    expect(now, '#348\'s AC12 test and its fixture are unchanged since the base').toEqual(AT_THE_BASE);

    const { code, output } = await run(process.execPath, [
      'node_modules/vitest/vitest.mjs', 'run', '--root', 'tests/acceptance/348', 'inbound.test.ts',
      '--no-file-parallelism', '--testTimeout=600000', '--reporter=verbose',
    ]);
    const tail = output.split('\n').filter((line) => /AC12|Tests? |Test Files|FAIL|Error/.test(line)).join('\n');
    console.log(tail);
    expect({ code, passed: /Tests\s+2 passed \(2\)/.test(output) }, `#348's inbound.test.ts run:\n${tail}`).toEqual({ code: 0, passed: true });
  }, 600_000);
});

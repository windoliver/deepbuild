// AC3: on this Mac (macOS 27.2.1, reports with no subsystem), `vitest run packages/extension-host/test` passes the 11
// tests the issue lists. The issue's own command is run in a child Vitest from the repo root, over the five files the
// tests are in (the rest of packages/extension-host/test is outside the criterion), with each file's own timeouts,
// none raised; its JSON report must show each of the 11 as passed. A test missing from the report fails too.
//
// The 11, as the issue's table names them (the 7 of sources.test.ts are every test of its three named describe blocks
// that runs on macOS and opens the extension host; the Keychain store test of "secrets on the trusted path" opens no
// supervisor and was not among the issue's failures, so it is not one of the 7).
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, REPO } from './helpers.ts';

const LISTED: readonly (readonly [file: string, name: string])[] = [
  ['update-default.test.ts', 'an update with no answer defaults to keeping the installed provider and its users'],
  ['fetch-fold.test.ts', 'keeps redirect responses and rejects CONNECT without an HTTP request'],
  ['host.test.ts', '#348 review regressions a request body that stops arriving is cut off within the call deadline'],
  ['sources.test.ts', '#364 back-off, cost and readings a call the provider fails backs off'],
  ['sources.test.ts', '#364 back-off, cost and readings each live call records its cost as source.called'],
  ['sources.test.ts', '#364 back-off, cost and readings each reading the hub makes is recorded once by the core'],
  ['sources.test.ts', '#364 secrets on the trusted path removing a secret lists the sources that go BLOCKED'],
  ['sources.test.ts', '#364 secrets on the trusted path sign-in through an OAuth loopback'],
  ['sources.test.ts', '#364 stream sources at run time reads on from the cursor the hub keeps'],
  ['sources.test.ts', "#364 stream sources at run time keeps each stream's cursor when two streams are read at once"],
  ['update-close.test.ts', 'a declined update reports the kept provider even if the host closes before the waiter resumes'],
];

interface Assertion { fullName: string; status: string; failureMessages?: string[] }

test.skipIf(process.platform !== 'darwin')(`${AC[3]} vitest run packages/extension-host/test passes the 11 tests the issue lists`, async () => {
  const files = [...new Set(LISTED.map(([file]) => file))].map((file) => `packages/extension-host/test/${file}`);
  const dir = mkdtempSync(join(tmpdir(), 'deep2977-vitest-'));
  try {
    const report = join(dir, 'report.json');
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST') && key !== 'TEST' && key !== 'NODE_ENV'));
    const child = spawn(process.execPath, [join(REPO, 'node_modules', 'vitest', 'vitest.mjs'), 'run', ...files, '--reporter=json', `--outputFile=${report}`],
      { cwd: REPO, env, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr!.setEncoding('utf8').on('data', (text: string) => { stderr = (stderr + text).slice(-4000); });
    const code = await new Promise<number | null>((done) => child.on('close', done));
    expect(existsSync(report), `the child vitest wrote its JSON report (exit ${code}):\n${stderr}`).toBe(true);
    const results = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string; assertionResults: Assertion[] }[] }).testResults
      .flatMap((file) => file.assertionResults.map((a) => ({ ...a, file: file.name })));
    const seen = LISTED.map(([file, name]) => {
      const found = results.filter((a) => a.file.endsWith(`/${file}`) && a.fullName.startsWith(name));
      return found.length === 1 ? `${file} > ${name}: ${found[0]!.status}${found[0]!.status === 'passed' ? '' : ` (${(found[0]!.failureMessages ?? []).join(' ').split('\n')[0]})`}`
        : `${file} > ${name}: ${found.length} tests match`;
    });
    expect(seen.length).toBe(11);
    const failing = seen.filter((line) => !line.endsWith(': passed'));
    expect(failing.length, `the listed tests that did not pass in the child run:\n${failing.join('\n')}`).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 1_800_000);

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const TAG = '#3377.6ef73b11';
const FINDING = 'never answered on its port';
const NAMED = /the database service \S+ (?:never answered|exited with code \S+ before it answered) on its port/;
const blocked = (failure: string): boolean => /^(?:\w*Error: )?BLOCKED\b/.test(failure);
const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const SUITE = 'tests/acceptance/580';
const IMAGES = ['postgres:16', 'redis:7', 'busybox:1.36'];

interface Report { testResults: { name: string; message?: string; assertionResults: { fullName: string; status: string; duration?: number; failureMessages?: string[] }[] }[] }

function ready(): void {
  if (process.platform !== 'linux') throw Error(`BLOCKED: AC1 ${TAG} needs Linux; this machine is ${process.platform}`);
  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 60_000 });
  if (info.status !== 0) throw Error(`BLOCKED: AC1 ${TAG} needs a Docker daemon: docker info exited ${info.status}: ${String(info.stderr).slice(-500)}`);
  const missing = IMAGES.filter((image) => spawnSync('docker', ['image', 'inspect', image], { timeout: 60_000 }).status !== 0);
  if (missing.length) throw Error(`BLOCKED: AC1 ${TAG} needs ${missing.join(', ')} local (580's suite pulls nothing)`);
}

test(`AC1 ${TAG} on Linux with a Docker daemon, no test of tests/acceptance/580/ fails with "${FINDING}", each test's line recorded`, () => {
  ready();
  const files = readdirSync(join(REPO, SUITE)).filter((name) => name.endsWith('.test.ts')).sort();
  expect(files.length, `${SUITE} has test files`).toBeGreaterThan(0);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  const named: string[] = [], unreached: string[] = [], unrun: string[] = [];
  let passed = 0, total = 0;
  for (const file of files) {
    const out = join(mkdtempSync(join(tmpdir(), 'deep-3377-ac1-')), 'report.json');
    const args = [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', SUITE, file, '--reporter=json', `--outputFile=${out}`];
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, timeout: 2 * 3_600_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
    rmSync(join(REPO, SUITE, 'node_modules', '.vite'), { recursive: true, force: true });
    let report: Report | undefined;
    try { report = JSON.parse(readFileSync(out, 'utf8')) as Report; } catch {}
    rmSync(join(out, '..'), { recursive: true, force: true });
    if (NAMED.test(`${r.stdout}${r.stderr}`)) named.push(file);
    if (!report) { unrun.push(`${file}: no report (exit ${r.status}${r.error ? `, ${r.error.message}` : ''}): ${String(r.stderr).slice(-1000)}`); continue; }
    const tests = report.testResults.flatMap((result) => result.assertionResults.map((t) => ({ ...t, file: relative(REPO, result.name) })));
    if (!tests.length) unrun.push(`${file}: no tests ran: ${report.testResults.map((result) => result.message ?? '').join(' ').slice(-1000)}`);
    for (const t of tests) {
      const failure = (t.failureMessages ?? []).join('\n');
      console.log(`${TAG} ${t.file}: ${t.fullName}: ${t.status} ${Math.round(t.duration ?? 0)} ms${failure ? `: ${failure.split('\n')[0]!.slice(0, 300)}` : ''}`);
      if (NAMED.test(failure)) named.push(`${t.file}: ${t.fullName}`);
      if ((t.failureMessages ?? []).some(blocked)) unreached.push(`${t.file}: ${t.fullName}: ${failure.split('\n')[0]!.slice(0, 300)}`);
      if (t.status === 'passed') passed++;
      total++;
    }
  }
  console.log(`${TAG} ${SUITE}: ${passed} passed of ${total} in ${files.length} files; naming "${FINDING}": ${named.length ? named.join(', ') : 'none'}`);
  expect.soft(unrun, 'every file of 580 wrote a report with tests').toEqual([]);
  expect.soft(unreached, 'no test of 580 ended BLOCKED: one that never reached its stack proves nothing').toEqual([]);
  expect.soft(passed, 'some test of 580 passed, so a stack came up here').toBeGreaterThan(0);
  expect(named, `no file or test of 580 names "${FINDING}"`).toEqual([]);
}, 30 * 3_600_000);

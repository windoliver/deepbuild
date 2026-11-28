import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const TAG = '#3371.331846b9';
const NAMED = /dial unix \/var\/run\/docker\.sock: connect: no such file or directory|Cannot connect to the Docker daemon at unix:\/\/\/var\/run\/docker\.sock/;
const blocked = (failure: string): boolean => /^(?:\w*Error: )?BLOCKED\b/.test(failure);
const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const IMAGES = ['postgres:16', 'redis:7', 'busybox:1.36'];
const IMAGES_331 = ['busybox:latest', 'busybox', 'alpine:latest'];

interface Report { testResults: { name: string; message?: string; assertionResults: { fullName: string; status: string; duration?: number; failureMessages?: string[] }[] }[] }

function ready(): void {
  if (process.platform !== 'linux') throw Error(`BLOCKED: AC3 ${TAG} needs Linux; this machine is ${process.platform}`);
  let real = '';
  try { real = realpathSync('/var/run/docker.sock'); } catch (error) { real = String(error); }
  if (real !== '/run/docker.sock') throw Error(`BLOCKED: AC3 ${TAG} needs /var/run/docker.sock to resolve to /run/docker.sock; it resolves to ${real}`);
  const info = spawnSync('docker', ['-H', 'unix:///var/run/docker.sock', 'info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8', timeout: 60_000 });
  if (info.status !== 0) throw Error(`BLOCKED: AC3 ${TAG} needs a Docker daemon at /var/run/docker.sock: docker info exited ${info.status}: ${String(info.stderr).slice(-500)}`);
  const has = (image: string): boolean => spawnSync('docker', ['image', 'inspect', image], { timeout: 60_000 }).status === 0;
  const missing = IMAGES.filter((image) => !has(image));
  if (!IMAGES_331.some(has)) missing.push(`one of ${IMAGES_331.join(', ')}`);
  if (missing.length) throw Error(`BLOCKED: AC3 ${TAG} needs ${missing.join(', ')} local (the suites pull nothing)`);
}

test(`AC3 ${TAG} on Linux with Docker at /var/run/docker.sock -> /run/docker.sock, no test of tests/acceptance/580/ or tests/acceptance/331/compose.test.ts fails with the docker.sock dial error, each test's line recorded`, () => {
  ready();
  const runs = [
    ...readdirSync(join(REPO, 'tests/acceptance/580')).filter((name) => name.endsWith('.test.ts')).sort().map((file) => ({ root: 'tests/acceptance/580', file })),
    { root: 'tests/acceptance/331', file: 'compose.test.ts' },
  ];
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST')));
  const named: string[] = [], unreached: string[] = [], unrun: string[] = [];
  let passed = 0, total = 0;
  for (const { root, file } of runs) {
    const out = join(mkdtempSync(join(tmpdir(), 'deep-3371-ac3-')), 'report.json');
    const args = [join(REPO, 'node_modules/vitest/vitest.mjs'), 'run', '--root', root, file, '--reporter=json', `--outputFile=${out}`];
    const r = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', env: { ...env, NO_COLOR: '1' }, timeout: 2 * 3_600_000, killSignal: 'SIGKILL', maxBuffer: 1 << 28 });
    rmSync(join(REPO, root, 'node_modules', '.vite'), { recursive: true, force: true });
    let report: Report | undefined;
    try { report = JSON.parse(readFileSync(out, 'utf8')) as Report; } catch {}
    rmSync(join(out, '..'), { recursive: true, force: true });
    if (NAMED.test(`${r.stdout}${r.stderr}`)) named.push(`${root}/${file}`);
    if (!report) { unrun.push(`${root}/${file}: no report (exit ${r.status}${r.error ? `, ${r.error.message}` : ''}): ${String(r.stderr).slice(-1000)}`); continue; }
    const tests = report.testResults.flatMap((result) => result.assertionResults.map((t) => ({ ...t, file: relative(REPO, result.name) })));
    if (!tests.length) unrun.push(`${root}/${file}: no tests ran: ${report.testResults.map((result) => result.message ?? '').join(' ').slice(-1000)}`);
    for (const t of tests) {
      const failure = (t.failureMessages ?? []).join('\n');
      console.log(`${TAG} ${t.file}: ${t.fullName}: ${t.status} ${Math.round(t.duration ?? 0)} ms${failure ? `: ${failure.split('\n')[0]!.slice(0, 300)}` : ''}`);
      if (NAMED.test(failure)) named.push(`${t.file}: ${t.fullName}`);
      if ((t.failureMessages ?? []).some(blocked)) unreached.push(`${t.file}: ${t.fullName}: ${failure.split('\n')[0]!.slice(0, 300)}`);
      if (t.status === 'passed') passed++;
      total++;
    }
  }
  console.log(`${TAG} ${passed} passed of ${total} in ${runs.length} files; naming the dial error: ${named.length ? named.join(', ') : 'none'}`);
  expect.soft(unrun, 'every file wrote a report with tests').toEqual([]);
  expect.soft(unreached, 'no test ended BLOCKED: one that never reached the daemon proves nothing').toEqual([]);
  expect.soft(passed, 'some test passed, so compose reached the daemon here').toBeGreaterThan(0);
  expect(named, 'no file or test names the docker.sock dial error').toEqual([]);
}, 30 * 3_600_000);

// #2551 criterion 2: `tests/acceptance/313/fakes.test.ts` passes on main. The file is run through the repo's own vitest
// and its own result rows are read, never a summary. A test of it that fails reads as passing only when
// scripts/known-failures.json retires it (a `skips` entry whose reason starts "retired by", the repo's approved way to
// replace a frozen acceptance test) and every test of the replacement suite that reason names passes, read the same way.
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SUITE = 'tests/acceptance/313/fakes.test.ts';
const VITEST = join(ROOT, 'node_modules/vitest/vitest.mjs');
const TIMEOUT = 600_000;

interface Row { id: string; status: string; failure: string }
interface Skip { id: string; reason?: string }

/** Every result row of one vitest run of `file`, named `<file> › <describe…> › <it>` as known-failures.json names tests. */
async function run(file: string): Promise<{ rows: Row[]; exit: number | null; output: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'deepbuild-2551-'));
  const report = join(dir, 'report.json');
  try {
    const { exit, output } = await new Promise<{ exit: number | null; output: string }>((resolve) => {
      execFile(process.execPath, [VITEST, 'run', file, '--reporter=json', `--outputFile=${report}`], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, timeout: TIMEOUT - 30_000 }, (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : null) : 0;
        resolve({ exit: code, output: `${stdout}\n${stderr}` });
      });
    });
    if (!existsSync(report)) return { rows: [], exit, output };
    const json = JSON.parse(readFileSync(report, 'utf8')) as {
      testResults: { name: string; assertionResults: { ancestorTitles: string[]; title: string; status: string; failureMessages?: string[] }[] }[];
    };
    const rows = json.testResults.flatMap((f) => f.assertionResults.map((a) => ({
      id: [relative(ROOT, f.name).split('\\').join('/'), ...a.ancestorTitles, a.title].join(' › '),
      status: a.status,
      failure: (a.failureMessages ?? []).join('\n').split('\n')[0] ?? '',
    })));
    return { rows, exit, output };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The suite files a retirement reason names (`313-redraft-2551/fakes.test.ts`, or a path from the repo root). */
function replacements(reason: string): string[] {
  return [...reason.matchAll(/(?:^|[\s(:`'"])((?:[\w@.-]+\/)+[\w@.-]+\.test\.[cm]?[jt]s)/g)].map(([, path]) => (path!.startsWith('tests/') ? path! : `tests/acceptance/${path}`));
}

/** What keeps `file` from passing, following each retired test to the suite that replaces it. */
async function problems(file: string, skips: Skip[], seen = new Set<string>()): Promise<string[]> {
  seen.add(file);
  const { rows, exit, output } = await run(file);
  if (rows.length === 0) return [`${file}: vitest reported no tests (exit ${exit}): ${output.trim().split('\n').slice(-5).join(' / ')}`];
  const found: string[] = [];
  for (const row of rows) {
    if (row.status === 'passed') continue;
    if (row.status !== 'failed') {
      found.push(`${row.id}: ${row.status}, not run`);
      continue;
    }
    const retired = skips.find((s) => s.id === row.id && /^retired by\b/.test(s.reason ?? ''));
    if (!retired) {
      found.push(`${row.id}: ${row.failure}`);
      continue;
    }
    const next = replacements(retired.reason!);
    if (next.length === 0) found.push(`${row.id}: retired, but its reason names no replacement suite: ${retired.reason}`);
    for (const path of next) {
      if (seen.has(path)) continue;
      if (!existsSync(join(ROOT, path))) found.push(`${row.id}: retired for ${path}, which the tree doesn't hold`);
      else found.push(...(await problems(path, skips, seen)).map((p) => `${p} (replacing ${row.id})`));
    }
  }
  return found;
}

describe('#2551 tests/acceptance/313/fakes.test.ts passes on main', () => {
  it('#2551.7d1ea751 tests/acceptance/313/fakes.test.ts passes on main: every test vitest runs in it passes, and one known-failures.json retires is replaced by a named suite whose every test passes', async () => {
    const { skips = [] } = JSON.parse(readFileSync(join(ROOT, 'scripts/known-failures.json'), 'utf8')) as { skips?: Skip[] };
    const found = await problems(SUITE, skips);
    expect(found, `what keeps ${SUITE} from passing`).toEqual([]);
  }, TIMEOUT);
});

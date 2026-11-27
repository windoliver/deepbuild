import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type TestContext } from 'vitest';
import { REPO, run, type Ran } from '../25/routes/helpers.ts';

export const MINUTE = 60_000;
export const REDRAFT = 'tests/acceptance/25-redraft-3243/';
const VITEST = join(REPO, 'node_modules', 'vitest', 'vitest.mjs');

export interface Route { criterion: string; named: string; wrong: string }
interface Assertion { title: string; fullName?: string; status: string; failureMessages?: string[] }
interface FileResult { name: string; status: string; message?: string; assertionResults: Assertion[] }

function childEnv(): NodeJS.ProcessEnv {
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:GIT_|npm_|VITEST)/i.test(key))), NO_COLOR: '1' };
}
const git = (args: string[]) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8', env: childEnv() });
const tail = (text: string, lines = 20) => text.trimEnd().split('\n').slice(-lines).join('\n');
const UNRUN = /^(?:\w*Error: )?(?:expected ['"`])?(?:BLOCKED|INCONCLUSIVE)\b/;

function testFiles(folder: string): string[] {
  const root = join(REPO, folder);
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) { if (name !== 'twins' && name !== 'node_modules') walk(path); }
      else if (/\.test\.ts$/.test(name)) out.push(relative(REPO, path));
    }
  };
  walk(root);
  return out.sort();
}

async function deciding(route: Route, ctx: TestContext): Promise<{ files: string[]; by: string; redraft: boolean }> {
  const { byHand, listed } = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { byHand: string[]; listed: (list: string[], file: string) => boolean };
  if (!listed(byHand, route.named)) {
    const base = git(['merge-base', 'HEAD', 'origin/main']);
    if (base.status !== 0) ctx.skip(`INCONCLUSIVE: git names no merge base with origin/main, so ${route.named} can't be read as unchanged: ${base.stderr.trim()}`);
    const diff = git(['diff', '--name-only', base.stdout.trim(), '--', route.named]);
    if (diff.status !== 0) ctx.skip(`INCONCLUSIVE: git diff of ${route.named} failed: ${diff.stderr.trim()}`);
    expect(diff.stdout.split('\n').filter(Boolean), `#3243.53a4911b ${route.named} decides ${route.criterion} only unchanged from the merge base ${base.stdout.trim()}`).toEqual([]);
    return { files: [route.named], by: `${route.named}, unchanged`, redraft: false };
  }
  const files = testFiles(REDRAFT).filter((path) => readFileSync(join(REPO, path), 'utf8').includes(route.criterion));
  expect(files, `#3243.53a4911b ${route.named} is run by hand (byHand in scripts/lanes.mjs), so a blind redraft in ${REDRAFT} must hold tests carrying ${route.criterion}; none does`).not.toEqual([]);
  return { files, by: `${route.named} by hand, redraft ${files.join(', ')}`, redraft: true };
}

function redraftTwin(route: Route): string[] {
  const file = join(REPO, REDRAFT, 'twins.json');
  if (!existsSync(file)) return [`${REDRAFT}twins.json doesn't exist`];
  let map: unknown;
  try { map = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { return [`${REDRAFT}twins.json isn't JSON: ${(error as Error).message}`]; }
  const names = (map as Record<string, unknown> | null)?.[route.criterion];
  if (!Array.isArray(names) || !names.includes(route.wrong)) return [`${REDRAFT}twins.json maps ${route.criterion} to ${JSON.stringify(names ?? null)}, not to a twin named ${route.wrong}`];
  const folder = join(REDRAFT, 'twins', route.wrong);
  const all: string[] = [];
  const walk = (dir: string) => { for (const name of readdirSync(dir)) { const path = join(dir, name); if (statSync(path).isDirectory()) walk(path); else all.push(relative(join(REPO, folder), path)); } };
  if (!existsSync(join(REPO, folder)) || !statSync(join(REPO, folder)).isDirectory()) return [`the twin folder ${folder}/ doesn't exist`];
  walk(join(REPO, folder));
  if (!all.length) return [`the twin folder ${folder}/ holds no file`];
  const tests = all.filter((path) => path.startsWith('tests/'));
  return tests.length ? [`the twin ${folder}/ replaces files under tests/, not product source: ${tests.join(', ')}`] : [];
}

export async function judgeRoute(ctx: TestContext, route: Route, boundMs: number): Promise<void> {
  if (!existsSync(VITEST)) ctx.skip('INCONCLUSIVE: node_modules/vitest is not installed in this checkout (npm ci)');
  const { files, by, redraft } = await deciding(route, ctx);
  const out = realpathSync(mkdtempSync(join(tmpdir(), 'dh3243-')));
  try {
    const report = join(out, 'report.json');
    const child: Ran = await run(process.execPath, [VITEST, 'run', '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`, '-t', route.criterion, ...files], { env: childEnv(), cwd: REPO, timeoutMs: boundMs });
    const said = `child Vitest (${by}): exit ${child.code}${child.signal ? ` (${child.signal})` : ''}${child.timedOut ? `, stopped at its ${Math.round(boundMs / MINUTE)}-minute bound` : ''}\n${tail(child.stdout + child.stderr)}`;
    console.log(said);
    if (!existsSync(report)) ctx.skip(`INCONCLUSIVE: ${route.criterion} reached no verdict, the child Vitest wrote no report: ${said}`);
    const results = (JSON.parse(readFileSync(report, 'utf8')) as { testResults: FileResult[] }).testResults;
    const tagged: { file: string; a: Assertion }[] = [];
    const failed: string[] = [];
    const unrun: string[] = [];
    for (const path of files) {
      const r = results.find((x) => x.name.endsWith(`/${path}`));
      if (!r) { unrun.push(`${path}: no result in the report`); continue; }
      if (r.status === 'failed' && !r.assertionResults.length) unrun.push(`${path}: ran no test: ${(r.message ?? '').slice(0, 800)}`);
      for (const a of r.assertionResults) if ((a.fullName ?? a.title).includes(route.criterion)) tagged.push({ file: path, a });
    }
    for (const { file, a } of tagged) {
      const name = `${file}: "${a.fullName ?? a.title}"`;
      const message = (a.failureMessages ?? []).join('\n');
      if (a.status === 'passed') continue;
      if (a.status === 'failed' && !UNRUN.test(message.trimStart())) failed.push(`${name} failed: ${message.slice(0, 1200)}`);
      else unrun.push(`${name} ${a.status}${message ? `: ${message.slice(0, 600)}` : ''}`);
    }
    expect(failed, `#3243.53a4911b ${route.criterion}'s tests (${by}) pass; these failed:\n  ${failed.join('\n  ')}`).toEqual([]);
    if (!tagged.length) unrun.push(`no test carrying ${route.criterion} ran in ${files.join(', ')}`);
    if (unrun.length) ctx.skip(`INCONCLUSIVE: ${route.criterion}'s tests reached no verdict: ${unrun.join('; ')}`);
    if (redraft) {
      expect(redraftTwin(route), `#3243.53a4911b the redraft deciding ${route.criterion} must prove its wrong program ${route.wrong} through its twins.json`).toEqual([]);
    } else {
      const wrong = tagged.filter(({ a }) => a.status === 'passed' && (a.fullName ?? a.title).includes(route.wrong));
      expect(wrong.length, `#3243.53a4911b ${route.criterion}'s check must fail on its wrong program ${route.wrong}: a passing test carrying the ID names it; the tagged tests were ${tagged.map(({ a }) => JSON.stringify(a.title)).join(', ')}`).toBeGreaterThan(0);
    }
    expect(child.code, `#3243.53a4911b the child Vitest exits 0: ${said}`).toBe(0);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

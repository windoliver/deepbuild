// #3178 AC1 `#3178.1821b407`: "The suites pass on main. Given main with the fix, when the #667, #27 and #111 files
// named above run, then each named test passes, or is replaced by a blind redraft that passes and fails on the wrong
// program its criterion names."
//
// Each row of the issue's table is run as the issue says: its file, by Vitest, in a child Vitest from the checkout's
// root, filtered to the row's criterion tags, with a JSON report read back. A blind redraft may stand in: a folder
// under the same suite whose path has a `redraft` segment, or a sibling folder `<suite>-…redraft…`, whose tests carry
// the tag or the criterion's computed ID (README, Readings); files scripts/lanes.mjs runs by hand (`byHand`) are none. Whether a redraft fails on its own criterion's wrong program is its own proof lane's question;
// the wrong programs for this file are its twins (twins.json).
//
// Each candidate (the named file, or one redraft folder) is: passed, when every test of it carrying the tag passed
// (for the named file, at least as many as the table names); failed, when one failed at an assertion; unrun, when the
// rest were skipped or ended BLOCKED or INCONCLUSIVE. A tag passes when the named tests passed. Otherwise the redrafts
// carrying it, when there are any, have replaced the named test and decide together: failed when one failed, else unrun
// when one is unrun, else passed. With none, the named file decides. A row fails when a tag failed; a row none failed with a tag unrun is skipped: unrun is never PASS or FAIL.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const ID = '#3178.1821b407';
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const VITEST = join(REPO, 'node_modules/vitest/vitest.mjs');

/** The issue's table: each failing file, with each criterion tag it names and how many tests carry it. */
const ROWS: { suite: string; file: string; tags: Record<string, number> }[] = [
  { suite: '667', file: 'tests/acceptance/667/redraft-1463/raised.test.ts', tags: { '#667.84442921': 1, '#667.b25a1d05': 1 } },
  { suite: '667', file: 'tests/acceptance/667/fold.test.ts', tags: { '#667.b1086458': 2 } },
  { suite: '667', file: 'tests/acceptance/667/plants.test.ts', tags: { '#667.ca2b4f95': 1, '#667.b1086458': 1 } },
  { suite: '27', file: 'tests/acceptance/27/repeat.test.ts', tags: { '#27.6e863673': 1 } },
  { suite: '27', file: 'tests/acceptance/27/waits.test.ts', tags: { '#27.e6116d56': 2 } },
  { suite: '27', file: 'tests/acceptance/27/desktop-redraft/desktop.test.ts', tags: { '#27.f8331d25': 1 } },
  { suite: '111', file: 'tests/acceptance/111/revive.test.ts', tags: { '#111.ddf55f68': 1 } },
];

/**
 * The same #667 criteria under the IDs `criterionId` computes from #667's body today, as the base's redrafts name them
 * (667/redraft-1463/README.md for AC1 and AC2; 667/redraft-2047/README.md for AC4 and AC5).
 */
const ALIAS: Record<string, string> = {
  '#667.84442921': '#667.254d6157', '#667.b25a1d05': '#667.8700acae', '#667.ca2b4f95': '#667.47e397e9', '#667.b1086458': '#667.b9deefc5',
};

type State = 'passed' | 'failed' | 'unrun';
interface Result { name: string; status: string; failure: string }
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const namesOf = (tag: string) => [tag, ...(ALIAS[tag] ? [ALIAS[tag]!] : [])];

/** Runs files in one child Vitest, filtered to `tags`; its tests' names, statuses and first failure lines. */
async function runFiles(files: readonly string[], tags: readonly string[]): Promise<{ results: Result[]; log: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'dh3178-'));
  const report = join(dir, 'report.json');
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(VITEST|TINYPOOL|DEEP_HUB_PLANT$)/.test(k)) env[k] = v;
  try {
    const log = await new Promise<string>((resolve) => {
      const child = spawn(process.execPath, [VITEST, 'run', ...files, '-t', tags.map(escape).join('|'), '--reporter=json', `--outputFile=${report}`], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.setEncoding('utf8').on('data', (d: string) => (out += d));
      child.stderr.setEncoding('utf8').on('data', (d: string) => (out += d));
      child.on('close', (code) => resolve(`${out}\n(exit ${code})`));
    });
    if (!existsSync(report)) return { results: files.map((f) => ({ name: `${f} (the file)`, status: 'failed', failure: `BLOCKED: the child Vitest wrote no report: ${log.slice(-600)}` })), log };
    const json = JSON.parse(readFileSync(report, 'utf8')) as { testResults: { name: string; assertionResults: { fullName: string; status: string; failureMessages?: string[] }[]; message?: string }[] };
    const results = json.testResults.flatMap((f) => [
      ...f.assertionResults.map((a) => ({ name: a.fullName, status: a.status, failure: (a.failureMessages ?? []).join('\n').split('\n').slice(0, 3).join(' | ').slice(0, 600) })),
      // A file that fails to load runs none of its tests: BLOCKED, never a failure of a test.
      ...(!f.assertionResults.length && f.message ? [{ name: `${relative(REPO, f.name)} (the file) ${tags.join(' ')}`, status: 'failed', failure: `BLOCKED: ${f.message.slice(0, 600)}` }] : []),
    ]);
    return { results, log };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** What the checkout's lanes run by hand: files, and folders ending in `/`. */
const { byHand } = (await import(pathToFileURL(join(REPO, 'scripts/lanes.mjs')).href)) as { byHand: string[] };
const runByHand = (file: string) => byHand.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * The redraft folders of a suite, each mapped to its test files: a folder under the suite with a `redraft` segment, or a
 * sibling folder named `<suite>-` and holding `redraft`; the named file, and files the lanes run by hand, left out.
 */
function redraftsOf(suite: string, named: string): Map<string, string[]> {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const at = join(dir, name);
    if (['node_modules', 'twins', 'fixtures'].includes(name)) return [];
    return statSync(at).isDirectory() ? walk(at) : /\.test\.ts$/.test(name) ? [relative(REPO, at)] : [];
  });
  const siblings = readdirSync(join(REPO, 'tests/acceptance')).filter((name) => name.startsWith(`${suite}-`) && /redraft/.test(name));
  const folders = new Map<string, string[]>();
  for (const file of [...walk(join(REPO, 'tests/acceptance', suite)), ...siblings.flatMap((name) => walk(join(REPO, 'tests/acceptance', name)))]) {
    const folder = dirname(file);
    const inSuite = folder === `tests/acceptance/${suite}` || folder.startsWith(`tests/acceptance/${suite}/`);
    if (file === named || runByHand(file) || (inSuite && !relative(`tests/acceptance/${suite}`, folder).split('/').some((s) => /redraft/.test(s)))) continue;
    folders.set(folder, [...(folders.get(folder) ?? []), file]);
  }
  return folders;
}

/** Whether a failure is a test that didn't run to its verdict: BLOCKED or INCONCLUSIVE in its first line. */
const unrunFailure = (r: Result) => /\b(BLOCKED|INCONCLUSIVE)\b/.test(r.failure.split(' | ')[0] ?? '');
/** A candidate's state for a tag: its tests whose names carry the tag or its alias. */
function stateOf(results: readonly Result[], tag: string, atLeast: number): State | undefined {
  const mine = results.filter((r) => namesOf(tag).some((n) => r.name.includes(n)));
  if (!mine.length && atLeast === 0) return undefined;
  if (mine.length < atLeast) return 'failed';
  if (mine.every((r) => r.status === 'passed')) return 'passed';
  if (mine.some((r) => r.status === 'failed' && !unrunFailure(r))) return 'failed';
  return 'unrun';
}
const show = (results: readonly Result[]) => results.map((r) => `${r.status}: ${r.name}${r.failure ? ` -- ${r.failure}` : ''}`).join('\n');

describe(`${ID} The suites pass on main`, () => {
  for (const row of ROWS) {
    it(`${ID} ${row.file}: ${Object.entries(row.tags).map(([t, n]) => (n > 1 ? `${t} ×${n}` : t)).join(', ')} pass, or a blind redraft that replaces them passes`, async (ctx) => {
      const tags = Object.keys(row.tags);
      const filter = tags.flatMap(namesOf);
      const named = await runFiles([row.file], tags);
      const seen: string[] = [`${row.file}:\n${show(named.results) || named.log.slice(-2000)}`];
      const redrafts: { folder: string; results: Result[] }[] = [];
      for (const [folder, files] of redraftsOf(row.suite, row.file)) {
        const { results } = await runFiles(files, filter);
        if (!results.length) continue;
        redrafts.push({ folder, results });
        seen.push(`${folder} (a redraft):\n${show(results)}`);
      }
      const verdict: Record<string, string> = {};
      for (const tag of tags) {
        const own = stateOf(named.results, tag, row.tags[tag]!)!;
        const stands = redrafts.map((r) => ({ folder: r.folder, state: stateOf(r.results, tag, 0) })).filter((r) => r.state !== undefined);
        const list = (state: State) => stands.filter((r) => r.state === state).map((r) => r.folder).join(', ');
        if (own === 'passed') verdict[tag] = 'passed';
        // One redraft passing never hides another failing: the redrafts carrying the tag replace the named test together.
        else if (stands.some((r) => r.state === 'failed')) verdict[tag] = `failed: ${list('failed')} failed`;
        else if (stands.some((r) => r.state === 'unrun')) verdict[tag] = `unrun: ${list('unrun')} didn't run to a verdict`;
        else if (stands.length) verdict[tag] = `replaced by ${list('passed')}, which passes`;
        else verdict[tag] = own === 'unrun' ? 'unrun: the named tests didn\'t run to a verdict' : 'failed: the named tests failed';
      }
      const failed = tags.filter((t) => verdict[t]!.startsWith('failed'));
      const unrun = tags.filter((t) => verdict[t]!.startsWith('unrun'));
      // Unrun is never a pass and never a failure: INCONCLUSIVE, by a skip the lanes count as no test.
      if (!failed.length && unrun.length) ctx.skip(`INCONCLUSIVE ${unrun.map((t) => `${t}: ${verdict[t]}`).join('; ')}\n${seen.join('\n\n')}`);
      expect(verdict, `${ID} each named test passes, or a blind redraft that replaces it passes:\n${seen.join('\n\n')}`)
        .toEqual(Object.fromEntries(tags.map((t) => [t, expect.stringMatching(/^(passed|replaced by .+, which passes)$/)])));
    }, 3_000_000);
  }
});

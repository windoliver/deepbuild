// Whose checks count (#29; design: How runs become one of five verdicts, Whose checks count). An approved check whose
// own files the claim's diff changed counts for that claim as the agent's own: it can send the claim back, never pass
// it. A check's own files are the tests, fixtures, expected outputs and runner config it declares, the package
// script, Makefile or justfile target it runs, and any other file its runs read under the repo's test, fixture and
// script folders. The code under test is an input for staleness, never an own file.
import { execFileSync } from 'node:child_process';
import { gitEnv } from './env.js';
import { matches } from './glob.js';

export interface ApprovedCheck {
  check: string;
  reads: string[];
  declares: { tests?: string[]; fixtures?: string[]; expected?: string[]; runner_config?: string[]; script?: { file: string; target: string } };
}
type SourcePlant = 'every-read-file-is-own' | 'declared-only' | 'ignores-script-target';

/** The folders a read file under is the check's own. */
const OWN_FOLDERS = new Set(['test', 'tests', '__tests__', 'fixtures', '__fixtures__', '__snapshots__', 'scripts', 'spec']);
const gitIn = (repo: string, args: string[]): string => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: gitEnv() });
const show = (repo: string, rev: string, path: string): string | null => {
  try { return gitIn(repo, ['show', `${rev}:${path}`]); } catch { return null; }
};

/** Whether a file a check's run read is its own: one under the repo's test, fixture and script folders. */
export const ownRead = (path: string): boolean => path.split('/').slice(0, -1).some((part) => OWN_FOLDERS.has(part));

/** A test runner's config, or pytest's conftest.py: the tool finds and loads it by its own rules, wherever it lies. */
const LOADED_BY_TOOL = /(^|\/)((vitest|vite|jest)\.config\.[cm]?[jt]s|vitest\.workspace\.[cm]?[jt]s|pytest\.ini|conftest\.py)$/;
export type ChangesPlant = 'edited-check-approved' | 'own-files-test-folders-only';
/**
 * The files a claim changed that are its check's own (#33; design: Whose checks count): among the files its runs read,
 * those under the repo's test, fixture and script folders; and, wherever they lie, the files the test tool loads by its
 * own discovery rules: a runner's config, pytest's conftest.py, and any file a runner config names, such as a setup
 * file; and the root package.json when its scripts changed and the run read it. `configs` holds each runner config
 * the claim's tree has, by path, with its text; `scripts`, whether the claim changed package.json's scripts.
 */
export function ownChanges(changes: { changed: readonly string[]; configs: ReadonlyMap<string, string>; scripts: boolean }, read: readonly string[], plant?: ChangesPlant): string[] {
  if (plant === 'edited-check-approved') return [];
  const { changed, configs } = changes;
  const reads = new Set(read);
  const named = (path: string): boolean => [...configs].some(([config, text]) => {
    const dir = config.includes('/') ? config.slice(0, config.lastIndexOf('/') + 1) : '';
    if (!path.startsWith(dir)) return false;
    const rel = path.slice(dir.length);
    return [rel, rel.replace(/\.[cm]?[jt]s$/, '')].some((name) => new RegExp(`['"\`](\\./)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(text));
  });
  // A package.json whose scripts changed, which the run read: the script target it runs is the check's own.
  const script = (path: string): boolean => path === 'package.json' && changes.scripts && reads.has(path);
  return changed.filter((path) => (reads.has(path) && ownRead(path)) || (plant !== 'own-files-test-folders-only' && (LOADED_BY_TOOL.test(path) || named(path) || script(path))));
}
/** Whether a path is a test runner's config, whose text names the files the tool loads. */
export const runnerConfig = (path: string): boolean => LOADED_BY_TOOL.test(path) && !path.endsWith('conftest.py');

/**
 * What a script target runs, from a file's text: a package.json script, or every Makefile or justfile rule that names
 * the target, each from its header line to the end of its recipe. A Makefile rule names each word before its colon,
 * and make merges the rules that name one target; a justfile recipe names its first word, the rest being parameters.
 * The gate's one reader of a command's script (#1888): whose checks count reads it here, and the floor's mask reading
 * in floor.ts.
 */
export function targetBody(file: string, text: string | null, target: string): string | null {
  if (text === null) return null;
  if (file.endsWith('package.json')) {
    try { return (JSON.parse(text) as { scripts?: Record<string, string> }).scripts?.[target] ?? null; } catch { return null; }
  }
  const just = /(^|\/)justfile$/i.test(file);
  const lines = text.split('\n');
  const rules: string[] = [];
  lines.forEach((header, at) => {
    const names = header.replace(/\s*:.*$/, '').trim().split(/\s+/);
    if (!(just ? names.slice(0, 1) : names).includes(target) || !/^[^\s#][^:=]*:(?!=)/.test(header)) return;
    const body = [header];
    for (const l of lines.slice(at + 1)) { if (!/^\s/.test(l)) break; body.push(l); }
    rules.push(body.join('\n').trimEnd());
  });
  return rules.length ? rules.join('\n') : null;
}

export function checkSource(check: ApprovedCheck, diff: { repo: string; from: string; to: string }, options: { plant?: SourcePlant } = {}): 'approved' | 'own' {
  const { plant } = options;
  const changed = gitIn(diff.repo, ['diff', '--name-only', '--no-renames', diff.from, diff.to]).split('\n').filter(Boolean);
  const d = check.declares;
  const declared = [...(d.tests ?? []), ...(d.fixtures ?? []), ...(d.expected ?? []), ...(d.runner_config ?? [])];
  const reads = new Set(check.reads);
  const own = (path: string): boolean => {
    if (declared.some((g) => matches(g, path))) return true;
    if (plant === 'declared-only' || !reads.has(path)) return false;
    return plant === 'every-read-file-is-own' || ownRead(path);
  };
  if (changed.some(own)) return 'own';
  const script = d.script;
  if (script && plant !== 'ignores-script-target' && changed.includes(script.file)) {
    const before = targetBody(script.file, show(diff.repo, diff.from, script.file), script.target);
    const after = targetBody(script.file, show(diff.repo, diff.to, script.file), script.target);
    if (before !== after) return 'own';
  }
  return 'approved';
}

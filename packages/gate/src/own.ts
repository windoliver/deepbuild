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
type Changes = { changed: readonly string[]; configs: ReadonlyMap<string, string>; scripts: boolean };
/**
 * Of a claim's changed files, those the test tool loads whatever a run read: a runner's config, or a file one names.
 * They depend only on the claim's changes, so they are worked out once per claim (#2647), keyed by its changes.
 */
const loadedOf = new WeakMap<Changes, ReadonlySet<string>>();
function loadedByTool(changes: Changes): ReadonlySet<string> {
  const known = loadedOf.get(changes);
  if (known) return known;
  const named = (path: string): boolean => [...changes.configs].some(([config, text]) => {
    const dir = config.includes('/') ? config.slice(0, config.lastIndexOf('/') + 1) : '';
    if (!path.startsWith(dir)) return false;
    const rel = path.slice(dir.length);
    return [rel, rel.replace(/\.[cm]?[jt]s$/, '')].some((name) => new RegExp(`['"\`](\\./)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`).test(text));
  });
  const loaded = new Set(changes.changed.filter((path) => LOADED_BY_TOOL.test(path) || named(path)));
  loadedOf.set(changes, loaded);
  return loaded;
}
export function ownChanges(changes: Changes, read: readonly string[], plant?: ChangesPlant): string[] {
  if (plant === 'edited-check-approved') return [];
  const reads = new Set(read);
  const script = (path: string): boolean => path === 'package.json' && changes.scripts && reads.has(path);
  const loaded = plant === 'own-files-test-folders-only' ? undefined : loadedByTool(changes);
  return changes.changed.filter((path) => (reads.has(path) && ownRead(path)) || (loaded !== undefined && (loaded.has(path) || script(path))));
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

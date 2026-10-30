// Whose checks count (#29; design: How runs become one of five verdicts, Whose checks count). An approved check whose
// own files the claim's diff changed counts for that claim as the agent's own: it can send the claim back, never pass
// it. A check's own files are the tests, fixtures, expected outputs and runner config it declares, the package
// script, Makefile or justfile target it runs, and any other file its runs read under the repo's test, fixture and
// script folders. The code under test is an input for staleness, never an own file.
import { execFileSync } from 'node:child_process';
import { matches } from './glob.js';

export interface ApprovedCheck {
  check: string;
  reads: string[];
  declares: { tests?: string[]; fixtures?: string[]; expected?: string[]; runner_config?: string[]; script?: { file: string; target: string } };
}
export type SourcePlant = 'every-read-file-is-own' | 'declared-only' | 'ignores-script-target';

/** The folders a read file under is the check's own. */
const OWN_FOLDERS = new Set(['test', 'tests', '__tests__', 'fixtures', '__fixtures__', '__snapshots__', 'scripts', 'spec']);
const gitIn = (repo: string, args: string[]): string => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const show = (repo: string, rev: string, path: string): string | null => {
  try { return gitIn(repo, ['show', `${rev}:${path}`]); } catch { return null; }
};

/** What a script target runs, from a file's text: a package.json script, or a Makefile or justfile recipe. */
export function targetBody(file: string, text: string | null, target: string): string | null {
  if (text === null) return null;
  if (file.endsWith('package.json')) {
    try { return (JSON.parse(text) as { scripts?: Record<string, string> }).scripts?.[target] ?? null; } catch { return null; }
  }
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.replace(/\s*:.*$/, '').trim().split(/\s+/).includes(target) && /^[^\s#][^:=]*:(?!=)/.test(l));
  if (at < 0) return null;
  const body = [lines[at]!];
  for (const l of lines.slice(at + 1)) { if (!/^\s/.test(l)) break; body.push(l); }
  return body.join('\n').trimEnd();
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
    return plant === 'every-read-file-is-own' || path.split('/').slice(0, -1).some((part) => OWN_FOLDERS.has(part));
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

// Shared by #3528's acceptance tests (README: Surfaces). Git and the repo rules run as processes with cwd at this
// checkout, read-only. A tree other than the work tree's index is given to them as a temporary index file
// (GIT_INDEX_FILE) under the realpathed system temporary folder, removed after the suite. Nothing here writes into this
// checkout, and no message prints a local path.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

/** Each criterion's ID: `#3528.` and the first 8 hex digits of the SHA-256 of its text from the issue, trimmed, with
 * white space collapsed (`criterionId` in scripts/proof-change.mjs). */
export const GONE = '#3528.6d9e9cc1';
export const RULE = '#3528.10044f94';
export const DIFF = '#3528.36ac6187';

/** The two files a merge tool left behind, and the five that Cargo's own packaging wrote, which stay. */
export const LEFTOVERS = ['crates/deep-gpu-layer/src/view3d.rs.orig', 'crates/deep-scene3d-render/src/lib.rs.orig'];
export const VENDORED = ['accesskit_macos', 'gpui-pre-apple', 'gpui-pre-macos', 'gpui-pre', 'symphonia-codec-vorbis'].map((name) => `vendor/${name}/Cargo.toml.orig`).sort();
export const PLANT = 'crates/deep-app/src/main.rs.rej';
/** This suite's own folder, which names the two paths and is part of the change. */
export const SUITE = 'tests/acceptance/3528/';

/** The environment without git's repository variables, plus `extra`. */
export const env = (extra = {}) => ({ ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))), ...extra });

/** git in this checkout; its output. */
export const git = (args, extra) => execFileSync('git', args, { cwd: root, env: env(extra), encoding: 'utf8', maxBuffer: 1 << 28 });

/** The merge base of HEAD with origin/main, which must hold both leftovers; without it there is no before. */
export function mergeBase() {
  let base;
  try {
    base = git(['merge-base', 'HEAD', 'origin/main']).trim();
  } catch {
    throw new Error('BLOCKED: no merge base of HEAD with origin/main (git fetch origin main)');
  }
  const tracked = git(['ls-tree', '-r', '--name-only', base, '--', ...LEFTOVERS]).split('\n').filter(Boolean);
  if (tracked.length !== LEFTOVERS.length) throw new Error(`BLOCKED: the merge base ${base.slice(0, 9)} doesn't hold both files, so it is no before for #3528`);
  return base;
}

/** A new folder under the realpathed system temporary folder. */
export const scratch = () => realpathSync(mkdtempSync(`${realpathSync(tmpdir())}/deep-3528-`));

/**
 * Runs the lint lane's repo rules, `node scripts/repo-rules.mjs`, with cwd at this checkout and `extra` in its
 * environment. Waits for its exit; a run that is stopped or can't start is INCONCLUSIVE, never a verdict.
 */
export const repoRules = (extra) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/repo-rules.mjs'], { cwd: root, env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
  child.stderr.resume();
  child.on('error', (error) => reject(new Error(`INCONCLUSIVE: scripts/repo-rules.mjs didn't start (${error.code})`)));
  child.on('close', (status, signal) => {
    if (signal) reject(new Error(`INCONCLUSIVE: scripts/repo-rules.mjs was stopped (${signal})`));
    else resolve({ status, lines: stdout.split('\n').filter(Boolean) });
  });
});

/** The lines of a run in a state that fails it. */
export const failing = (run) => run.lines.filter((line) => /^(?:FAIL|INVALID|BLOCKED) /.test(line));

/** A run's output for a failure message: its failing lines and their Fix lines, else its first lines. */
export function show(run) {
  const lines = failing(run).length ? run.lines.filter((line, i) => /^(?:FAIL|INVALID|BLOCKED) /.test(line) || /^(?:FAIL|INVALID|BLOCKED) /.test(run.lines[i - 1] ?? '')) : run.lines;
  return `exit ${run.status}; ${run.lines.length} lines, of them:\n${lines.slice(0, 30).join('\n')}`;
}

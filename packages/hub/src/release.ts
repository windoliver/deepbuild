// Done means switched on (#325; design: Done means switched on): a pull request's claim also runs the repo's release
// checks, named in `.deepbuild/done.yaml` under `release: { checks: [...] }`, on the PR's commit merged with main; and
// a change that adds a switch, flag or schedule to the file `switches: { file, deployed }` names, whose deployed
// value is off or unset, can't say Closes until you decide it stays off. This module reads the spec and git; the core
// runs the checks and asks.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the repo's spec says of delivery: its release checks, by name, and where its switches and their deployed values live. */
interface ReleaseSpec { checks: string[]; switches: { file: string; deployed: string } | null }
export function releaseSpec(cwd: string): ReleaseSpec {
  let spec: unknown;
  try { spec = parseYaml(readFileSync(join(cwd, '.deepbuild', 'done.yaml'), 'utf8')); } catch { return { checks: [], switches: null }; }
  if (!isObj(spec)) return { checks: [], switches: null };
  const checks = isObj(spec.release) && Array.isArray(spec.release.checks) ? spec.release.checks.map(String) : [];
  const s = spec.switches;
  const switches = isObj(s) && typeof s.file === 'string' && typeof s.deployed === 'string' ? { file: s.file, deployed: s.deployed } : null;
  return { checks, switches };
}

/** Git with none of this process's git settings, so a run reads the repo alone. */
function git(cwd: string, args: string[], env: Record<string, string> = {}): Promise<{ ok: boolean; out: string }> {
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))) as Record<string, string>;
  return new Promise((done) => execFile('git', ['-C', cwd, '-c', 'core.hooksPath=/dev/null', ...args], { env: { ...base, ...env }, timeout: 20_000 }, (error, out) => done({ ok: !error, out: String(out ?? '').trim() })));
}

/** The repo's main line: its local `main`, else `master`; undefined when it has neither. */
async function mainOf(cwd: string): Promise<string | undefined> {
  for (const name of ['main', 'master']) {
    const r = await git(cwd, ['rev-parse', '--verify', '-q', `refs/heads/${name}^{commit}`]);
    if (r.ok && /^[0-9a-f]{40}$/.test(r.out)) return r.out;
  }
  return undefined;
}

/**
 * The PR's head merged with main, as a commit the release checks run on: written into the repo's objects with a fixed
 * author and date, so the same head and main give the same commit, and no ref, index or file of the worktree changes.
 * The head itself when main is already in it; a conflict when the two don't merge; undefined with no main.
 */
export async function mergedWithMain(cwd: string, head: string): Promise<{ commit: string; main: string } | { conflict: string } | undefined> {
  const main = await mainOf(cwd);
  if (!main) return undefined;
  if (main === head || (await git(cwd, ['merge-base', '--is-ancestor', main, head])).ok) return { commit: head, main };
  const tree = await git(cwd, ['merge-tree', '--write-tree', '--no-messages', head, main]);
  const id = tree.out.split('\n')[0] ?? '';
  if (!tree.ok || !/^[0-9a-f]{40}$/.test(id)) return { conflict: `${head.slice(0, 12)} doesn't merge with main ${main.slice(0, 12)} without conflicts` };
  const fixed = { GIT_AUTHOR_NAME: 'DeepBuild', GIT_AUTHOR_EMAIL: 'deepbuild@localhost', GIT_COMMITTER_NAME: 'DeepBuild', GIT_COMMITTER_EMAIL: 'deepbuild@localhost', GIT_AUTHOR_DATE: '1970-01-01T00:00:00Z', GIT_COMMITTER_DATE: '1970-01-01T00:00:00Z' };
  const commit = await git(cwd, ['commit-tree', id, '-p', head, '-p', main, '-m', `DeepBuild: ${head} merged with main ${main}`], fixed);
  return commit.ok && /^[0-9a-f]{40}$/.test(commit.out) ? { commit: commit.out, main } : { conflict: `the merge of ${head.slice(0, 12)} with main couldn't be written` };
}

const OFF = new Set<unknown>([false, null, 0, 'off', 'false']);
/**
 * The switches a change adds that aren't on where it's deployed: each key of the switches file in the worktree that
 * the file at `base` lacks, whose value in the deployed configuration is off, or unset when it has none.
 */
export async function switchesOff(cwd: string, base: string, switches: { file: string; deployed: string }): Promise<{ name: string; state: 'off' | 'unset' }[]> {
  const json = (text: string | undefined): Obj => { try { const v: unknown = JSON.parse(text ?? ''); return isObj(v) ? v : {}; } catch { return {}; } };
  const read = (path: string): string | undefined => { try { return readFileSync(join(cwd, path), 'utf8'); } catch { return undefined; } };
  const now = json(read(switches.file));
  const before = await git(cwd, ['show', `${base}:${switches.file}`]);
  const was = before.ok ? json(before.out) : {};
  const deployed = json(read(switches.deployed));
  return Object.keys(now).filter((k) => !(k in was)).flatMap((name): { name: string; state: 'off' | 'unset' }[] => {
    if (!(name in deployed)) return [{ name, state: 'unset' }];
    return OFF.has(deployed[name]) ? [{ name, state: 'off' }] : [];
  });
}

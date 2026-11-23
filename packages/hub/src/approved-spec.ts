// The approved revision of a repo's spec (#1864; design: Protection). A claim's spec checks, its done list, its
// release checks and its `outside` block come from `.deepbuild/done.yaml` as the claim's base commit holds it, never
// from the file in the folder the agent works in, which a command's child can write with no guard seeing it.
import { execFile } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { gitEnv } from '@deepbuild/gate';
import { parseYaml } from './yaml.js';

export const SPEC = '.deepbuild/done.yaml';
interface Revision { text: string; oid: string }
/** Each commit's spec, read once: a commit never changes. */
const read = new Map<string, Revision | undefined>();
/**
 * Git off the hub's event loop, with none of this process's git location settings, and nothing of the repo's that runs a
 * program or swaps an object: no hooks, fsmonitor or lazy fetch, and no replace refs, as the gate's checkouts read it.
 */
const git = (folder: string, args: string[]): Promise<string> => new Promise((done, fail) => execFile('git', ['-C', folder, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { env: { ...gitEnv(), GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20_000 }, (error, out) => (error ? fail(error) : done(out))));

/**
 * The spec as `base` holds it in the repo `folder` is in, with its blob's id: undefined when that commit has none, and
 * for a folder with no commit to hold one (no base, or an unborn HEAD's zeros). A base that isn't a commit id, or that
 * can't be read, throws: its revision is unknown, never the worktree's.
 */
async function specAt(folder: string, base: string): Promise<Revision | undefined> {
  if (base === '' || /^0+$/.test(base)) return undefined;
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(base)) throw Error(`the claim's base ${base.slice(0, 64)} is no commit, so the revision of ${SPEC} you approved is unknown`);
  const key = `${folder}\n${base}`;
  if (read.has(key)) return read.get(key);
  let revision: Revision | undefined;
  try {
    const entry = /^(\d+) \w+ ([0-9a-f]+)\t/.exec(await git(folder, ['ls-tree', base, '--', `./${SPEC}`]));
    // A spec is a file: a link or a folder in its place at the base holds no revision you approved, so the claim is BLOCKED.
    if (entry && !['100644', '100755'].includes(entry[1]!)) throw Error(`mode ${entry[1]}`);
    revision = entry ? { text: await git(folder, ['cat-file', 'blob', entry[2]!]), oid: entry[2]! } : undefined;
  } catch (error) {
    const why = error instanceof Error && /^mode \d+$/.test(error.message) ? `is no file there (${error.message})` : "couldn't be read there";
    throw Error(`${SPEC} ${why} at the claim's base commit ${base.slice(0, 12)}, so the revision you approved is unknown`);
  }
  if (read.size >= 256) read.delete(read.keys().next().value!);
  read.set(key, revision);
  return revision;
}

/**
 * The revision of the repo's spec you approved (design: Protection), as `base` holds it: no spec approval is kept
 * apart from the repo's history yet, so the base commit stands in, never the worktree. `parsed` is false for a text
 * that doesn't parse, which the claim names as BLOCKED.
 */
export async function approvedSpec(folder: string, base: string): Promise<{ text: string | undefined; oid: string | undefined; spec: unknown; parsed: boolean }> {
  const revision = await specAt(folder, base);
  if (!revision) return { text: undefined, oid: undefined, spec: undefined, parsed: true };
  try { return { ...revision, spec: parseYaml(revision.text), parsed: true }; } catch { return { ...revision, spec: undefined, parsed: false }; }
}

/**
 * The blob id of the spec's bytes in `folder` now, with none of the repo's filters run; undefined when there is none,
 * and a placeholder for anything there that is no file, which never equals a revision's id.
 */
export async function specOnDisk(folder: string): Promise<string | undefined> {
  let file;
  try { file = lstatSync(join(folder, SPEC)); } catch { return undefined; }
  if (!file.isFile()) return `not a file`;
  return (await git(folder, ['hash-object', '--no-filters', '--', `./${SPEC}`])).trim();
}

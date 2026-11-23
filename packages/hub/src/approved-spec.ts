// The approved revision of a repo's spec (#1864; design: Protection). A claim's spec checks, its done list, its
// release checks and its `outside` block come from `.deepbuild/done.yaml` as the claim's base commit holds it, never
// from the file in the folder the agent works in, which a command's child can write with no guard seeing it.
import { execFile } from 'node:child_process';
import { gitEnv } from '@deepbuild/gate';
import { parseYaml } from './yaml.js';

export const SPEC = '.deepbuild/done.yaml';
/** Each commit's spec, read once: a commit never changes. */
const read = new Map<string, string | undefined>();
/** Git off the hub's event loop, with none of this process's git location settings. */
const git = (folder: string, args: string[]): Promise<string> => new Promise((done, fail) => execFile('git', ['-C', folder, ...args], { env: gitEnv(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20_000 }, (error, out) => (error ? fail(error) : done(out))));

/**
 * The spec as `base` holds it in the repo `folder` is in: undefined when that commit has none, and for a folder with
 * no commit to hold one. A base commit that can't be read throws: its revision is unknown, never the worktree's.
 */
export async function specAt(folder: string, base: string): Promise<string | undefined> {
  if (!/^[0-9a-f]{40}$/.test(base) || /^0+$/.test(base)) return undefined;
  const key = `${folder}\n${base}`;
  if (read.has(key)) return read.get(key);
  let text: string | undefined;
  try {
    text = (await git(folder, ['ls-tree', base, '--', `./${SPEC}`])).trim() ? await git(folder, ['show', `${base}:./${SPEC}`]) : undefined;
  } catch {
    throw Error(`${SPEC} couldn't be read at the claim's base commit ${base.slice(0, 12)}, so the revision you approved is unknown`);
  }
  read.set(key, text);
  return text;
}

/**
 * The revision of the repo's spec you approved (design: Protection), as `base` holds it: no spec approval is kept
 * apart from the repo's history yet, so the base commit stands in, never the worktree. `parsed` is false for a text
 * that doesn't parse, which the claim names as BLOCKED.
 */
export async function approvedSpec(folder: string, base: string): Promise<{ text: string | undefined; spec: unknown; parsed: boolean }> {
  const text = await specAt(folder, base);
  if (text === undefined) return { text, spec: undefined, parsed: true };
  try { return { text, spec: parseYaml(text), parsed: true }; } catch { return { text, spec: undefined, parsed: false }; }
}

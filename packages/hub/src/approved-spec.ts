// The approved revision of a repo's spec (#1864, #3466; design: Protection). A claim's spec checks, its done list, its
// release checks and its `outside` block come from the revision of `.deepbuild/done.yaml` you approved, which the hub
// keeps by digest; until a repo has one, from the file as the claim's base commit holds it. Never from the file in the
// folder the agent works in, which a command's child can write with no guard seeing it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { gitEnv } from '@deepbuild/gate';
import { ulid, type Connection, type RecordStore } from '@deepbuild/record';
import { repoOf } from './shared-runs.js';
import { parseYaml } from './yaml.js';

export const SPEC = '.deepbuild/done.yaml';
interface Revision { text: string; oid: string }
/** What a kept revision's decisions hold beside its bytes: the checkout the approved file was written in, and the digests of the revisions your approvals replaced. */
interface Kept { root: string; before: string[] }
/** Each commit's spec and each kept revision's blob id, read once: neither a commit nor kept bytes ever change. */
const read = new Map<string, Revision | undefined>();
/**
 * Git off the hub's event loop, with none of this process's git location settings, and nothing of the repo's that runs a
 * program or swaps an object: no hooks, fsmonitor or lazy fetch, and no replace refs, as the gate's checkouts read it.
 */
const git = (folder: string, args: string[], input?: string): Promise<string> => new Promise((done, fail) => {
  const child = execFile('git', ['-C', folder, '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', ...args], { env: { ...gitEnv(), GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1' }, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20_000 }, (error, out) => (error ? fail(error) : done(out)));
  if (input !== undefined) child.stdin?.end(input);
});
const keep = (key: string, revision: Revision | undefined): void => {
  if (read.size >= 256) read.delete(read.keys().next().value!);
  read.set(key, revision);
};

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
  keep(key, revision);
  return revision;
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
/** A repo's key in the record: its common git folder's, which every worktree of the repo shares. */
const keyOf = async (folder: string): Promise<string> => sha256(`approved spec\n${await repoOf(folder)}`);
const topOf = async (folder: string): Promise<string> => (await git(folder, ['rev-parse', '--show-toplevel'])).trim();

/**
 * Keeps `text` as the revision of the spec you approved for the repo `folder` is in (#3466), as a drafted check's
 * approved bytes are kept: the bytes in the evidence store, and their digest cited by a decision the core holds for
 * the repo, as it holds project trust (#348), so the revision outlives the hub's process and no retention pass lets
 * the bytes go. The decision also cites `was`, the revision it replaces, and says where the approved file is written,
 * the checkout `folder` is in. `ask` is the ask you answered. The one entry that sets a repo's revision.
 */
async function approveSpec(record: Pick<RecordStore, 'keep' | 'append'>, connection: Connection, now: () => number, folder: string, text: string, was: string, ask: string): Promise<void> {
  const key = await keyOf(folder);
  const evidence: string[] = [];
  for (const bytes of [text, was]) evidence.push((await record.keep(connection, { bytes: new TextEncoder().encode(bytes), kind: 'spec', source: SPEC })).replace(/^ev:/, ''));
  await record.append(connection, { v: 1, id: ulid(now()), kind: 'decision.created', ts: now(), data: { key, scope: `repo:${key.slice(0, 32)}`, answer: `approved in ${await topOf(folder)}`, ask }, evidence });
}

/** The revision kept for the repo `folder` is in, with the blob id its bytes have there; undefined for a repo with none. */
async function keptSpec(record: Pick<RecordStore, 'raw' | 'resolve'>, folder: string): Promise<(Revision & { kept: Kept }) | undefined> {
  const rows = (await record.raw(`SELECT evidence, json_extract(data, '$.answer') AS answer FROM events WHERE kind = 'decision.created' AND writer = 'core' AND json_extract(data, '$.key') = ? ORDER BY log_pos DESC`, [await keyOf(folder)])) as { evidence: string | null; answer: string }[];
  if (!rows[0]) return undefined;
  const cited = rows.flatMap((row) => JSON.parse(row.evidence ?? '[]') as string[]);
  const sha = cited[0];
  const kept = { root: rows[0].answer.replace(/^approved in /, ''), before: cited.filter((digest) => digest !== sha) };
  const key = `${folder}\nev:${sha}`;
  const known = read.get(key);
  if (known) return { ...known, kept };
  // Bytes the store no longer holds are a revision nobody can read: the claim is BLOCKED, never judged on another file.
  const bytes = sha ? await record.resolve(`ev:${sha}`) : undefined;
  if (!bytes) throw Error(`the revision of ${SPEC} you approved (${sha ?? 'no digest'}) is not in the evidence store, so it is unknown`);
  const revision = { text: bytes.text, oid: (await git(folder, ['hash-object', '--stdin'], bytes.text)).trim() };
  keep(key, revision);
  return { ...revision, kept };
}

/**
 * The revision of the repo's spec you approved (design: Protection): the one kept for the repo (#3466), in any of
 * its worktrees and whatever `base` holds; until the repo has one, the spec as `base` holds it stands in, never the
 * worktree. `parsed` is false for a text that doesn't parse, which the claim names as BLOCKED.
 */
export async function approvedSpec(folder: string, base: string, record: Pick<RecordStore, 'raw' | 'resolve'>): Promise<{ text: string | undefined; oid: string | undefined; spec: unknown; parsed: boolean; kept?: Kept }> {
  const revision = await keptSpec(record, folder) ?? await specAt(folder, base);
  if (!revision) return { text: undefined, oid: undefined, spec: undefined, parsed: true };
  try { return { ...revision, spec: parseYaml(revision.text), parsed: true }; } catch { return { ...revision, spec: undefined, parsed: false }; }
}

/**
 * A change you approved to the spec of the repo `folder` is in (#3466; the box's, #1998), made to the revision you
 * approved, the kept one or until the repo has one its HEAD's, and kept as the repo's revision. It is never made to
 * the file on disk, whose bytes nobody approved. One that changes nothing there, or a repo with no spec yet, keeps none.
 */
export async function approveChange(record: Pick<RecordStore, 'raw' | 'resolve' | 'keep' | 'append'>, connection: Connection, now: () => number, folder: string, change: (text: string) => string | undefined, ask: string): Promise<void> {
  const head = (await git(folder, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']).catch(() => '')).trim();
  const { text } = await approvedSpec(folder, head, record);
  const next = text === undefined ? undefined : change(text);
  if (next !== undefined && text !== undefined) await approveSpec(record, connection, now, folder, next, text, ask);
}

/**
 * Whether the kept revision has not reached the checkout `folder` is in (#3466): the file there, blob `is`, is what
 * the checkout's HEAD holds, a revision an approval of yours replaced, on a history that never held the kept one, and
 * the checkout is not the one the approved file was written in. That file is the change you approved, waiting for its
 * commit to arrive, so it is never proposed again. A write, or a later commit, that takes the kept revision out of a
 * checkout is a difference wherever it is.
 */
async function unreached(folder: string, is: string, oid: string, kept: Kept): Promise<boolean> {
  const head = (await git(folder, ['rev-parse', '--verify', '-q', 'HEAD^{commit}']).catch(() => '')).trim();
  const at = await specAt(folder, head).catch(() => undefined);
  return at?.oid === is && kept.before.includes(sha256(at.text)) && await topOf(folder) !== kept.root
    && !(await git(folder, ['log', '--full-history', '--format=', '--raw', '--no-abbrev', head, '--', `./${SPEC}`])).includes(` ${oid} `);
}

/**
 * How the spec in a claim's `folder` differs from the `approved` revision, as blob ids (#1864): undefined when it
 * doesn't, or when it is a kept revision's that hasn't reached the checkout. Blob ids of the bytes as they are: no repo
 * filter runs, since a clean filter is a program the repo names, so a checkout that converts line endings shows as a
 * difference.
 */
export async function specDrift(folder: string, approved: { oid: string | undefined; kept?: Kept }): Promise<{ was: string | undefined; is: string | undefined } | undefined> {
  const is = await specOnDisk(folder);
  if (approved.oid === is || (approved.kept && approved.oid && is && await unreached(folder, is, approved.oid, approved.kept))) return undefined;
  return { was: approved.oid, is };
}

/**
 * The blob id of the spec's bytes in `folder` now, with none of the repo's filters run; undefined when there is none,
 * and a placeholder for anything there that is no file, which never equals a revision's id.
 */
async function specOnDisk(folder: string): Promise<string | undefined> {
  let file;
  try { file = lstatSync(join(folder, SPEC)); } catch { return undefined; }
  if (!file.isFile()) return `not a file`;
  return (await git(folder, ['hash-object', '--no-filters', '--', `./${SPEC}`])).trim();
}

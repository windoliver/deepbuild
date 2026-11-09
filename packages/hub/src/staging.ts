// Staging for destructive commands (#347; design: Before each command, "Destructive commands you approved"). A delete
// whose reach can't be worked out before it runs, such as an agent-written script's or one over a pattern, runs only
// after the folders it names (deep-hook reads them, hook.request@3's `stage`) are cloned copy-on-write under
// <root>/staged/<id>, within a ceiling on files and seconds below the hold, so the run can be undone from the copy
// (`deep undo staged:<id>`) until the copy is let go at its set time. A copy that would pass a ceiling is dropped,
// and the command becomes an authority ask that says its reach is unknown, as on a file system that can't clone.
//
// A command that discards uncommitted edits to tracked files (#1294) is staged the same way, file by file: each edited
// file git lists under what it reaches, or each file of the stash entries it drops, is copied with its digest under
// <root>/staged/<id>/files, and undo puts each back by that digest. With nothing edited there's nothing to stage or ask.
//
// Settings: `staging` in <root>/config.json, `{ files, seconds, keep }`; `seconds` is held below the hold.
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, readFileSync } from 'node:fs';
import { lstat, mkdir, open, readdir, readlink, rm, stat, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gitEnv } from '@deepbuild/gate';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import type { Holds } from './holds.js';
import { deepHook } from './paths.js';
import { refusal, Refused, STAGE_HOLD_MS, type Gated, type HookMeta, type Plant, type StageReach } from './wire.js';

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
/** The ceilings and the set time when config.json says nothing. */
const DEFAULTS = { files: 10_000, seconds: 10, keepMs: 3 * UNITS.d! };
/** The seconds ceiling is held this far below the hold, leaving room to raise the ask. */
const MAX_SECONDS = STAGE_HOLD_MS / 1000 - 5;
/** A copy with no staging in the record (a crash between clone and append) is let go after this long. */
const ORPHAN_MS = UNITS.h!;
/** How many edited files are copied at once. */
const COPIES = 8;
/** What git is given to read a tree or a stash, inside the hold. */
const GIT_MS = 8_000;

interface Settings { files: number; seconds: number; keepMs: number }
/** `staging` in <root>/config.json, each value held to what the hold allows. */
function settings(root: string): Settings {
  let given: { files?: unknown; seconds?: unknown; keep?: unknown } = {};
  try {
    const config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')) as { staging?: typeof given };
    if (typeof config.staging === 'object' && config.staging !== null) given = config.staging;
  } catch { /* none: the defaults */ }
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const keep = typeof given.keep === 'string' ? /^(\d+)([mhd])$/.exec(given.keep) : null;
  return {
    files: positive(given.files) ? Math.floor(given.files as number) : DEFAULTS.files,
    seconds: Math.min(positive(given.seconds) ? (given.seconds as number) : DEFAULTS.seconds, MAX_SECONDS),
    keepMs: keep ? Number(keep[1]) * UNITS[keep[2]!]! : DEFAULTS.keepMs,
  };
}

interface StagingOptions {
  root: string;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  now(): number;
  plant: Plant | undefined;
  append(connection: Connection, input: EventInput): Promise<void>;
  connection(session: string, agent: string): Connection;
  holds: Holds;
}

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
/** Whether a path exists, not following a link. */
const there = (path: string) => stat(path).then(() => true, () => false);

/** One file a discard would lose: where it lives, and how its copy is made at `to`, stopped at `deadline`. */
interface Lost { path: string; write(to: string, deadline: number): Promise<string | undefined> }

export class Staging {
  private readonly dir: string;
  constructor(private readonly o: StagingOptions) {
    this.dir = join(o.root, 'staged');
  }

  /**
   * A PreToolUse whose delete can't be worked out: staged, recorded, and let through; or held by an authority ask that
   * says its reach is unknown. `ask` false is a session nobody can be asked from: what can't be staged is denied.
   */
  async gate(meta: HookMeta, call: Gated, ask: boolean): Promise<{ held?: string; deny?: string }> {
    const command = call.command ?? call.label;
    const { folders, edits, stash } = call.stage ?? {};
    const k = this.o.holds.keyOf({ source: 'command.unstageable', session: meta.session, command, folders: folders ?? null, ...(edits !== undefined ? { edits } : {}), ...(stash !== undefined ? { stash } : {}) });
    if (ask) {
      // Once you said yes, the same call runs unstaged; while the ask waits, or after a no, it is held by it.
      const prior = await this.o.holds.prior(k);
      if (prior === 'allow') return {};
      if (prior) return { held: await this.o.holds.waiting(prior, command) };
    }
    const why = await this.reach(meta, command, call.stage ?? {});
    if (why === undefined) return {};
    if (!ask) return { deny: `DeepBuild blocked this: what \`${command}\` deletes can't be staged first (${why}), and this session can't be asked.` };
    const question = `Run \`${command}\` unstaged? Its reach is unknown: ${why}, so no copy-on-write copy can be kept to undo it from. Your yes runs it as it is.`;
    return { held: await this.o.holds.holdUnstaged(meta, k, command, question) };
  }

  /** Stages what the call reaches: undefined once its copies are made and recorded, or why they can't be. */
  private async reach(meta: HookMeta, command: string, { folders, edits, stash }: StageReach): Promise<string | undefined> {
    if (folders === null || edits === null || stash === null) return 'it names a folder through a value the line can\'t know';
    const why = folders ? await this.stage(meta, command, folders) : undefined;
    return why ?? (edits || stash ? await this.stageFiles(meta, command, edits ?? [], stash) : undefined);
  }

  /** Copies each file `paths` and the dropped stash entries would lose: undefined once recorded or with none, or why it can't be. */
  private async stageFiles(meta: HookMeta, command: string, paths: string[], stash: string[] | undefined): Promise<string | undefined> {
    const { files, seconds, keepMs } = settings(this.o.root);
    const deadline = Date.now() + seconds * 1000;
    let lost: Lost[];
    try {
      lost = [...await edited(paths), ...(stash ? await stashed(stash[0]!, stash[1]) : [])];
    } catch (error) {
      return (error as Error).message;
    }
    if (!lost.length && this.o.plant !== 'stages-clean-tree') return undefined;
    if (lost.length > files) return `it would discard ${lost.length.toLocaleString('en-US')} files, more than the staging ceiling of ${files.toLocaleString('en-US')} files`;
    const ts = this.o.now();
    const id = ulid(ts);
    const copy = join(this.dir, id);
    await mkdir(join(copy, 'files'), { recursive: true, mode: 0o700 });
    const slow = Number(process.env.DEEP_HUB_TEST_SLOW_CLONE_MS) || 0;
    const digests: string[] = [];
    let next = 0;
    let why: string | undefined;
    const copier = async (): Promise<void> => {
      while (next < lost.length && !why) {
        const k = next++;
        const to = join(copy, 'files', String(k));
        if (slow) await sleep(Math.min(slow, Math.max(0, deadline - Date.now())));
        why ??= Date.now() > deadline ? 'late' : await lost[k]!.write(to, deadline);
        if (!why) digests[k] = await digestOf(to);
      }
    };
    await Promise.all(Array.from({ length: Math.min(COPIES, lost.length) }, copier));
    if (why) {
      await rm(copy, { recursive: true, force: true });
      return why === 'late' ? `copying the ${lost.length.toLocaleString('en-US')} files it would discard would take past the ${seconds} s ceiling` : why;
    }
    await this.record(meta, id, ts, copy, { command, folders: [], files: lost.map((f, k) => ({ path: f.path, digest: digests[k]! })), until: ts + keepMs });
    return undefined;
  }

  /** `command.staged` for the copy at `copy`, which is dropped if the record can't take it. */
  private async record(meta: HookMeta, id: string, ts: number, copy: string, data: Record<string, unknown>): Promise<void> {
    try {
      await this.o.append(this.o.connection(meta.session, meta.agent), { v: 2, id, kind: 'command.staged', ts, data: { call: meta.toolUse ?? meta.id, ...data } });
    } catch (error) {
      await rm(copy, { recursive: true, force: true });
      throw error;
    }
  }

  /** Stages `folders` for the call: undefined once the copy is made and recorded, or why it can't be. */
  private async stage(meta: HookMeta, command: string, folders: string[]): Promise<string | undefined> {
    const { files, seconds, keepMs } = settings(this.o.root);
    const free = this.o.plant === 'stages-without-ceiling';
    const deadline = free ? Infinity : Date.now() + seconds * 1000;
    const late = () => Date.now() > deadline;
    const existing: string[] = [];
    for (const f of folders) if (await there(f)) existing.push(f);
    if (!existing.length) return undefined;
    // Counted first, so a copy that would pass the files ceiling is never made.
    let count = 0;
    const walk = async (path: string): Promise<boolean> => {
      const info = await stat(path).catch(() => undefined);
      if (!info?.isDirectory()) return ++count <= files || free;
      for (const entry of await readdir(path, { withFileTypes: true }).catch(() => [])) {
        if (late()) return false;
        if (entry.isDirectory() ? !(await walk(join(path, entry.name))) : ++count > files && !free) return false;
      }
      return true;
    };
    for (const f of existing) {
      if (!(await walk(f))) {
        return late()
          ? `staging ${existing.join(', ')} would take past the ${seconds} s ceiling`
          : `${existing.join(', ')} hold${existing.length === 1 ? 's' : ''} more than the staging ceiling of ${files.toLocaleString('en-US')} files`;
      }
    }
    const ts = this.o.now();
    const id = ulid(ts);
    const copy = join(this.dir, id);
    await mkdir(copy, { recursive: true, mode: 0o700 });
    const slow = Number(process.env.DEEP_HUB_TEST_SLOW_CLONE_MS) || 0;
    for (const [i, f] of this.o.plant === 'stages-without-copy' ? [] : existing.entries()) {
      // The test file system: each clone waits this long first.
      if (slow) await sleep(Math.min(slow, Math.max(0, deadline - Date.now())));
      const why = late() ? `staging ${existing.join(', ')} would take past the ${seconds} s ceiling` : await clone(f, join(copy, String(i)), deadline);
      if (why) {
        await rm(copy, { recursive: true, force: true });
        return why === 'late' ? `staging ${existing.join(', ')} would take past the ${seconds} s ceiling` : why;
      }
    }
    await this.record(meta, id, ts, copy, { command, folders: existing, until: ts + keepMs });
    return undefined;
  }

  /** `deep undo staged:<id>`: each staged folder holds again what the copy holds, until the copy is let go. */
  async undo(params: Record<string, unknown>): Promise<{ staged: string; folders: string[]; files: string[] }> {
    const handle = params.staged;
    if (typeof handle !== 'string' || !/^staged:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/staged', 'Name the staging by its handle, staged:<id>.', handle));
    const id = handle.slice('staged:'.length);
    const [row] = (await this.o.raw(`SELECT data FROM events WHERE kind = 'command.staged' AND id = ?`, [id])) as { data: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/staged', `No staging ${handle} in the record.`, handle));
    const { folders, files = [], until, command } = JSON.parse(row.data) as { folders: string[]; files?: { path: string; digest: string }[]; until: number; command: string };
    const copy = join(this.dir, id);
    if (this.o.now() >= until || !(await there(copy))) {
      throw new Refused(refusal('not_found', '/params/staged', `The copy ${handle} kept of \`${command}\` was let go at ${new Date(until).toISOString()}, so the run can't be undone.`, handle));
    }
    for (const [i, f] of folders.entries()) {
      const why = await clone(join(copy, String(i)), f, Infinity);
      if (why) throw new Refused(refusal('unavailable', '/params/staged', `${f} couldn't be put back from ${handle}: ${why}`, handle, true));
    }
    // Every copy is read against its digest first, so a damaged one changes nothing.
    for (const [i, f] of files.entries()) {
      if (await digestOf(join(copy, 'files', String(i))).catch(() => undefined) !== f.digest) throw new Refused(refusal('unavailable', '/params/staged', `The copy of ${f.path} in ${handle} no longer has its digest ${f.digest}, so nothing was put back.`, handle));
    }
    for (const [i, f] of files.entries()) {
      await mkdir(dirname(f.path), { recursive: true });
      const why = await clone(join(copy, 'files', String(i)), f.path, Infinity);
      if (why) throw new Refused(refusal('unavailable', '/params/staged', `${f.path} couldn't be put back from ${handle}: ${why}`, handle, true));
    }
    return { staged: handle, folders, files: files.map((f) => f.path) };
  }

  /** Lets go of each copy past its set time, and of a copy the record holds no staging for once it is an hour old. */
  async prune(): Promise<void> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    for (const name of names) {
      const [row] = (await this.o.raw(`SELECT json_extract(data, '$.until') AS until FROM events WHERE kind = 'command.staged' AND id = ?`, [name])) as { until: number }[];
      const path = join(this.dir, name);
      const gone = row ? this.o.now() >= row.until : Date.now() - ((await stat(path).catch(() => undefined))?.mtimeMs ?? 0) > ORPHAN_MS;
      if (gone) await rm(path, { recursive: true, force: true });
    }
  }
}

/** What `git` prints in `dir`, read without taking the index lock; undefined when it fails. */
function git(dir: string, args: string[]): Promise<string | undefined> {
  return new Promise((done) => execFile('git', ['-C', dir, '-c', 'core.fsmonitor=false', ...args], { encoding: 'utf8', maxBuffer: 1 << 28, timeout: GIT_MS, killSignal: 'SIGKILL', env: { ...gitEnv(), GIT_OPTIONAL_LOCKS: '0' } }, (error, out) => done(error ? undefined : out)));
}

/** The SHA-256 of a file's bytes, or of a link's target. */
async function digestOf(path: string): Promise<string> {
  const hash = createHash('sha256');
  const link = await readlink(path).catch(() => undefined);
  if (link !== undefined) return hash.update(link).digest('hex');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Each tracked file under `paths` that differs from HEAD and is on disk: a file git has deleted holds nothing to lose. */
async function edited(paths: string[]): Promise<Lost[]> {
  const lost: Lost[] = [];
  for (const path of paths) {
    const dir = (await stat(path).catch(() => undefined))?.isDirectory() ? path : dirname(path);
    const top = (await git(dir, ['rev-parse', '--show-toplevel']))?.trim();
    // Not a repository: the command has nothing to discard, and git says so.
    if (!top) continue;
    const status = await git(dir, ['--literal-pathspecs', 'status', '--porcelain=v1', '-z', '--no-renames', '--untracked-files=no', '--ignore-submodules=all', '--', path]);
    if (status === undefined) throw new Error(`git couldn't list the edits under ${path}`);
    for (const line of status.split('\0').filter(Boolean)) {
      const file = join(top, line.slice(3));
      if (await lstat(file).then((s) => !s.isDirectory(), () => false)) lost.push({ path: file, write: (to, deadline) => clone(file, to, deadline) });
    }
  }
  return lost;
}

/** Each file of the stash entry `entry` holds in `dir`, or of every entry with none, oldest first so a newer one wins. */
async function stashed(dir: string, entry: string | undefined): Promise<Lost[]> {
  const top = (await git(dir, ['rev-parse', '--show-toplevel']))?.trim();
  if (!top) return [];
  const all = entry ? [entry] : ((await git(dir, ['stash', 'list', '--format=%H'])) ?? '').split('\n').filter(Boolean).reverse();
  const lost: Lost[] = [];
  const add = (mode: string, blob: string, path: string) => lost.push({ path: join(top, path), write: (to) => blobAt(dir, mode, blob, to) });
  for (const name of all) {
    const commit = (await git(dir, ['rev-parse', '--verify', '--quiet', `${name}^{commit}`]))?.trim();
    // No such entry: `git stash drop` says so, with nothing dropped.
    if (!commit) continue;
    const changed = await git(dir, ['diff-tree', '-r', '-z', '--no-renames', `${commit}^1`, commit]);
    if (changed === undefined) throw new Error(`git couldn't read the stash entry ${name}`);
    const fields = changed.split('\0');
    for (let k = 0; k + 1 < fields.length; k += 2) {
      const [, mode, , blob, status] = fields[k]!.split(' ');
      if (status !== 'D') add(mode!, blob!, fields[k + 1]!);
    }
    // A stash saved with its untracked files holds them in a third parent.
    const untracked = await git(dir, ['rev-parse', '--verify', '--quiet', `${commit}^3`]);
    for (const line of (untracked ? (await git(dir, ['ls-tree', '-r', '-z', untracked.trim()])) ?? '' : '').split('\0').filter(Boolean)) {
      const [head, path] = [line.slice(0, line.indexOf('\t')), line.slice(line.indexOf('\t') + 1)];
      const [mode, , blob] = head.split(' ');
      add(mode!, blob!, path);
    }
  }
  return lost;
}

/** The blob `blob` written at `to` with its mode: undefined, or why it couldn't be. */
async function blobAt(dir: string, mode: string, blob: string, to: string): Promise<string | undefined> {
  if (mode === '120000') {
    const target = await git(dir, ['cat-file', 'blob', blob]);
    return target === undefined ? `git couldn't read ${blob}` : symlink(target, to).then(() => undefined, (error: Error) => error.message);
  }
  const file = await open(to, 'wx', mode === '100755' ? 0o755 : 0o644);
  return new Promise((done) => {
    const child = spawn('git', ['-C', dir, 'cat-file', 'blob', blob], { stdio: ['ignore', file.fd, 'ignore'], env: gitEnv(), timeout: GIT_MS, killSignal: 'SIGKILL' });
    const end = (why: string | undefined) => void file.close().finally(() => done(why));
    child.on('error', (error) => end(error.message));
    child.on('close', (code) => end(code === 0 ? undefined : `git couldn't read ${blob}`));
  });
}

/** `from` cloned copy-on-write at `to` by deep-hook, stopped at `deadline`: undefined, 'late', or why it couldn't. */
function clone(from: string, to: string, deadline: number): Promise<string | undefined> {
  return new Promise((done) => {
    const child = spawn(deepHook(), ['clone', from, to], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    let late = false;
    child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
    const timer = Number.isFinite(deadline) ? setTimeout(() => { late = true; child.kill('SIGKILL'); }, Math.max(0, deadline - Date.now())) : undefined;
    child.on('error', (error) => { clearTimeout(timer); done(error.message); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (late) done('late');
      else if (code === 0) done(undefined);
      else if (code === 3) done(`this file system can't make a copy-on-write copy of ${from}`);
      else done(err.trim() || `deep-hook clone exited ${code}`);
    });
  });
}

// Staging for destructive commands (#347; design: Before each command, "Destructive commands you approved"). A delete
// whose reach can't be worked out before it runs, such as an agent-written script's or one over a pattern, runs only
// after the folders it names (deep-hook reads them, hook.request@3's `stage`) are cloned copy-on-write under
// <root>/staged/<id>, within a ceiling on files and seconds below the hold, so the run can be undone from the copy
// (`deep undo staged:<id>`) until the copy is let go at its set time. A copy that would pass a ceiling is dropped,
// and the command becomes an authority ask that says its reach is unknown, as on a file system that can't clone.
//
// Settings: `staging` in <root>/config.json, `{ files, seconds, keep }`; `seconds` is held below the hold.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ulid, type Connection, type EventInput } from '@deepbuild/record';
import type { Holds } from './holds.js';
import { deepHook } from './paths.js';
import { refusal, Refused, STAGE_HOLD_MS, type Gated, type HookMeta, type Plant } from './wire.js';

const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };
/** The ceilings and the set time when config.json says nothing. */
const DEFAULTS = { files: 10_000, seconds: 10, keepMs: 3 * UNITS.d! };
/** The seconds ceiling is held this far below the hold, leaving room to raise the ask. */
const MAX_SECONDS = STAGE_HOLD_MS / 1000 - 5;
/** A copy with no staging in the record (a crash between clone and append) is let go after this long. */
const ORPHAN_MS = UNITS.h!;

export interface Settings { files: number; seconds: number; keepMs: number }
/** `staging` in <root>/config.json, each value held to what the hold allows. */
export function settings(root: string): Settings {
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

export interface StagingOptions {
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
    const k = this.o.holds.keyOf({ source: 'command.unstageable', session: meta.session, command, folders: call.stage ?? null });
    if (ask) {
      // Once you said yes, the same call runs unstaged; while the ask waits, or after a no, it is held by it.
      const prior = await this.o.holds.prior(k);
      if (prior === 'allow') return {};
      if (prior) return { held: await this.o.holds.waiting(prior, command) };
    }
    const why = call.stage ? await this.stage(meta, command, call.stage) : 'it names a folder through a value the line can\'t know';
    if (why === undefined) return {};
    if (!ask) return { deny: `DeepBuild blocked this: what \`${command}\` deletes can't be staged first (${why}), and this session can't be asked.` };
    const question = `Run \`${command}\` unstaged? Its reach is unknown: ${why}, so no copy-on-write copy can be kept to undo it from. Your yes runs it as it is.`;
    return { held: await this.o.holds.holdUnstaged(meta, k, command, question) };
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
    for (const [i, f] of existing.entries()) {
      // The test file system: each clone waits this long first.
      if (slow) await sleep(Math.min(slow, Math.max(0, deadline - Date.now())));
      const why = late() ? `staging ${existing.join(', ')} would take past the ${seconds} s ceiling` : await clone(f, join(copy, String(i)), deadline);
      if (why) {
        await rm(copy, { recursive: true, force: true });
        return why === 'late' ? `staging ${existing.join(', ')} would take past the ${seconds} s ceiling` : why;
      }
    }
    try {
      await this.o.append(this.o.connection(meta.session, meta.agent), {
        v: 1, id, kind: 'command.staged', ts, data: { call: meta.toolUse ?? meta.id, command, folders: existing, until: ts + keepMs },
      });
    } catch (error) {
      await rm(copy, { recursive: true, force: true });
      throw error;
    }
    return undefined;
  }

  /** `deep undo staged:<id>`: each staged folder holds again what the copy holds, until the copy is let go. */
  async undo(params: Record<string, unknown>): Promise<{ staged: string; folders: string[] }> {
    const handle = params.staged;
    if (typeof handle !== 'string' || !/^staged:[0-9A-Za-z]+$/.test(handle)) throw new Refused(refusal('handle_syntax', '/params/staged', 'Name the staging by its handle, staged:<id>.', handle));
    const id = handle.slice('staged:'.length);
    const [row] = (await this.o.raw(`SELECT data FROM events WHERE kind = 'command.staged' AND id = ?`, [id])) as { data: string }[];
    if (!row) throw new Refused(refusal('not_found', '/params/staged', `No staging ${handle} in the record.`, handle));
    const { folders, until, command } = JSON.parse(row.data) as { folders: string[]; until: number; command: string };
    const copy = join(this.dir, id);
    if (this.o.now() >= until || !(await there(copy))) {
      throw new Refused(refusal('not_found', '/params/staged', `The copy ${handle} kept of \`${command}\` was let go at ${new Date(until).toISOString()}, so the run can't be undone.`, handle));
    }
    for (const [i, f] of folders.entries()) {
      const why = await clone(join(copy, String(i)), f, Infinity);
      if (why) throw new Refused(refusal('unavailable', '/params/staged', `${f} couldn't be put back from ${handle}: ${why}`, handle, true));
    }
    return { staged: handle, folders };
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

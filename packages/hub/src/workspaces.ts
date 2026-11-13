// Workspaces in the hub (#67; design: Work outside a repo): the record's side of a home for work that isn't code. A
// project is a repo or a workspace, and a workspace's project id is the one the core gave it when it was made, kept by
// path (`nameWorkspace`), never one a folder's files claim. What its state sources read is pinned when a definition
// locks and again at each claim, by digest in `state.read`, with the items in the evidence store under that digest: a
// check reads its checkout's `.deepbuild/state/<touch>.json`, a run on the base commit the reading pinned at the lock,
// and the verdict's key holds the digests, so two readings on one commit are two keys. A drift marks stale the verdicts
// whose reading moved and runs again only the checks that read it, on the claim's commit, the others' results carried.
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';
import type { StateItem, StateSource } from '@deepbuild/conformance';
import type { JsonValue } from '@deepbuild/contracts';
import { ulid, type Connection } from '@deepbuild/record';
import { markStale, type Verdict } from '@deepbuild/verdicts';
import { diffOf, keepWork, makeWorkspace, reading, revertCommit, sourceOf, WORKSPACE_FILE, workspaceFile, type Touch } from '@deepbuild/workspaces';
import type { StatePin } from './gate-runner.js';
import { nameWorkspace, repoOf } from './paths.js';
import type { WorkspaceDeps } from './workspaces-port.js';

type Obj = Record<string, unknown>;
type Source = Omit<StateSource, 'fixture'>;
interface Space { id: string; folder: string; name: string }
interface Read { touch: string; source: string; digest: string }
interface Reads { req: string; check: string | null; touches: string[] }
interface StateRead { workspace: string; task_ref: string; claim: string | null; readings: Read[]; reads: Reads[] }
const TOUCH = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const letters = (s: string): string => s.replace(/[^0-9A-Za-z]/g, '');
const stateFile = (touch: string): string => `.deepbuild/state/${touch}.json`;
const mapOf = (items: readonly StateItem[]): string => JSON.stringify(Object.fromEntries(items.map((i) => [i.id, i.value])));

export class Workspaces {
  private readonly spaces = new Map<string, Space>();
  /** Each task's workspace, by its project id. */
  private readonly tasks = new Map<string, string>();
  /** The workspace a session outside any repo landed in, so its next task lands there too. */
  private readonly sessions = new Map<string, string>();
  private readonly kept = new Set<string>();
  constructor(private readonly o: WorkspaceDeps) {}

  /** What the record holds of its workspaces: each by its path, for the project id. */
  async open(): Promise<void> {
    const rows = (await this.o.raw(`SELECT kind, data FROM events WHERE kind IN ('workspace.created', 'workspace.moved', 'state.read') ORDER BY log_pos`)) as { kind: string; data: string }[];
    for (const row of rows) {
      const d = JSON.parse(row.data) as Obj;
      if (row.kind === 'state.read') this.tasks.set(String(d.task_ref), String(d.workspace));
      else if (row.kind === 'workspace.moved') this.spaces.get(String(d.workspace))!.folder = String(d.folder);
      else {
        this.spaces.set(String(d.workspace), { id: String(d.workspace), folder: String(d.folder), name: String(d.topic) });
        if (typeof d.task_ref === 'string') this.tasks.set(d.task_ref, String(d.workspace));
      }
    }
    for (const s of this.spaces.values()) nameWorkspace(s.folder, s.id);
  }
  private named(id: string): Space {
    const s = this.spaces.get(id);
    if (!s) throw Error(`no workspace ${id}`);
    return s;
  }
  private at(folder: string): Space | undefined {
    return [...this.spaces.values()].find((s) => s.folder === folder);
  }
  private core(id: string): Connection {
    return this.o.connection({ project: id });
  }
  /** A folder you pick holds nothing yet: making or moving a workspace there trusts it, so it can't trust what's already there. */
  private free(folder: string): void {
    if (!isAbsolute(folder)) throw Error(`name the folder by its absolute path, not ${folder}`);
    if (existsSync(folder) && (!statSync(folder).isDirectory() || readdirSync(folder).length)) throw Error(`${folder} already holds something; a workspace takes an empty folder`);
  }

  /** A folder of DeepBuild's own for a topic. */
  private ownFolder(topic: string): string {
    return join(this.o.root, 'workspaces', `${letters(topic).slice(0, 32).toLowerCase() || 'workspace'}-${randomBytes(4).toString('hex')}`);
  }
  /** A new workspace, with no question: a git repo with a first commit, trusted by being made. */
  async make(topic: string, pick?: string, task_ref: string | null = null, at = pick ?? this.ownFolder(topic)): Promise<Space> {
    const name = topic.trim().slice(0, 200);
    if (!name) throw Error('a workspace needs a topic');
    const tag = randomBytes(4).toString('hex');
    this.free(at);
    mkdirSync(at, { recursive: true });
    const folder = realpathSync(at);
    const id = `${letters(name).slice(0, 32) || 'workspace'}${tag}`;
    await makeWorkspace(folder, { id, name, touches: [] });
    await this.o.trust(folder);
    const space = { id, folder, name };
    this.spaces.set(id, space);
    if (task_ref) this.tasks.set(task_ref, id);
    nameWorkspace(folder, id);
    const ts = this.o.now();
    await this.o.append(this.core(id), { v: 1, id: ulid(ts), kind: 'workspace.created', ts, data: { workspace: id, folder, topic: name, task_ref } });
    return space;
  }
  /** Moves it to a folder you pick: the same id, files and history. */
  async move(id: string, to: string): Promise<Space> {
    const space = this.named(id);
    this.free(to);
    if (existsSync(to)) rmdirSync(to);
    mkdirSync(dirname(to), { recursive: true });
    const from = space.folder;
    try {
      renameSync(from, to);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
      cpSync(from, to, { recursive: true, verbatimSymlinks: true });
      rmSync(from, { recursive: true, force: true });
    }
    space.folder = realpathSync(to);
    nameWorkspace(from, undefined);
    nameWorkspace(space.folder, id);
    await this.o.trust(space.folder);
    const ts = this.o.now();
    await this.o.append(this.core(id), { v: 1, id: ulid(ts), kind: 'workspace.moved', ts, data: { workspace: id, folder: space.folder, from } });
    return space;
  }
  async revert(id: string, commit: string): Promise<{ commit: string }> {
    if (!/^[0-9a-f]{7,64}$/.test(commit)) throw Error(`${commit} isn't a commit`);
    return { commit: await revertCommit(this.named(id).folder, commit) };
  }

  /**
   * Where a task from a session outside any repo goes: a new workspace, or the one the session already landed in. A
   * session in a repo, or a folder that isn't one, lands nowhere.
   */
  async land(t: { session: string; cwd: string; task_ref: string; text: string; item?: { title?: string } }): Promise<string | undefined> {
    if (repoOf(t.cwd) || !existsSync(t.cwd) || !statSync(t.cwd).isDirectory()) return undefined;
    const known = this.sessions.get(t.session);
    const topic = t.item?.title ?? t.text;
    const at = known ? this.named(known).folder : this.ownFolder(topic);
    // Said before any git runs, so the prompt's own reply carries it: the session isn't in the folder its work belongs in.
    if (!known) this.o.told(t.session, t.cwd, `DeepBuild: this session is outside any repo, so this task's home is the workspace at ${at}. Keep what you build there, as code where you can; your work there is committed for you at each stop.`);
    const space = known ? this.named(known) : await this.make(topic, undefined, t.task_ref, at);
    this.sessions.set(t.session, space.id);
    this.tasks.set(t.task_ref, space.id);
    this.o.adopted(t.session, space.id);
    return space.folder;
  }
  /** The folder of a task in a workspace. */
  folderOf(task_ref: string): string | undefined {
    const id = this.tasks.get(task_ref);
    return id ? this.spaces.get(id)?.folder : undefined;
  }
  /** What the drafting job wrote for a workspace (`files`, `touches`), written and committed before the lock. */
  async fill(folder: string, handed: Obj): Promise<void> {
    const space = this.at(folder);
    const files = handed.files as Record<string, string> | undefined;
    const touches = handed.touches as Touch[] | undefined;
    if (!space || (!files && !touches)) return;
    for (const [path, body] of Object.entries(files ?? {})) {
      const clean = normalize(path);
      if (isAbsolute(clean) || clean.split(sep)[0] === '..') throw Error(`its file ${path} is outside the workspace`);
      mkdirSync(dirname(join(folder, clean)), { recursive: true });
      writeFileSync(join(folder, clean), body, { mode: clean.endsWith('.sh') ? 0o755 : 0o644 });
    }
    if (touches) writeFileSync(join(folder, WORKSPACE_FILE), `${JSON.stringify({ ...workspaceFile(folder), touches }, null, 2)}\n`);
    await keepWork(folder, 'What the definition needs');
  }
  /** The work of a session outside the workspace, which has no git of its own: kept before each claim, so a verdict pins to a commit of the workspace. */
  keep(folder: string, task_ref: string): Promise<boolean> {
    return keepWork(folder, `Work on ${task_ref}`);
  }

  private async source(touch: Touch, folder: string): Promise<Source> {
    return sourceOf(touch, folder) ?? this.o.plugin(touch.source);
  }
  /** One touch read now, its items kept in the evidence store under the reading's digest. */
  private async read(folder: string, touch: Touch): Promise<Read & { items: StateItem[] }> {
    const items = await (await this.source(touch, folder)).read();
    const { digest, bytes } = reading(items);
    if (!this.kept.has(digest)) {
      await this.o.keep(bytes, `state:${touch.id}`);
      this.kept.add(digest);
    }
    return { touch: touch.id, source: touch.source, digest, items };
  }
  private async itemsAt(digest: string): Promise<StateItem[]> {
    return JSON.parse(new TextDecoder().decode(await this.o.fetch(digest))) as StateItem[];
  }
  private appendRead(d: StateRead): Promise<void> {
    const ts = this.o.now();
    return this.o.append(this.core(d.workspace), { v: 1, id: ulid(ts), kind: 'state.read', ts, data: d as unknown as JsonValue });
  }
  /** The newest `state.read` of a workspace matching `where`. */
  private async newest(id: string, where: string, params: string[] = []): Promise<StateRead | undefined> {
    const [row] = (await this.o.raw(`SELECT data FROM events WHERE kind = 'state.read' AND json_extract(data, '$.workspace') = ? AND ${where} ORDER BY log_pos DESC LIMIT 1`, [id, ...params])) as { data: string }[];
    return row ? JSON.parse(row.data) as StateRead : undefined;
  }

  /** The definition is about to lock in a workspace: every touch read, and which each requirement's check reads. */
  async pin(task_ref: string, folder: string, requirements: readonly Obj[]): Promise<void> {
    const space = this.at(folder);
    if (!space) return;
    const touches = workspaceFile(folder).touches;
    const reads: Reads[] = [];
    for (const r of requirements) {
      const named = Array.isArray(r.reads) ? r.reads.map(String) : [];
      const unknown = named.find((t) => !TOUCH.test(t) || !touches.some((x) => x.id === t));
      if (unknown !== undefined) throw Error(`${String(r.id)} reads ${unknown}, which ${WORKSPACE_FILE} doesn't name`);
      if (named.length) reads.push({ req: String(r.id), check: typeof r.check === 'string' && r.check ? r.check : null, touches: named });
    }
    const readings = await Promise.all(touches.map((t) => this.read(folder, t)));
    this.tasks.set(task_ref, space.id);
    await this.appendRead({ workspace: space.id, task_ref, claim: null, readings: readings.map(({ touch, source, digest }) => ({ touch, source, digest })), reads });
  }
  /** A claim's digests and files from the readings it pins, and the base's from the lock's. */
  private async stateOf(read: readonly (Read & { items: StateItem[] })[], lock: StateRead): Promise<StatePin> {
    const files = Object.fromEntries(read.map((r) => [stateFile(r.touch), mapOf(r.items)]));
    const pinned = Object.fromEntries(await Promise.all(lock.readings.filter((p) => read.some((r) => r.touch === p.touch)).map(async (p) => [stateFile(p.touch), mapOf(await this.itemsAt(p.digest))])));
    const digests = this.o.plant === 'state-left-out-of-key' ? [] : [...new Set(read.map((r) => r.digest))].sort();
    return { digests, files, pinned };
  }
  /** A claim in a workspace: what its checks read, read now, and pinned to the claim. Undefined outside a workspace, or for a definition that reads nothing. */
  async claimState(task_ref: string, folder: string, claim: string): Promise<StatePin | undefined> {
    const space = this.at(folder);
    const lock = space && await this.newest(space.id, `json_extract(data, '$.task_ref') = ? AND json_extract(data, '$.claim') IS NULL`, [task_ref]);
    if (!space || !lock?.reads.length) return undefined;
    const wanted = [...new Set(lock.reads.flatMap((r) => r.touches))];
    const touches = workspaceFile(folder).touches.filter((t) => wanted.includes(t.id));
    const read = await Promise.all(touches.map((t) => this.read(folder, t)));
    await this.appendRead({ workspace: space.id, task_ref, claim, readings: read.map(({ touch, source, digest }) => ({ touch, source, digest })), reads: lock.reads });
    return this.stateOf(read, lock);
  }

  /** What changed since the newest definition in the workspace locked, through each touch's own source. */
  async diff(id: string): Promise<{ diffs: { touch: string; item: string; was: JsonValue; now: JsonValue }[] }> {
    const { folder } = this.named(id);
    const lock = await this.newest(id, `json_extract(data, '$.claim') IS NULL`);
    if (!lock) return { diffs: [] };
    const diffs: { touch: string; item: string; was: JsonValue; now: JsonValue }[] = [];
    for (const touch of workspaceFile(folder).touches) {
      const then = lock.readings.find((r) => r.touch === touch.id);
      const source = await this.source(touch, folder);
      const changed = await diffOf(source, then ? await this.itemsAt(then.digest) : [], await source.read());
      diffs.push(...changed.map((c) => ({ touch: touch.id, ...c })));
    }
    return { diffs };
  }

  /** Reads what the workspace's standing claims pinned: each verdict whose reading moved goes stale, and only the checks that read it run again. */
  async drift(id: string): Promise<{ drifted: string[]; stale: string[]; reran: string[] }> {
    const { folder } = this.named(id);
    const rows = (await this.o.raw(`SELECT data FROM events WHERE kind = 'state.read' AND json_extract(data, '$.workspace') = ? ORDER BY log_pos`, [id])) as { data: string }[];
    // Each task's newest claim speaks for it: an older one is outdated already.
    const standing = new Map<string, StateRead>();
    for (const row of rows) {
      const d = JSON.parse(row.data) as StateRead;
      if (d.claim) standing.set(d.task_ref, d);
    }
    const out = { drifted: new Set<string>(), stale: [] as string[], reran: new Set<string>() };
    const touches = workspaceFile(folder).touches;
    const now = new Map<string, Read & { items: StateItem[] }>();
    for (const d of standing.values()) {
      for (const r of d.readings) {
        const touch = touches.find((t) => t.id === r.touch);
        if (touch && !now.has(r.touch)) now.set(r.touch, await this.read(folder, touch));
      }
      const moved = d.readings.filter((r) => now.has(r.touch) && now.get(r.touch)!.digest !== r.digest).map((r) => r.touch);
      for (const touch of moved) out.drifted.add(touch);
      if (!moved.length) continue;
      const [row] = (await this.o.raw(`SELECT e.id AS id, e.log_pos AS log_pos, e.data AS data, v.stale AS stale FROM events e JOIN verdicts v ON v.handle = json_extract(e.data, '$.verdict')
        WHERE e.kind = 'verdict.made' AND json_extract(e.data, '$.claim') = ? ORDER BY e.log_pos DESC LIMIT 1`, [d.claim!])) as { id: string; log_pos: number; data: string; stale: number }[];
      if (!row || row.stale) continue;
      const made = JSON.parse(row.data) as { verdict: string; commit: string; key: Verdict['key'] };
      const read = d.readings.flatMap((r) => { const n = now.get(r.touch); return n ? [n] : []; });
      await markStale(this.o.record(), { id: row.id, handle: made.verdict, log_pos: Number(row.log_pos) }, { commit: made.commit, key: made.key } as Verdict, made.commit, this.o.now(), read.map((r) => r.digest));
      out.stale.push(made.verdict);
      const checks = [...new Set(d.reads.filter((r) => r.check && r.touches.some((t) => moved.includes(t))).map((r) => r.check!))];
      await this.appendRead({ ...d, readings: read.map(({ touch, source, digest }) => ({ touch, source, digest })) });
      const lock = await this.newest(id, `json_extract(data, '$.task_ref') = ? AND json_extract(data, '$.claim') IS NULL`, [d.task_ref]);
      if (lock && this.o.rerun(d.claim!, checks, await this.stateOf(read, lock))) for (const check of checks) out.reran.add(check);
    }
    return { drifted: [...out.drifted].sort(), stale: out.stale, reran: [...out.reran] };
  }
  /** Every reading a `state.read` pins: evidence the retention pass keeps, or a later diff has nothing to read. */
  async pinned(): Promise<string[]> {
    const rows = (await this.o.raw(`SELECT DISTINCT json_extract(j.value, '$.digest') AS digest FROM events e, json_each(e.data, '$.readings') j WHERE e.kind = 'state.read'`)) as { digest: string }[];
    return rows.map((r) => r.digest);
  }
  /** Every workspace's drift, for the hub's timer. */
  async driftAll(): Promise<void> {
    for (const { id, folder } of this.spaces.values()) if (existsSync(folder)) await this.drift(id).catch((error: unknown) => process.stderr.write(`deep hub: workspace ${id}'s drift wasn't read: ${error instanceof Error ? error.message : String(error)}\n`));
  }
}

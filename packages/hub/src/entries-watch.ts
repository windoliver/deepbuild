// DeepBuild's entries in the agents' own files, watched (#18, #1687, #1867; design: Threats, "Agents switching off
// what watches them"): Claude Code's hook entries in settings.json and its MCP servers in ~/.claude.json, and Codex's
// hook entries in hooks.json, through its link if it is one. An entry of ours removed or changed while an agent's call
// runs goes back at once, with a reading naming the call; at a session's start, one a recorded call wrote goes back
// too. A change with no call behind it is yours, and stays.
import { existsSync, readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { join, resolve } from 'node:path';
import { statKey, target, writeThrough } from './agent-files.js';
import { claudeJson, claudeSettings, installed, readJson, restore, restoreServers, serversChanged, tampered } from './claude-settings.js';
import { brokenIn, keepIntact, keptIntact, leftAs, recordedHooks, withRecorded } from './codex-settings.js';
import { FileWatch } from './file-watch.js';
import type { Plant } from './plant.js';

type Obj = Record<string, unknown>;
type Agent = 'claude-code' | 'codex';
interface Row { id: string; session_id: string; agent: string | null; data: string }

/** One agent file that holds entries of ours, as setup recorded them. */
interface Kept {
  /** Whose file it is: where health shows its readings. */
  agent: Agent;
  /** What of ours it holds, in a reading's words. */
  holds: string;
  /** The file as its agent names it; undefined while setup has recorded no place for it. */
  file(): string | undefined;
  /** Each entry of ours the file no longer holds as setup wrote it, named; none while it can't be read. */
  changed(file: string): string[];
  /** Puts them back; false when it wrote nothing. */
  restore(file: string): boolean;
  /** A change to ours was left in the file, as yours. */
  stays?(file: string): void;
  /**
   * The files to watch themselves, and those to watch through their folder (file-watch.ts), for a file the OS tells
   * of at once and no timer reads (#2648). settings.json has none: it keeps its folder's watch and its poll, since
   * what it can't be read as is put back over, and at a write's first instant a file reads empty.
   */
  watched?(): [files: string[], throughFolder: string[]];
}

const claudeHooks = (root: string): Kept => ({
  agent: 'claude-code', holds: 'hook entries',
  file: claudeSettings,
  changed: (file) => { const record = installed(root); return record ? tampered(readJson(file), record) : []; },
  restore: () => { restore(installed(root)!); return true; },
});
const claudeServers = (root: string): Kept => ({
  agent: 'claude-code', holds: 'MCP servers',
  file: claudeJson,
  changed: (file) => { const record = installed(root); return record?.servers ? serversChanged(readJson(file), record) : []; },
  restore: () => restoreServers(installed(root)!),
  // Setup's record, for when it first holds servers of ours; then the file, while it is there: one that isn't is watched through its folder, your whole home.
  watched: () => [[join(root, 'claude-hooks.json'), ...(installed(root)?.servers && existsSync(claudeJson()) ? [claudeJson()] : [])], []],
});
/** The file through its link; undefined when it isn't there. */
const bytesOf = (file: string): Buffer | undefined => { try { return readFileSync(target(file)); } catch { return undefined; } };
/** The file goes back whole, as it last held every entry of ours (codex-settings.ts, keepIntact); one never seen so, entry by entry. */
const codexHooks = (root: string): Kept => ({
  agent: 'codex', holds: 'hook entries',
  file: () => recordedHooks(root),
  changed(file) {
    const bytes = bytesOf(file);
    const broken = brokenIn(root, bytes?.toString());
    if (bytes && broken?.length === 0) keepIntact(root, file, bytes);
    return broken ?? [];
  },
  restore(file) {
    const now = bytesOf(file);
    const next = keptIntact(root, file, now) ?? withRecorded(root, now?.toString());
    if (next === undefined) return false;
    writeThrough(file, next);
    return true;
  },
  // What you change in the file after this must not be lost to the bytes kept before it: then ours go back one by one.
  stays: (file) => leftAs(root, file, bytesOf(file)),
  // Setup's record says which home the file is in; a link is watched where it points, and by its own folder for being replaced.
  watched() {
    const file = recordedHooks(root);
    const real = file && target(file);
    return [[join(root, 'codex-hooks.json'), ...(real ? [real] : [])], file && real !== file ? [file] : []];
  },
});

interface EntriesWatchOptions {
  root: string;
  plant: Plant | undefined;
  raw(query: string, params?: readonly (string | number | bigint | null)[]): Promise<unknown[]>;
  queue(work: () => Promise<void>): Promise<void>;
  /** Calls still running or within the core's recent-call grace period. */
  running(): { id: string; agent: string; what: string }[];
  reading(session: string, agent: string, text: string): Promise<void>;
}

/** The watch and the session-start recheck, with their readings. */
export class EntriesWatch {
  private readonly settings: Kept;
  private readonly servers: Kept;
  private readonly codex: Kept;
  /** Each file's identity, size and time at its last look; '' while its place isn't known. */
  private readonly keys = new Map<Kept, string>();
  private watcher: FSWatcher | undefined;
  private readonly files = new Map<Kept, FileWatch>();
  /** The one more look that follows each look of a watched file. */
  private readonly later = new Map<Kept, NodeJS.Timeout>();
  /** What was put back, by whose file it was. */
  readonly readings: Record<Agent, string[]> = { 'claude-code': [], codex: [] };

  constructor(private readonly o: EntriesWatchOptions) {
    this.settings = claudeHooks(o.root);
    this.servers = claudeServers(o.root);
    this.codex = codexHooks(o.root);
  }

  /** Starts the watch; the core owns the returned poll timer with its other timers. */
  watch(): NodeJS.Timeout[] {
    if (this.o.plant === 'restores-at-session-start-only') return [];
    // What each file holds now is where the watch starts: a change from before it is the recheck's.
    for (const kept of [this.settings, this.servers, this.codex]) {
      this.keys.set(kept, '');
      if (kept.watched) this.files.set(kept, new FileWatch(() => this.check(kept)));
      this.meet(kept);
    }
    try {
      this.watcher = watch(resolve(claudeSettings(), '..'), (_, name) => { if (!name || String(name) === 'settings.json') this.check(this.settings); });
      this.watcher.unref();
    } catch {
      // No folder yet: the poll finds the file once setup writes it.
    }
    return [setInterval(() => this.check(this.settings), 500)];
  }
  /** Looks at a file in the core's turn: `told` by its watch or its poll, or as the look that follows one. */
  private check(kept: Kept, told = true): void {
    void this.o.queue(async () => { if (await this.look(kept, told)) this.again(kept); }).catch(() => undefined);
  }
  /**
   * One more look, a moment after a file's watch was set: the OS tells of no change made before a watch takes
   * hold, or while the change before it is looked at. That look sets no watch unless it finds a change.
   */
  private again(kept: Kept): void {
    if (!this.files.has(kept) || this.later.has(kept)) return;
    this.later.set(kept, setTimeout(() => { this.later.delete(kept); this.check(kept, false); }, 100).unref());
  }
  /**
   * Watches a file where setup last recorded it. `anew` drops the watch it had, which may hold a file since
   * replaced: an atomic write, as ours are, leaves a new file at the path.
   */
  private arm(kept: Kept, anew = true): void {
    const files = this.files.get(kept);
    if (!files || !kept.watched) return;
    if (anew) files.set([]);
    files.set(...kept.watched());
  }
  /** Puts our entries back; what the file holds then is ours, and nothing new to the next look. */
  private putBack(kept: Kept, file: string): boolean {
    if (!kept.restore(file)) return false;
    this.keys.set(kept, statKey(file));
    this.arm(kept);
    this.again(kept);
    return true;
  }
  /** A file the watch hasn't looked at yet is watched from what it holds now. */
  private meet(kept: Kept): void {
    this.arm(kept, false);
    this.again(kept);
    const file = kept.file();
    if (!file || this.keys.get(kept) !== '') return;
    this.keys.set(kept, statKey(file));
    kept.changed(file);
  }
  /**
   * A file changed between session starts: an entry of ours removed or changed while an agent's call was running
   * goes back at once, with a reading naming the call; a change with none running is yours, and stays.
   */
  private async look(kept: Kept, told: boolean): Promise<boolean> {
    if (told) this.arm(kept);
    const file = kept.file();
    const key = file ? statKey(file) : '';
    const before = this.keys.get(kept);
    if (key === before) return told;
    if (!told) this.arm(kept);
    this.keys.set(kept, key);
    const changed = file ? kept.changed(file) : [];
    // A file whose place setup has only now recorded starts here, as every file does when the watch starts.
    const running = changed.length && before !== '' ? this.o.running() : [];
    if (file && changed.length && before !== '' && !running.length) kept.stays?.(file);
    if (!file || !running.length || !this.putBack(kept, file)) return true;
    for (const r of running) {
      const text = `DeepBuild's ${kept.holds} in ${file} were removed or changed (${changed.join('; ')}) while the ${r.what} was running; they were put back at once.`;
      this.readings[kept.agent].push(text);
      await this.o.reading(r.id, r.agent, text).catch(() => undefined);
    }
    return true;
  }

  /**
   * The recheck at a session's start: our entries changed, or Claude Code's hooks turned off, by a recorded agent call
   * that wrote the file, is tampering, and goes back with a reading naming the call; a change no recorded call made
   * is yours, and stays. Claude Code's settings are rechecked at every start, Codex's hooks file at a Codex session's.
   */
  async recheck(agent: string): Promise<void> {
    // A folder's watch can stay silent on a busy machine, so a file setup made since the watch started is met here.
    for (const kept of [this.servers, this.codex]) this.meet(kept);
    await this.settingsAtStart().catch(() => undefined);
    if (agent === 'codex') await this.hooksAtStart();
  }
  private async settingsAtStart(): Promise<void> {
    const record = installed(this.o.root);
    if (!record) return;
    const file = claudeSettings();
    const settings = readJson(file);
    const flag = settings?.disableAllHooks === true;
    const changed = tampered(settings, record);
    if (!flag && !changed.length) return;
    if (this.o.plant === 'restores-at-session-start-only') {
      if (changed.length) restore(record);
      return;
    }
    const rows = await this.wrote([file, '.claude/settings.json'], 'claude-hooks.json');
    if (!rows.length) return;
    restore(record, flag);
    this.keys.set(this.settings, statKey(file));
    const what = [flag ? 'turned Claude Code\'s hooks off (disableAllHooks)' : '', changed.length ? `changed DeepBuild's entries (${changed.join('; ')})` : ''].filter(Boolean).join(' and ');
    await this.tell('claude-code', rows, `wrote ${file} and ${what}; at this session start DeepBuild put its entries back${flag ? ' and took the flag out' : ''}.`);
  }
  private async hooksAtStart(): Promise<void> {
    const file = this.codex.file();
    const changed = file ? this.codex.changed(file) : [];
    if (!file || !changed.length) return;
    const rows = await this.wrote([...new Set([file, target(file), '.codex/hooks.json'])], 'codex-hooks.json');
    if (!rows.length) return this.codex.stays?.(file);
    if (!this.putBack(this.codex, file)) return;
    await this.tell('codex', rows, `wrote ${file} and changed DeepBuild's entries (${changed.join('; ')}); at this session start DeepBuild put its entries back.`);
  }
  /** The recorded agent calls whose input names the file, by one of `names`, since setup wrote its `record` of ours. */
  private wrote(names: readonly string[], record: string): Promise<Row[]> {
    const since = Math.floor(statSync(join(this.o.root, record)).mtimeMs) - 1000;
    return this.o.raw(`SELECT id, session_id, agent, data FROM events WHERE kind IN ('tool.before', 'tool.after') AND ts >= ? AND session_id IS NOT NULL AND (${names.map(() => 'instr(data, ?) > 0').join(' OR ')}) ORDER BY log_pos`, [since, ...names]) as Promise<Row[]>;
  }
  /** One reading a session whose recorded calls wrote the file, naming them and what they `did`. */
  private async tell(agent: Agent, rows: readonly Row[], did: string): Promise<void> {
    for (const session of new Set(rows.map((r) => r.session_id))) {
      const mine = rows.filter((r) => r.session_id === session);
      const calls = [...new Set(mine.map((r) => (JSON.parse(r.data) as Obj).call).filter((c): c is string => typeof c === 'string'))];
      const text = `An agent call ${calls.join(', ') || mine[0]!.id} (events ${mine.map((r) => r.id).join(', ')}) ${did}`;
      this.readings[agent].push(text);
      await this.o.reading(session, mine[0]!.agent ?? agent, text).catch(() => undefined);
    }
  }

  close(): void {
    this.watcher?.close();
    for (const files of this.files.values()) files.close();
    for (const timer of this.later.values()) clearTimeout(timer);
  }
}

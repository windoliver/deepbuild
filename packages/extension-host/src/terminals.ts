// Hosted terminals (#104, #989): a piece you approved run-as-you for runs programs, each on a pseudo-terminal held by a
// small host process the supervisor starts under a run token (its native helper in `pty` mode, native/pty.c). The host
// process keeps the program's output in its folder as a ring capped at 8 MiB plus a checkpoint of the screen, and keeps
// the screen itself, so it needs nobody attached: a piece whose manifest's host lives past_app keeps its terminals
// running when the app quits or the hub restarts (the supervisor keeps their runs), and the next launch reattaches over
// the host's socket, which takes a connection only from the process holding the hub's lock. The host states its
// protocol version first; a host of another version runs on, shown read-only from its checkpoint. Input, sizes and the
// tab reach a terminal only through the app's calls on the host (`rawInput`, `resize`, `tab`). An extension host with
// no hub around it, as in a benchmark, takes the hub's lock itself, so its process is the one its hosts take.
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, rmSync, statSync, writeSync } from 'node:fs';
import { connect, type Socket } from 'node:net';
import { dirname, isAbsolute, join } from 'node:path';
import Database from 'better-sqlite3';
import { ulid } from '@deepbuild/record';
import { HELPER, type Supervisor } from '@deepbuild/supervisor';

/** The terminal host protocol this build speaks, and its hosts state when the hub connects. */
export const TERMINAL_PROTOCOL = 2;

export interface Terminal {
  terminal: string;
  /** The package that opened it. */
  id: string;
  /** The supervisor run that owns its host process, its program and everything they start. */
  run: string;
  /** The program's own PID. */
  pid: number;
  title: string;
  /** It lives past the app: its manifest's host does. */
  kept: boolean;
  /** What the hub gave its host at start, which the host states back: kept here, owner-only, and never a piece's. */
  key?: string;
  /** Its entry in the index couldn't be read (#996): it shows as lost, never as closed, and nothing reads or writes it. */
  lost?: true;
}
export interface OpenSpec { argv: string[]; cwd: string; env?: Record<string, string>; cols: number; rows: number; title: string }

/** What the app's tab for a hosted terminal shows now, from the host's screen, or its checkpoint when the host can't be asked. */
export interface TerminalTab {
  terminal: string;
  cols: number;
  rows: number;
  /** The screen, top row first, each row's text with its trailing blanks trimmed. */
  screen: string[];
  /** The scrollback, oldest first, in the same form. */
  scrollback: string[];
  /** Where the cursor is on the screen, 0-based. */
  cursor: { row: number; col: number };
  /** Whether the tab takes input: false while the terminal runs on a host of another protocol version. */
  input: boolean;
  /** What the tab says over its grid, or null. */
  notice: string | null;
  /** Its program and host are gone: the tab offers Resume. */
  ended: boolean;
}

/** #989's planted hubs and hosts: the host's go to it on its command line. */
export const TERMINAL_PLANTS = ['keeps-start-size', 'resize-drops-bottom-rows', 'replays-from-first-byte', 'leaves-files-on-close', 'input-through-fifo',
  'input-blocks-output', 'hub-throws-when-full', 'stops-older-host', 'older-host-reads-ended'] as const;
export type TerminalPlant = typeof TERMINAL_PLANTS[number];
const HOST_PLANTS = new Set(['keeps-start-size', 'resize-drops-bottom-rows', 'replays-from-first-byte', 'input-through-fifo', 'input-blocks-output', 'hub-throws-when-full']);

/** The most a read returns at once. */
const READ = 1024 * 1024;
/** The host's ring, and the most input one write may hand it: a larger one is refused whole. */
const LOG_CAP = 8 * 1024 * 1024;
const INPUT_CAP = 16 * 1024 * 1024;
/** How long a host process gets to start its program, and to answer the hub. */
const START_MS = 10_000;
const ANSWER_MS = 10_000;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const size = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 1 && (v as number) <= 1000;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Writes `bytes` to `path` whole and synced: a temp file, synced, renamed, and its folder synced. */
function writeSynced(path: string, bytes: Uint8Array): void {
  const fd = openSync(`${path}.tmp`, 'w', 0o600);
  try {
    writeSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(`${path}.tmp`, path);
  syncFolder(dirname(path));
}
function syncFolder(dir: string): void {
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** A terminal as the index holds it: anything else in its place is damage. */
const isTerminal = (key: string, t: unknown): t is Terminal => isObj(t) && t.terminal === key && typeof t.id === 'string' && typeof t.run === 'string' && typeof t.kept === 'boolean';

/** A terminal whose entry can't be read, from what of it can (#996); taken as kept: nothing stops what it can't prove it started. */
function lostOne(terminal: string, field: (name: string) => unknown): Terminal {
  const [id, run, pid, title] = [field('id'), field('run'), field('pid'), field('title')];
  return { terminal, id: typeof id === 'string' ? id : '', run: typeof run === 'string' ? run : '', pid: typeof pid === 'number' ? pid : 0, title: typeof title === 'string' ? title : terminal, kept: true, lost: true };
}

/**
 * The entries of an index that can't be read whole, as save() writes it (#996): each entry's fields one a line, four
 * spaces in, between its key line and its closing brace. A run of field lines that parses, whole between the two, is
 * an entry; any other is lost, named by its own terminal field or by the key above it. A bad byte anywhere loses at
 * most its own entry, never a neighbour's.
 */
function salvage(text: string): Record<string, Terminal> {
  const read: Record<string, Terminal> = {};
  const TERM = /^term:[0-9A-Za-z]+$/;
  let key: string | undefined;
  let fields: string[] = [];
  const end = (closed: boolean): void => {
    if (!fields.length) return;
    const body = `{${fields.join('\n').replace(/,\s*$/, '')}}`;
    const lines = fields;
    fields = [];
    try {
      const t = JSON.parse(body) as unknown;
      if (closed && key !== undefined && isTerminal(key, t) && !read[key]) {
        read[key] = t;
        key = undefined;
        return;
      }
    } catch {
      // Lost: named below by what can be read.
    }
    const field = (name: string): unknown => {
      const value = lines.map((l) => new RegExp(`^ {4}"${name}": ("(?:[^"\\\\\\u0000-\\u001f]|\\\\.)*"|\\d+)`).exec(l)?.[1]).find((v) => v !== undefined);
      try { return value === undefined ? undefined : JSON.parse(value); } catch { return undefined; }
    };
    const named = [field('terminal'), key].find((v): v is string => typeof v === 'string' && TERM.test(v));
    // A run a damaged line cut in two: the part that can't name itself belongs to the entry its first part named.
    if (named && !read[named]) read[named] = lostOne(named, field);
    key = undefined;
  };
  for (const line of text.split('\n')) {
    if (/^ {4}"/.test(line)) { fields.push(line); continue; }
    end(/^ {2}\},?$/.test(line));
    const k = /^ {2}"([^"\n]*)": \{\s*$/.exec(line)?.[1];
    if (k !== undefined) key = k;
  }
  end(false);
  return read;
}

/** How many bytes of `buf` end on a whole UTF-8 character: a character the read cut is left for the next one. */
function whole(buf: Buffer): number {
  for (let back = 1; back <= Math.min(3, buf.length); back++) {
    const b = buf[buf.length - back]!;
    if ((b & 0xc0) === 0x80) continue;
    const length = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    return length > back ? buf.length - back : buf.length;
  }
  return buf.length;
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as { code?: string }).code === 'EPERM';
  }
}
function frame(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(5);
  head[0] = type.charCodeAt(0);
  head.writeUInt32LE(body.length, 1);
  return Buffer.concat([head, body]);
}

interface Screen { cols: number; rows: number; cursor: { row: number; col: number }; screen: string[]; scrollback: string[]; total: number }
/** The hub's connection to one host: its hello, and the answers it waits for, in order. */
interface Link { socket: Socket; protocol: number; waiting: ((body: Buffer | Error) => void)[] }

export class Terminals {
  private readonly index: string;
  private readonly open_: Record<string, Terminal>;
  private readonly links = new Map<string, Promise<Link>>();
  private readonly stopped = new Set<string>();
  private lock: Database.Database | undefined | null = null;

  /** What this start found the index unable to say (#996): where it was kept aside, and the terminals it lost. */
  readonly damaged: { aside: string; lost: string[] } | undefined;

  constructor(
    private readonly home: string, private readonly supervisor: Supervisor,
    private readonly options: { protocol: number; refused: (terminal: string, pid: number) => void; plant?: TerminalPlant; point?: () => void; now?: () => number },
  ) {
    this.index = join(home, 'extensions', 'terminals.json');
    const bytes = existsSync(this.index) ? readFileSync(this.index) : Buffer.from('{}');
    let index: unknown;
    try {
      index = JSON.parse(bytes.toString('utf8'));
    } catch {
      // Damaged: read entry by entry below.
    }
    let saved: Record<string, Terminal>;
    if (isObj(index) && Object.entries(index).every(([key, t]) => isTerminal(key, t))) saved = index as Record<string, Terminal>;
    else {
      // One bad byte loses only its own entry. The index's bytes are kept aside, synced, under a name with its time
      // before it is written again, so a cut in between finds the damaged index, never an empty one.
      saved = isObj(index)
        ? Object.fromEntries(Object.entries(index).filter(([key]) => /^term:[0-9A-Za-z]+$/.test(key))
          .map(([key, t]) => [key, isTerminal(key, t) ? t : lostOne(key, (name) => (isObj(t) ? t[name] : undefined))]))
        : salvage(bytes.toString('utf8'));
      const aside = `${this.index}.${new Date(options.now?.() ?? Date.now()).toISOString().replace(/:/g, '-')}`;
      writeSynced(aside, bytes);
      this.damaged = { aside, lost: Object.values(saved).filter((t) => t.lost).map((t) => t.terminal) };
    }
    // One that didn't live past the app was reaped with its run when the supervisor opened.
    this.open_ = Object.fromEntries(Object.entries(saved).filter(([, t]) => t.kept));
  }
  /** Writes a damaged index again as this start read it, once its reading is recorded: a cut in between finds it damaged still. */
  settle(): void {
    if (this.damaged) this.save();
  }

  /** Once the hub first talks to a host: the hub's lock, unless a process holds it already. */
  private locked(): void {
    if (this.lock === null) this.lock = holdLock(this.lockPath());
  }
  private lockPath(): string {
    return join(this.home, 'hub-lock.sqlite');
  }
  /** Writes the index whole and synced, owner-only (it holds each host's key), one numbered durable write point. */
  private save(): void {
    mkdirSync(join(this.home, 'extensions'), { recursive: true });
    writeSynced(this.index, Buffer.from(JSON.stringify(this.open_, null, 2)));
    this.options.point?.();
  }
  private dir(terminal: string): string {
    return join(this.home, 'terminals', terminal.slice('term:'.length));
  }
  private known(terminal: string): Terminal {
    const t = this.open_[terminal];
    if (!t) throw Error(`no terminal ${String(terminal)} is open`);
    if (t.lost) throw Error(`${terminal} is lost: its entry in the terminals index couldn't be read`);
    return t;
  }

  async open(id: string, spec: OpenSpec, kept: boolean): Promise<Terminal> {
    const { argv, cwd, env, cols, rows, title } = spec ?? ({} as OpenSpec);
    if (!strings(argv) || !argv.length || typeof cwd !== 'string' || !isAbsolute(cwd) || (env !== undefined && (typeof env !== 'object' || !strings(Object.values(env ?? {}))))
      || !size(cols) || !size(rows) || typeof title !== 'string') {
      throw Error('deep.terminal.open takes {argv: [program, ...args], cwd: an absolute path, env?: {name: value}, cols, rows: 1 to 1000, title}');
    }
    const terminal = `term:${ulid(Date.now())}`;
    const key = randomBytes(32).toString('hex');
    const run = `run:${ulid(Date.now())}`;
    const dir = this.dir(terminal);
    // Owner-only: the log can hold whatever the program printed.
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const plants = this.options.plant && HOST_PLANTS.has(this.options.plant) ? this.options.plant : '-';
    const started = await this.supervisor.start({
      run, argv: [HELPER, 'pty', dir, String(cols), String(rows), String(this.options.protocol), this.lockPath(), plants, ...argv],
      cwd, env: env ?? {}, grant: { run_as_you: true, own: [dir] }, keep: kept, input: Buffer.from(`${key}\n`),
    });
    if (started.status !== 'started') throw Error(`the sandbox held ${title}'s terminal: BLOCKED on ${started.kind}`);
    let ended = false;
    void this.supervisor.wait(run).then(() => { ended = true; }, () => { ended = true; });
    const note = join(dir, 'pid');
    for (const until = Date.now() + START_MS; !existsSync(note); await sleep(10)) {
      if (ended || Date.now() > until) {
        await this.supervisor.cleanup(run).catch(() => undefined);
        throw Error(`${title}'s terminal didn't start ${argv[0]}`);
      }
    }
    const t: Terminal = { terminal, id, run, pid: Number(readFileSync(note, 'utf8')), title, kept, key };
    this.open_[terminal] = t;
    this.save();
    void this.link(terminal).catch(() => undefined);
    return t;
  }

  /** Reattaches every terminal an earlier launch left running, so a writer refused meanwhile is recorded now. */
  attach(): void {
    for (const terminal of Object.keys(this.open_).filter((k) => !this.open_[k]!.lost)) void this.link(terminal).catch(() => undefined);
  }

  /** The connection to the terminal's host, made once: the host states its protocol version first. */
  private link(terminal: string): Promise<Link> {
    const had = this.links.get(terminal);
    if (had) return had;
    this.locked();
    const made = new Promise<Link>((resolve, reject) => {
      const socket = connect(join(this.dir(terminal), 'sock'));
      let link: Link | undefined;
      let buf: Buffer = Buffer.alloc(0);
      const gone = (why: Error): void => {
        if (this.links.get(terminal) === made) this.links.delete(terminal);
        if (!link) reject(why);
        else for (const w of link.waiting.splice(0)) w(why);
      };
      socket.on('error', (e) => gone(e));
      socket.on('close', () => gone(Error(`${terminal}'s host process ${link ? 'went away' : 'refused this hub, which doesn\'t hold the hub\'s lock'}`)));
      socket.on('data', (data: Buffer) => {
        buf = buf.length ? Buffer.concat([buf, data]) : data;
        while (buf.length >= 5 && buf.length >= 5 + buf.readUInt32LE(1)) {
          const type = String.fromCharCode(buf[0]!);
          const body = buf.subarray(5, 5 + buf.readUInt32LE(1));
          buf = buf.subarray(5 + body.length);
          let said: { protocol?: unknown; key?: unknown; pid?: unknown };
          try {
            said = type === 'H' || type === 'N' ? JSON.parse(body.toString('utf8')) as typeof said : {};
          } catch {
            socket.destroy(Error(`${terminal}'s host process sent a ${type} that isn't JSON`));
            return;
          }
          if (type === 'H') {
            const protocol = Number(said.protocol);
            // Whatever answers at the path isn't trusted for it: a host of this version states the key its hub gave it.
            if (protocol === this.options.protocol && said.key !== this.open_[terminal]?.key) {
              socket.destroy(Error(`what answers at ${terminal}'s socket isn't the host this hub started: its key differs`));
              return;
            }
            link = { socket, protocol, waiting: [] };
            resolve(link);
          } else if (type === 'N') {
            this.options.refused(terminal, Number(said.pid));
          } else link?.waiting.shift()?.(body);
        }
      });
    });
    this.links.set(terminal, made);
    return made;
  }
  /** One call on the host, answered in order; input waits as long as the host's queue is full, with no deadline. */
  private async call(terminal: string, type: string, body?: Buffer): Promise<Buffer> {
    const link = await this.current(terminal);
    return new Promise<Buffer>((resolve, reject) => {
      const timer = type === 'I' ? undefined : setTimeout(() => reject(Error(`${terminal}'s host process didn't answer in ${ANSWER_MS} ms`)), ANSWER_MS);
      link.waiting.push((answer) => { clearTimeout(timer); if (answer instanceof Error) reject(answer); else resolve(answer); });
      link.socket.write(frame(type, body));
    });
  }
  /** The link to a host of the version this hub speaks; a host of another one is never written to. */
  private async current(terminal: string): Promise<Link> {
    const link = await this.link(terminal);
    if (link.protocol !== this.options.protocol) throw Error(`${terminal} runs on ${this.other(link.protocol)}; this hub speaks protocol ${this.options.protocol}, so its input stays off until the session ends and is resumed`);
    return link;
  }
  private other(protocol: number): string {
    return `${protocol < this.options.protocol ? 'an older' : 'a newer'} host (protocol ${protocol})`;
  }

  /** The package's open terminals, those an earlier launch opened among them. */
  of(id: string): Terminal[] {
    return Object.values(this.open_).filter((t) => t.id === id);
  }
  all(): Terminal[] {
    return Object.values(this.open_);
  }

  /** What the program wrote that the log still holds, from byte `from` of its output, as whole UTF-8 characters, and the offset to read on from. */
  async read(id: string, terminal: string, from: number): Promise<{ text: string; next: number }> {
    const t = this.open_[terminal];
    if (!t || t.id !== id) throw Error(`${id} has no terminal ${String(terminal)}`);
    if (t.lost) throw Error(`${terminal} is lost: its entry in the terminals index couldn't be read`);
    if (!Number.isSafeInteger(from) || from < 0) throw Error('deep.terminal.read takes the terminal and a byte offset from 0');
    const dir = this.dir(terminal);
    // A host from before #989 appends every byte to `out`, which reads from the first.
    const legacy = !existsSync(join(dir, 'log')) && existsSync(join(dir, 'out'));
    const uncapped = legacy || this.options.plant === 'replays-from-first-byte';
    const span = async (): Promise<{ start: number; total: number }> => {
      try {
        return JSON.parse((await this.call(terminal, 'O')).toString('utf8')) as { start: number; total: number };
      } catch {
        // A host that can't be asked: what its file holds, or what its last checkpoint says the ring held.
        const total = legacy ? statSync(join(dir, 'out')).size : this.checkpoint(terminal)?.total ?? 0;
        return { start: uncapped ? 0 : Math.max(0, total - LOG_CAP), total };
      }
    };
    let held = await span();
    let at = Math.max(from, held.start);
    let bytes: Buffer = Buffer.alloc(0);
    for (let tries = 0; tries < 3; tries++) {
      bytes = this.readLog(join(dir, legacy ? 'out' : 'log'), at, Math.min(READ, Math.max(0, held.total - at)), uncapped);
      if (uncapped) break;
      // The ring wrapped while it was read: what was overwritten under these offsets goes, or the read starts again.
      const after = await span();
      if (after.start <= at) break;
      if (after.start - at < bytes.length) {
        bytes = bytes.subarray(after.start - at);
        at = after.start;
        break;
      }
      held = after;
      at = after.start;
    }
    const used = whole(bytes);
    return { text: bytes.subarray(0, used).toString('utf8'), next: at + used };
  }
  /** `want` bytes of output from offset `at`: from the ring's position for it, or the file's own for a file that keeps every byte. */
  private readLog(path: string, at: number, want: number, uncapped: boolean): Buffer {
    const buf = Buffer.alloc(want);
    let got = 0;
    const fd = openSync(path, 'r');
    try {
      while (got < want) {
        const pos = uncapped ? at + got : (at + got) % LOG_CAP;
        const n = readSync(fd, buf, got, uncapped ? want - got : Math.min(want - got, LOG_CAP - pos), pos);
        if (n <= 0) break;
        got += n;
      }
    } finally {
      closeSync(fd);
    }
    return buf.subarray(0, got);
  }

  private checkpoint(terminal: string): (Screen & { modes: number[] }) | undefined {
    try {
      return JSON.parse(readFileSync(join(this.dir(terminal), 'checkpoint'), 'utf8')) as Screen & { modes: number[] };
    } catch {
      return undefined;
    }
  }
  /** What the tab shows: the host's screen, or, from a host of another version or one that's gone, its last checkpoint. */
  async tab(terminal: string): Promise<TerminalTab> {
    const t = this.known(terminal);
    let link: Link | undefined;
    try {
      link = await this.link(terminal);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code !== 'ENOENT' && code !== 'ECONNREFUSED') throw e;
    }
    // No socket, or nobody at it: a host from before #989 if its program runs, else the session ended.
    const before989 = !link && alive(t.pid);
    if (link && link.protocol === this.options.protocol) {
      const s = JSON.parse((await this.call(terminal, 'S')).toString('utf8')) as Screen;
      return { terminal, cols: s.cols, rows: s.rows, screen: s.screen, scrollback: s.scrollback, cursor: s.cursor, input: true, notice: null, ended: false };
    }
    if (link && this.options.plant === 'stops-older-host' && !this.stopped.has(terminal)) {
      this.stopped.add(terminal);
      await this.supervisor.cleanup(t.run).catch(() => undefined);
    }
    const c = this.checkpoint(terminal);
    const shown = { terminal, cols: c?.cols ?? 0, rows: c?.rows ?? 0, screen: c?.screen ?? [], scrollback: c?.scrollback ?? [], cursor: c?.cursor ?? { row: 0, col: 0 }, input: false };
    if (!link && !before989) return { ...shown, notice: null, ended: true };
    return {
      ...shown,
      notice: `This terminal runs on ${this.other(link?.protocol ?? 1)}; this hub speaks protocol ${this.options.protocol}. It shows the last checkpoint, read-only, until the session ends and is resumed under the current host.`,
      ended: this.options.plant === 'older-host-reads-ended',
    };
  }

  /** The tab's size in cells: the host sets the terminal's, which signals the program, and its screen's. */
  async resize(terminal: string, cols: number, rows: number): Promise<void> {
    this.known(terminal);
    if (!size(cols) || !size(rows)) throw Error('a terminal\'s size is 1 to 1000 columns and rows');
    const body = Buffer.alloc(4);
    body.writeUInt16LE(cols, 0);
    body.writeUInt16LE(rows, 2);
    await this.call(terminal, 'R', body);
  }

  /** Writes `text` to the terminal's program, through its host process: resolves once the host has taken all of it. */
  async input(terminal: string, text: string): Promise<void> {
    this.known(terminal);
    if (typeof text !== 'string') throw Error('raw input is text');
    const bytes = Buffer.from(text, 'utf8');
    if (bytes.length > INPUT_CAP) throw Error(`raw input for ${terminal} is ${bytes.length} bytes, over the ${INPUT_CAP} one write may hold, so none of it was sent`);
    if (this.options.plant === 'hub-throws-when-full') {
      // The planted hub: no backpressure, and a throw once the host's input is full, part of it sent.
      const link = await this.current(terminal);
      for (let done = 0; done < bytes.length; done += 65536) {
        if (!link.socket.write(frame('I', bytes.subarray(done, done + 65536)))) throw Error(`${terminal}'s input is full at byte ${done + 65536}`);
      }
      return;
    }
    // The socket holds what the host hasn't read yet; the host reads on as its queue drains.
    await this.call(terminal, 'I', bytes);
  }

  /** Stops every process the terminal's run owns, its host process, its program and everything they started, and removes its folder. */
  async stop(t: Terminal): Promise<void> {
    // A lost one's run and folder are what damaged bytes say: nothing stops or removes what it can't prove it started.
    if (t.lost) throw Error(`${t.terminal} is lost: its entry in the terminals index couldn't be read, so it isn't closed`);
    await this.supervisor.cleanup(t.run);
    this.drop(t.terminal);
    delete this.open_[t.terminal];
    this.save();
    if (this.options.plant !== 'leaves-files-on-close') rmSync(this.dir(t.terminal), { recursive: true, force: true });
  }
  /** Forgets the terminal, leaving whatever still runs (the planted wrong programs). */
  forget(t: Terminal): void {
    this.drop(t.terminal);
    delete this.open_[t.terminal];
    this.save();
  }
  private drop(terminal: string): void {
    const link = this.links.get(terminal);
    this.links.delete(terminal);
    void link?.then((l) => l.socket.destroy(), () => undefined);
  }
  /** The hub stops: its connections go, and the hosts run on. */
  close(): void {
    for (const terminal of [...this.links.keys()]) this.drop(terminal);
    this.lock?.close();
  }
}

/**
 * The hub's lock, taken as the hub takes it (packages/hub/src/lock.ts) when no process holds it; undefined when one
 * does, as the hub around this extension host does. Only SQLite opens the file: closing any other descriptor on it
 * would drop this process's fcntl locks, the hub's among them.
 */
function holdLock(path: string): Database.Database | undefined {
  const db = new Database(path, { timeout: 0 });
  try {
    db.pragma('locking_mode = EXCLUSIVE');
    db.exec('BEGIN EXCLUSIVE');
    return db;
  } catch (e) {
    db.close();
    if ((e as { code?: string }).code !== 'SQLITE_BUSY') throw e;
    return undefined;
  }
}


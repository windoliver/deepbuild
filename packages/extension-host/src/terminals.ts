// Hosted terminals (#104): a piece you approved run-as-you for runs programs, each on a pseudo-terminal held by a small
// host process the supervisor starts under a run token (its native helper in `pty` mode). The host process appends
// everything the program writes to the terminal's `out` file and writes what comes through its `in` FIFO to the
// program, so it needs nobody attached: a piece whose manifest's host lives past_app keeps its terminals running when
// the app quits or the hub restarts (the supervisor keeps their runs), and the next launch reads them on from the
// same files, from the first byte. Input reaches a terminal only through `input`, which the host calls for the app.
import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { ulid } from '@deepbuild/record';
import { HELPER, type Supervisor } from '@deepbuild/supervisor';

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
  /** Its entry in the index couldn't be read (#996): it shows as lost, never as closed, and nothing reads or writes it. */
  lost?: true;
}
export interface OpenSpec { argv: string[]; cwd: string; env?: Record<string, string>; cols: number; rows: number; title: string }

/** The most a read returns at once. */
const READ = 1024 * 1024;
/** How long a host process gets to start its program. */
const START_MS = 10_000;
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
 * The entries of an index that can't be read whole, as save() writes it, one key a line (#996): each entry that parses
 * on its own, and each that doesn't as lost, named by its key or, with its key damaged, by its own terminal field.
 */
function salvage(text: string): Record<string, Terminal> {
  const keys = [...text.matchAll(/^ {2}"([^\n]*)": (?=\{)/gm)];
  const read: Record<string, Terminal> = {};
  keys.forEach((key, i) => {
    let body = text.slice(key.index + key[0].length, keys[i + 1]?.index ?? text.length).trimEnd();
    // The last entry ends with the index's own brace.
    if (i === keys.length - 1) body = body.replace(/\}$/, '').trimEnd();
    body = body.replace(/,$/, '');
    try {
      const t = JSON.parse(body) as unknown;
      if (isTerminal(key[1]!, t)) {
        read[t.terminal] = t;
        return;
      }
    } catch {
      // Lost: named below by what can be read.
    }
    const field = (name: string): unknown => {
      const value = new RegExp(`"${name}": ("(?:[^"\\\\\\u0000-\\u001f]|\\\\.)*"|\\d+)`).exec(body)?.[1];
      try { return value === undefined ? undefined : JSON.parse(value); } catch { return undefined; }
    };
    const named = [key[1], field('terminal')].find((v): v is string => typeof v === 'string' && /^term:[0-9A-Za-z]+$/.test(v));
    if (named) read[named] = lostOne(named, field);
  });
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

export class Terminals {
  private readonly index: string;
  private readonly open_: Record<string, Terminal>;

  /** What this start found the index unable to say (#996): where it was kept aside, and the terminals it lost. */
  readonly damaged: { aside: string; lost: string[] } | undefined;

  constructor(private readonly home: string, private readonly supervisor: Supervisor, private readonly point: () => void = () => {}) {
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
      const aside = `${this.index}.${new Date().toISOString().replace(/:/g, '-')}`;
      writeSynced(aside, bytes);
      this.damaged = { aside, lost: Object.values(saved).filter((t) => t.lost).map((t) => t.terminal) };
    }
    // One that didn't live past the app was reaped with its run when the supervisor opened.
    this.open_ = Object.fromEntries(Object.entries(saved).filter(([, t]) => t.kept));
    if (this.damaged) this.save();
  }
  /** Writes the index whole and synced, one numbered durable write point. */
  private save(): void {
    mkdirSync(join(this.home, 'extensions'), { recursive: true });
    writeSynced(this.index, Buffer.from(JSON.stringify(this.open_, null, 2)));
    this.point();
  }
  private dir(terminal: string): string {
    return join(this.home, 'terminals', terminal.slice('term:'.length));
  }

  async open(id: string, spec: OpenSpec, kept: boolean): Promise<Terminal> {
    const { argv, cwd, env, cols, rows, title } = spec ?? ({} as OpenSpec);
    if (!strings(argv) || !argv.length || typeof cwd !== 'string' || !isAbsolute(cwd) || (env !== undefined && (typeof env !== 'object' || !strings(Object.values(env ?? {}))))
      || !size(cols) || !size(rows) || typeof title !== 'string') {
      throw Error('deep.terminal.open takes {argv: [program, ...args], cwd: an absolute path, env?: {name: value}, cols, rows: 1 to 1000, title}');
    }
    const terminal = `term:${ulid(Date.now())}`;
    const run = `run:${ulid(Date.now())}`;
    const dir = this.dir(terminal);
    mkdirSync(dir, { recursive: true });
    const started = await this.supervisor.start({
      run, argv: [HELPER, 'pty', dir, String(cols), String(rows), ...argv], cwd, env: env ?? {}, grant: { run_as_you: true }, keep: kept,
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
    const t: Terminal = { terminal, id, run, pid: Number(readFileSync(note, 'utf8')), title, kept };
    this.open_[terminal] = t;
    this.save();
    return t;
  }

  /** The package's open terminals, those an earlier launch opened among them. */
  of(id: string): Terminal[] {
    return Object.values(this.open_).filter((t) => t.id === id);
  }
  all(): Terminal[] {
    return Object.values(this.open_);
  }

  /** What the program wrote, from byte `from`, as whole UTF-8 characters, and the offset to read on from. */
  read(id: string, terminal: string, from: number): { text: string; next: number } {
    const t = this.open_[terminal];
    if (!t || t.id !== id) throw Error(`${id} has no terminal ${String(terminal)}`);
    if (t.lost) throw Error(`${terminal} is lost: its entry in the terminals index couldn't be read`);
    if (!Number.isSafeInteger(from) || from < 0) throw Error('deep.terminal.read takes the terminal and a byte offset from 0');
    const fd = openSync(join(this.dir(terminal), 'out'), 'r');
    try {
      const buf = Buffer.alloc(READ);
      const n = readSync(fd, buf, 0, READ, from);
      const used = n === READ ? whole(buf.subarray(0, n)) : n;
      return { text: buf.subarray(0, used).toString('utf8'), next: from + used };
    } finally {
      closeSync(fd);
    }
  }

  /** Writes `text` to the terminal's program, through its host process. */
  input(terminal: string, text: string): void {
    if (!this.open_[terminal]) throw Error(`no terminal ${String(terminal)} is open`);
    if (this.open_[terminal]!.lost) throw Error(`${terminal} is lost: its entry in the terminals index couldn't be read`);
    if (typeof text !== 'string') throw Error('raw input is text');
    let fd: number;
    try {
      fd = openSync(join(this.dir(terminal), 'in'), constants.O_WRONLY | constants.O_NONBLOCK);
    } catch {
      throw Error(`${terminal}'s host process isn't running`);
    }
    try {
      const bytes = Buffer.from(text, 'utf8');
      for (let done = 0; done < bytes.length;) done += writeSync(fd, bytes, done);
    } finally {
      closeSync(fd);
    }
  }

  /** Stops every process the terminal's run owns: its host process, its program and everything they started. */
  async stop(t: Terminal): Promise<void> {
    if (t.run) await this.supervisor.cleanup(t.run);
    delete this.open_[t.terminal];
    this.save();
  }
  /** Forgets the terminal, leaving whatever still runs (the planted wrong programs). */
  forget(t: Terminal): void {
    delete this.open_[t.terminal];
    this.save();
  }
}

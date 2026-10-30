// The hub's canvas side (#806): deep_show from an agent's deep mcp and `deep show` from the CLI land here, stamped as
// the session the binding or the peer check names, never as the payload says. The canvas core it runs them through is
// `deep-show serve`, the checkout's build of the canvas crates (#393's stand-in, long-lived), one process per hub: it
// holds the documents, their revisions and writer layers, checks each revision, renders back settled snapshots
// headless with Vello CPU, and keeps the issues and snapshots in the hub's evidence store by hash. This module gives it
// the hub's world (the sessions bound, the documents minted, the record's asks and readings, claims), records each
// revision it makes as doc.patched@2 with the canonical document in evidence, and hands each presented revision to
// the app over its socket. With no app connected, the reply is the headless worker's all the same.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { refuse } from './wire.js';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** deep_show answers within 2 s (Admission and latch): a presentation that waits for an app gives up then. */
const PRESENT_MS = 2000;

/** The canvas core's binary: the checkout's build of `deep-show`, the newer of release and debug. */
export function canvasCore(): string {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const built = ['release', 'debug'].map((p) => join(repo, 'target', p, 'deep-show')).filter((p) => existsSync(p));
  if (!built.length) throw refuse('unavailable', '', `No canvas core is built under ${join(repo, 'target')}; run cargo build --bin deep-show first.`, 'deep-show', true);
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}

/** One session as the canvas core takes it: its thread, the name its outline shows. */
export interface CanvasSession { id: string; thread: string; name: string }
/** What the hub knows that the canvas core reads: the world file a test gives (DEEP_HUB_TEST_SHOW) and the record. */
export interface CanvasWorld {
  sessions: CanvasSession[];
  /** The record's objects a binding can read, each with the session it belongs to. */
  record: Obj;
  /** The panels, documents, claims, window, card and fault of the world file; empty without one. */
  file: Obj;
}

/** One call to the canvas core: who it writes as, and #393's call fields. */
export type CanvasCall = Obj;

/** The long-lived canvas core: one call at a time, in order. */
export class Canvas {
  private child: ChildProcessWithoutNullStreams | undefined;
  private waiting: ((line: Obj) => void)[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  private world = '';

  constructor(private readonly evidence: string) {}

  private start(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(canvasCore(), ['serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.resume();
    createInterface({ input: child.stdout }).on('line', (line) => {
      let value: Obj;
      try { value = JSON.parse(line) as Obj; } catch { value = { ok: false, code: 'bad_output' }; }
      this.waiting.shift()?.(value);
    });
    child.on('exit', () => {
      if (this.child === child) this.child = undefined;
      this.world = '';
      for (const wake of this.waiting.splice(0)) wake({ ok: false, code: 'canvas_core_exited' });
    });
    this.child = child;
    return child;
  }
  private send(line: Obj): Promise<Obj> {
    const child = this.start();
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      child.stdin.write(`${JSON.stringify(line)}\n`);
    });
  }

  /** Plays one call against the world as it stands, after every call before it: its reply, and the revision it presented. */
  call(world: CanvasWorld, call: CanvasCall): Promise<{ reply: Obj; presented?: Obj }> {
    const run = this.chain.then(async () => {
      const shaped = shape(world, this.evidence);
      const text = JSON.stringify(shaped);
      if (text !== this.world) {
        const set = await this.send({ world: shaped });
        if (set.ok !== true) throw refuse('unavailable', '', `The canvas core refused the hub's world: ${JSON.stringify(set).slice(0, 300)}`, 'canvas', true);
        this.world = text;
      }
      const answer = await this.send({ call });
      if (answer.ok !== true || !isObj(answer.reply)) throw refuse('unavailable', '', `The canvas core gave no reply to ${String(call.call)}: ${JSON.stringify(answer).slice(0, 300)}`, String(call.call), true);
      return { reply: answer.reply, ...(isObj(answer.presented) ? { presented: answer.presented } : {}) };
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  close(): void {
    this.child?.kill();
  }
}

/** The world as `deep-show serve` reads it: #393's scenario fields, sessions keyed by session ID. */
function shape(world: CanvasWorld, evidence: string): Obj {
  const sessions: Obj = {};
  for (const s of world.sessions) sessions[s.id] = { thread: s.thread, name: s.name, process: { pid: 0, start: 0 } };
  const out: Obj = { evidence, sessions, record: world.record };
  for (const key of ['panels', 'docs', 'claims', 'window', 'card', 'fault']) if (world.file[key] !== undefined) out[key] = world.file[key];
  return out;
}

/** The world file a test gives the hub (DEEP_HUB_TEST_SHOW), read again whenever it changes, as rules.json is. */
export class WorldFile {
  private seen = { key: '', value: {} as Obj };
  constructor(private readonly path: string | undefined) {}
  read(): Obj {
    if (!this.path) return {};
    let key = 'none';
    try {
      const s = statSync(this.path);
      key = `${s.ino}:${s.size}:${s.mtimeMs}`;
    } catch { /* gone: nothing minted */ }
    if (key !== this.seen.key) {
      let value: Obj = {};
      try { const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown; if (isObj(parsed)) value = parsed; } catch { /* unreadable: nothing */ }
      this.seen = { key, value };
    }
    return this.seen.value;
  }
}

/** The name an agent's outline shows: the world file's, by session ID or by agent; else the agent and its session. */
export function nameOf(file: Obj, session: string, agent: string): string {
  const names = isObj(file.names) ? file.names : {};
  const named = names[session] ?? names[agent];
  return typeof named === 'string' ? named : `${agent === 'codex' ? 'Codex' : agent === 'claude-code' ? 'Claude Code' : agent}: ${session.slice(0, 8)}`;
}

/**
 * A presented revision waits for the app to draw it, under the plant that makes deep_show wait for one, and gives
 * up at 2 s; without the plant the reply never waits: render-back is the headless worker's.
 */
export function waitForApp(appConnected: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (appConnected()) return resolve(true);
      if (Date.now() - started >= PRESENT_MS) return resolve(false);
      setTimeout(tick, 25);
    };
    tick();
  });
}

/**
 * A deep_show call's fields as the canvas core takes them (#393's): the document and a patch parsed from their JSON
 * text, and the fields left null dropped, so the core's defaults hold. With no document or patch, a render-back of
 * `rev` (any revision the document has had) at `t`.
 */
export function showCall(args: Obj): Obj {
  const parse = (key: string): unknown => {
    const v = args[key];
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v) as unknown; } catch { throw refuse('type', `/params/arguments/${key}`, `Give ${key} as one JSON object's text.`, v.slice(0, 200)); }
  };
  const out: Obj = { doc: args.doc };
  for (const key of ['removes', 't', 'size', 'include', 'check', 'claim'] as const) if (args[key] !== null && args[key] !== undefined) out[key] = args[key];
  const document = parse('document');
  const patch = parse('patch');
  if (document !== null && document !== undefined) out.document = document;
  else if (patch !== null && patch !== undefined) out.patch = patch;
  else return { call: 'render_back', doc: args.doc, t: flicksOf(String(args.t ?? '0s')), rev: args.rev ?? null, ...(out.size ? { size: out.size } : {}) };
  return out;
}
/** A time in the grammar's seconds (`4.2s`) as flicks, 705,600,000 a second; refused when it isn't one. */
function flicksOf(t: string): number {
  const m = /^(\d+(?:\.\d+)?)s$/.exec(t);
  if (!m) throw refuse('pattern', '/params/arguments/t', 'Give t in seconds, such as 0s or 4.2s.', t);
  return Math.round(Number.parseFloat(m[1]!) * 705_600_000);
}

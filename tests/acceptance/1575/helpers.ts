// Test-side tools for the #1575 acceptance tests. The hub as a process, the line-protocol client, hook requests,
// temp homes, cleanup and the timing judge are #16's, and the app connection, the log's end and the reference-Mac
// rule are #34's, reused as they are. What is new here is what #1575's surface needs (README, The surface): the
// names the issue leaves open, each in one place; a stream as a slow reader sees it; the judges each criterion's
// failure message comes from; and the planted wrong hubs, which sit between a reader and a real hub.
import net from 'node:net';
import { join } from 'node:path';
import { Conn, hookRequest, fromHere, logEnd, result, sendHook, sleep, tokenOf, type Line, type Session } from '../34/helpers.ts';

export {
  asApp, asCli, cleanup, Confirmer, confirmEnv, Conn, DAY, fromHere, hookRequest, installedRoot, judge, logEnd, makeHome, newSession,
  notReferenceMac, p95, result, sendHook, sleep, startHub, tempDir, tokenOf, ulid, waitFor,
  type Hub, type HubOptions, type Line, type Session,
} from '../34/helpers.ts';

// ---- The surface #1575 leaves open. Each name is here once; a different choice is a one-line change.

/** stream.subscribe's param that names one session as the scope. With no scope, the subscribe is the app's. */
export const scopedTo = (session: string): Line => ({ scope: { kind: 'session', session } });
/** The session a subscribe's params are scoped to, if any (the planted hubs read it). */
const scopeSession = (params: Line): string | undefined => (params.scope?.kind === 'session' ? String(params.scope.session) : undefined);
/** The reply that says "read a fresh snapshot": no frame follows it on that subscription. */
export const saysSnapshot = (reply: Line): boolean => reply.result?.snapshot === true;
/** The head position a subscribe's reply names. */
export const headOf = (reply: Line): unknown => reply.result?.head;
/** The frame that marks reaching the head, `{v, id, caught_up: <log_pos>}`: the position it marks, else undefined. */
export const caughtUpAt = (line: Line): number | undefined => (typeof line.caught_up === 'number' ? line.caught_up : undefined);
/** A held reader's report: the fell_behind refusal, whose `actual` is the JSON text `{"frames": n, "bytes": n}`. */
export function reportOf(cut: Line): { frames: number; bytes: number } | undefined {
  try {
    const counts = JSON.parse(String(cut.error?.actual)) as Line;
    return Number.isSafeInteger(counts.frames) && Number.isSafeInteger(counts.bytes) ? { frames: counts.frames as number, bytes: counts.bytes as number } : undefined;
  } catch {
    return undefined;
  }
}
/** The replay cap in events (the issue's Scope). */
export const REPLAY_CAP = 128;
/** The issue names no number for the byte cap on a reader that stops reading; this suite needs it at or under this. */
export const BYTE_CAP_AT_MOST = 16 << 20;
/** The base's frame cap (#34): a reader held with fewer frames than this was held by bytes. */
export const FRAME_CAP = 10_000;

// ---- A stream as a reader sees it.

export interface Stream { sub: string; reply: Line; from: number }
/** Subscribes with these params; resolves with the subscription's id and its reply line (a result or a refusal). */
export async function subscribe(conn: Conn, params: Line): Promise<Stream> {
  const from = conn.received.length;
  const reply = await conn.call('stream.subscribe', params, 30_000);
  return { sub: reply.id as string, reply, from };
}
export interface Got { events: Line[]; caught: number[]; cut: Line | undefined; frames: number; bytes: number; lines: Line[] }
/**
 * What one subscription carried after its reply: its event frames, the positions its caught-up frames mark, its
 * cut-off line, and the count and bytes of its event frames as they crossed the socket. `lines` keeps the order.
 */
export function got(conn: Conn, s: Stream): Got {
  const out: Got = { events: [], caught: [], cut: undefined, frames: 0, bytes: 0, lines: [] };
  for (const r of conn.received.slice(s.from)) {
    const line = r.json;
    if (!line || line.id !== s.sub || 'result' in line) continue;
    out.lines.push(line);
    if (line.event) { out.events.push(line.event as Line); out.frames++; out.bytes += Buffer.byteLength(r.raw) + 1; }
    else if (caughtUpAt(line) !== undefined) out.caught.push(caughtUpAt(line)!);
    else if (line.error) out.cut = line;
  }
  return out;
}
const positions = (events: readonly Line[]): number[] => events.map((e) => e.log_pos as number);

/** Every event after `after`, through events.read. */
export async function eventsAfter(conn: Conn, after: number): Promise<Line[]> {
  const out: Line[] = [];
  for (;;) {
    const page = result(await conn.call('events.read', { after, limit: 1000 }, 30_000));
    const events = page.events as Line[];
    if (!events.length) return out;
    out.push(...events);
    after = events[events.length - 1]!.log_pos as number;
  }
}
/** Waits until the log's end hasn't moved for `ms`: what the hub appends by itself after a hook has landed. */
export async function settled(conn: Conn, ms = 700): Promise<number> {
  let end = await logEnd(conn);
  for (;;) {
    await sleep(ms);
    const now = (await eventsAfter(conn, end)).pop()?.log_pos as number | undefined;
    if (now === undefined) return end;
    end = now;
  }
}
/** Waits until a subscription has carried nothing new for `ms`, or was cut off. */
export async function quiet(conn: Conn, s: Stream, ms = 1000): Promise<Got> {
  let seen = -1;
  for (;;) {
    const now = got(conn, s);
    if (now.cut || now.lines.length === seen) return now;
    seen = now.lines.length;
    await sleep(ms);
  }
}
/** `n` PreToolUse hooks of one session, one after another; each appends one tool.before. */
export async function hooks(socket: string, s: Session, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const r = await sendHook(socket, fromHere(hookRequest(s, 'PreToolUse')));
    if (!r.ack) throw Error(`BLOCKED: setup: the hub didn't acknowledge a hook: ${JSON.stringify(r)}`);
  }
}
/** The positions of a session's events among these. */
export const of = (events: readonly Line[], session: string): number[] => positions(events.filter((e) => e.session === session));

// ---- Judges. Each returns the failure the criterion names, or null; the tests assert null.

const refused = (what: string, reply: Line): string => `the hub refused ${what}: ${String(reply.error?.code)} (${String(reply.error?.remediation)})`;

/** AC2's judge: a reader scoped to `session` got every frame of its own session and none of another's. */
export function judgeScope(session: string, reply: Line, events: readonly Line[], own: readonly number[]): string | null {
  if (!reply.result) return refused(`a subscribe scoped to session ${session}`, reply);
  const other = events.filter((e) => typeof e.session === 'string' && e.session !== session);
  if (other.length) {
    const first = other[0]!;
    const count = other.filter((e) => e.session === first.session).length;
    return `a reader scoped to session ${session} got ${count} frame${count === 1 ? '' : 's'} for session ${String(first.session)}, the first at log_pos ${String(first.log_pos)}`;
  }
  const seen = new Set(positions(events));
  const lost = own.find((p) => !seen.has(p));
  if (lost !== undefined) return `a reader scoped to session ${session} never got its own session's log_pos ${lost}`;
  return null;
}
/** AC3's judge, the reply: a reader `behind` events behind is told to read a snapshot, and no event is replayed to it. */
export function judgeSnapshot(behind: number, reply: Line, replayed: number): string | null {
  if (!reply.result) return refused(`a subscribe ${behind} events behind`, reply);
  if (!saysSnapshot(reply)) return `a reader ${behind} events behind got no snapshot reply: the hub replayed ${replayed} events`;
  if (replayed) return `a reader ${behind} events behind got a snapshot reply and ${replayed} replayed events after it`;
  return null;
}
/** AC3's judge, the rest: after reading the snapshot at `at` and subscribing after it, every later event arrived, in order, once. */
export function judgeAfterSnapshot(at: number, reply: Line, frames: readonly number[], expected: readonly number[]): string | null {
  if (!reply.result) return refused(`the subscribe after the snapshot's log_pos ${at}`, reply);
  if (saysSnapshot(reply)) return `subscribed after the snapshot's own log_pos ${at}, the reader was told to read a snapshot again`;
  const early = frames.find((p) => p <= at);
  if (early !== undefined) return `log_pos ${early} arrived again after the snapshot at ${at} held it`;
  const lost = expected.find((p) => !frames.includes(p));
  if (lost !== undefined) return `log_pos ${lost} was missed after the snapshot at ${at}`;
  if (JSON.stringify(frames) !== JSON.stringify(expected)) return `after the snapshot at ${at} the frames were ${JSON.stringify(frames)}, not ${JSON.stringify(expected)}, each once and in order`;
  return null;
}
/**
 * AC4's judge: the reply names the head, the event frames up to it come first (replaying), one frame marks reaching
 * it (caught up), and the first frame after that is the next event (live, no gap).
 */
export function judgePhases(reply: Line, g: Got, head: number, replay: readonly number[], live: readonly number[]): string | null {
  if (!reply.result) return refused('a subscribe 50 events behind', reply);
  if (saysSnapshot(reply)) return `a reader ${replay.length} events behind, within the cap of ${REPLAY_CAP}, was told to read a snapshot`;
  if (!g.caught.length) return `the client never saw caught up: ${g.events.length} event frames and no frame marking the head at ${head}, so it can't tell replaying from live`;
  if (g.caught.length > 1) return `caught up was marked ${g.caught.length} times, at ${g.caught.join(', ')}`;
  if (headOf(reply) !== head) return `the reply names the head ${JSON.stringify(headOf(reply))}; the log's head was ${head}`;
  if (g.caught[0] !== head) return `the caught-up frame marks ${g.caught[0]}; the head the reply named was ${head}`;
  const mark = g.lines.findIndex((l) => caughtUpAt(l) !== undefined);
  const before = positions(g.lines.slice(0, mark).flatMap((l) => (l.event ? [l.event as Line] : [])));
  const after = positions(g.lines.slice(mark + 1).flatMap((l) => (l.event ? [l.event as Line] : [])));
  if (JSON.stringify(before) !== JSON.stringify(replay)) return `replaying: the frames before the caught-up frame were ${JSON.stringify(before)}, not ${JSON.stringify(replay)}`;
  if (after[0] !== live[0]) return `a gap: the first live frame after the caught-up frame at ${head} was log_pos ${String(after[0])}, not ${String(live[0])}`;
  if (JSON.stringify(after) !== JSON.stringify(live)) return `live: the frames after the caught-up frame were ${JSON.stringify(after)}, not ${JSON.stringify(live)}`;
  return null;
}
/**
 * AC5's judge: a reader that stopped reading while frames of these sizes in bytes were appended was cut off having
 * been handed no more than the byte cap, and its report names how many frames and bytes it was held with.
 */
export function judgeHeld(sizes: readonly number[], g: Got): string | null {
  if (!g.cut) return `a reader that stopped reading was never held: while ${sizes.length} frames were appended it was handed ${g.frames} frames, ${g.bytes} bytes, past any byte cap, and got no report`;
  if (g.cut.error?.code !== 'fell_behind') return `the reader's report isn't fell_behind: ${JSON.stringify(g.cut.error)}`;
  if (g.bytes > BYTE_CAP_AT_MOST) return `the reader was handed ${g.bytes} bytes before its report, past a byte cap of at most ${BYTE_CAP_AT_MOST}`;
  const report = reportOf(g.cut);
  if (!report) return `the report names no frame and byte counts: ${JSON.stringify(g.cut.error)}`;
  if (report.frames < 1 || report.frames >= FRAME_CAP) return `the report counts ${report.frames} frames: a reader held by bytes holds at least 1 and fewer than the frame cap of ${FRAME_CAP}`;
  if (report.bytes > BYTE_CAP_AT_MOST) return `the report counts ${report.bytes} bytes held, past a byte cap of at most ${BYTE_CAP_AT_MOST}`;
  const [least, most] = [Math.min(...sizes), Math.max(...sizes)];
  if (report.bytes < report.frames * least || report.bytes > report.frames * most) return `the report's counts don't agree: ${report.frames} frames of ${least} to ${most} bytes each can't be ${report.bytes} bytes`;
  return null;
}

// ---- Planted wrong hubs: a real hub behind a socket that changes what passes, kept in the test folder (as #34's are).

export interface Plant { path: string; close(): Promise<void> }
type Pass = (line: string, toClient: (line: string) => void, toHub: (line: string) => void) => void;
const parse = (line: string): Line | undefined => {
  try { return JSON.parse(line) as Line; } catch { return undefined; }
};
const text = (line: Line): string => `${JSON.stringify(line)}\n`;
/** One connection's two directions; `make` gives each connection its own state. */
function planted(dir: string, name: string, target: string, make: () => { up: Pass; down: Pass }): Promise<Plant> {
  const path = join(dir, name);
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const hub = net.connect(target);
    sockets.add(client); sockets.add(hub);
    const { up, down } = make();
    const toClient = (l: string) => { if (!client.destroyed) client.write(l); };
    const toHub = (l: string) => { if (!hub.destroyed) hub.write(l); };
    const lines = (from: net.Socket, each: (line: string) => void) => {
      let buffer = '';
      from.setEncoding('utf8').on('data', (d: string) => {
        buffer += d;
        let i: number;
        while ((i = buffer.indexOf('\n')) >= 0) { each(buffer.slice(0, i + 1)); buffer = buffer.slice(i + 1); }
      });
    };
    lines(hub, (line) => down(line, toClient, toHub));
    lines(client, (line) => up(line, toClient, toHub));
    client.on('error', () => hub.destroy()); hub.on('error', () => client.destroy());
    client.on('close', () => hub.end()); hub.on('close', () => client.end());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, () => resolve({ path, close: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }) }));
  });
}
/** "A hub that sends all" (AC2): the real hub behind a socket that takes the scope off every subscribe. */
export function sendsAll(dir: string, target: string): Promise<Plant> {
  return planted(dir, 'all.sock', target, () => ({
    down: (line, toClient) => toClient(line),
    up: (line, _toClient, toHub) => {
      const request = parse(line);
      if (request?.method !== 'stream.subscribe' || !request.params) return toHub(line);
      const { scope: _scope, ...params } = request.params as Line;
      toHub(text({ ...request, params }));
    },
  }));
}
/**
 * "A hub that replays" (AC3): the real hub behind a socket that answers every subscribe as subscribed, however far
 * behind, and replays to it: it reads every event after the reader's position through events.read and sends each
 * of the reader's scope as a frame, then lets the hub's own frames through from there.
 */
export function replays(dir: string, target: string): Promise<Plant> {
  return planted(dir, 'replay.sock', target, () => {
    const reading = new Map<string, { request: Line; after: number; events: Line[] }>();   // by the plant's own read id
    const swallow = new Set<string>();   // subscriptions whose reply from the hub the reader already has
    let reads = 0;
    const read = (toHub: (line: string) => void, request: Line, after: number, events: Line[]) => {
      const id = `plant-replays#${++reads}`;
      reading.set(id, { request, after, events });
      toHub(text({ v: 1, id, method: 'events.read', params: { after, limit: 1000 } }));
    };
    return {
      up: (line, _toClient, toHub) => {
        const request = parse(line);
        if (request?.method !== 'stream.subscribe') return toHub(line);
        const after = Number.isSafeInteger(request.params?.after) ? (request.params.after as number) : 0;
        read(toHub, request, after, []);
      },
      down: (line, toClient, toHub) => {
        const reply = parse(line);
        const mine = reply && typeof reply.id === 'string' ? reading.get(reply.id) : undefined;
        if (reply && mine) {
          reading.delete(reply.id as string);
          const page = (reply.result ?? {}) as Line;
          const events = (page.events ?? []) as Line[];
          mine.events.push(...events);
          const end = events.length ? (events[events.length - 1]!.log_pos as number) : mine.after;
          if (events.length) return read(toHub, mine.request, end, mine.events);
          const session = scopeSession((mine.request.params ?? {}) as Line);
          toClient(text({ v: 1, id: mine.request.id, result: { subscribed: true, after: mine.request.params?.after ?? 0, start: page.start } }));
          for (const event of mine.events) if (session === undefined || event.session === session) toClient(text({ v: 1, id: mine.request.id, event }));
          swallow.add(JSON.stringify(mine.request.id));
          return toHub(text({ ...mine.request, params: { ...(mine.request.params as Line), after: end } }));
        }
        if (reply && ('result' in reply || 'error' in reply) && swallow.delete(JSON.stringify(reply.id))) return;
        toClient(line);
      },
    };
  });
}

// ---- A cold reader: a second app connection that replays from 0, as the app subscribes, and only tracks the last
// log_pos it was sent, so reading 100,000 frames costs this process next to nothing beside the live reader it times.

export interface Cold { at(): number; ended(): boolean; close(): void }
export function coldReader(hub: { socket: string; root: string }): Promise<Cold> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(hub.socket);
    const KEY = Buffer.from('"log_pos":');
    let [lines, at, ended] = [0, 0, false];
    sock.on('error', reject);
    sock.on('close', () => { ended = true; });
    sock.on('data', (chunk: Buffer) => {
      // The hub's hello, then the role's answer; every line after is the subscribe's reply or one of its frames.
      const before = lines;
      if (lines < 2) for (let i = chunk.indexOf(10); i >= 0 && lines < 2; i = chunk.indexOf(10, i + 1)) lines++;
      if (before < 1 && lines >= 1) sock.write(text({ v: 1, hello: 'app', token: tokenOf(hub.root) }));
      if (before < 2 && lines >= 2) {
        sock.write(text({ v: 1, id: 'cold', method: 'stream.subscribe', params: { after: 0 } }));
        resolve({ at: () => at, ended: () => ended, close: () => sock.destroy() });
      }
      // The last whole log_pos in this chunk: a frame's event carries it, and frames come in order.
      const i = chunk.lastIndexOf(KEY);
      if (i >= 0) {
        let [j, n] = [i + KEY.length, 0];
        while (j < chunk.length && chunk[j]! >= 48 && chunk[j]! <= 57) n = n * 10 + chunk[j++]! - 48;
        if (j < chunk.length && n > at) at = n;
      }
    });
  });
}

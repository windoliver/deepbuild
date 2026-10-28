// The transcript archive (#20), a first-party extension that ships on by default. Agents delete old transcripts
// (Claude Code after 30 days), so each pass copies every transcript that is new or has grown since its last copy into
// the evidence store, redacted as ingestion redacts, reads the copy back, and links it to its session with a
// transcript.archived event, so `session:` handles resolve through the record. It also copies completed CI runs from
// the forge before the forge's retention deletes them, raises a "rotate this key" ask for a key pasted into chat, and
// raises archive.quiet when an agent kept working for a day with nothing captured. It only writes: what it has
// already copied it reads back from the record, so a restart copies nothing twice.
import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { AdapterRegistry } from '@deepbuild/adapters';
import type { Asks } from '@deepbuild/asks';
import { patternMatches, scrubText, type EvidenceStore, type Writer } from '@deepbuild/evidence';
import { ulid, type Connection, type Event, type EventInput, type RecordStore } from '@deepbuild/record';

export interface ArchiveOptions {
  record: RecordStore;
  evidence: EvidenceStore;
  asks: Asks;
  /** The sources: each adapter's facts name its transcript folder (`transcripts.home` and `transcripts.path`). */
  adapters: AdapterRegistry;
  /** What the facts' homes resolve in: HOME and the agents' own variables, such as CLAUDE_CONFIG_DIR. */
  env: Readonly<Record<string, string | undefined>>;
  connection: Connection;
  now: () => number;
  /** The values DeepBuild holds by handle now, scrubbed from every copy by value. */
  held?: () => readonly string[];
  /** The forge's REST API (https://api.github.com) and the repos (owner/name) whose CI runs are copied. */
  forge?: { api: string; repos: readonly string[] };
}
export interface Archive {
  /** Copies every source new or changed since its last copy, and every completed CI run not yet copied. */
  pass(): Promise<void>;
}

const DAY = 86_400_000;
const LICENSE = { name: 'session', allows: [] };
const ROTATE_SOURCE = 'secret.pasted';

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');
/** A session ID as handles hold it: letters and digits only. */
const letters = (id: string): string => id.replace(/[^0-9A-Za-z]/g, '');
type Obj = { [key: string]: unknown };
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One transcript file: its agent, its session as the file names it, and where it is. */
interface Source { agent: string; session: string; path: string }
/** The last copy of a session: its source's size and hash, which the record keeps on transcript.archived@2. */
interface Copied { size: number; sha256: string }

// What each placeholder of a facts `path` matches inside one path segment. The session's own placeholder is the
// capture; the date and time placeholders are exact, so a session ID with dashes is never cut short.
const SESSION = new Set(['session', 'thread']);
const PLACEHOLDER: Readonly<Record<string, string>> = { YYYY: '\\d{4}', MM: '\\d{2}', DD: '\\d{2}', time: '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}' };
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function segmentPattern(segment: string): RegExp {
  let source = '';
  let at = 0;
  for (const m of segment.matchAll(/\{([^}]*)\}/g)) {
    source += escape(segment.slice(at, m.index));
    source += SESSION.has(m[1]!) ? '([^/]+)' : (PLACEHOLDER[m[1]!] ?? '[^/]+');
    at = m.index + m[0].length;
  }
  return new RegExp(`^${source}${escape(segment.slice(at))}$`);
}

/** Where an agent's transcripts live: the first of its facts' homes that is set, `~` being HOME. */
function homeOf(home: unknown, env: ArchiveOptions['env']): string | undefined {
  for (const entry of Array.isArray(home) ? home : []) {
    if (typeof entry !== 'string') continue;
    if (entry.startsWith('~')) return env.HOME ? join(env.HOME, entry.slice(1)) : undefined;
    if (entry.startsWith('/')) return entry;
    if (env[entry]) return env[entry];
  }
  return undefined;
}

/** Every transcript the adapters' facts name, walked one path segment at a time. */
async function sources(options: ArchiveOptions): Promise<Source[]> {
  const found: Source[] = [];
  for (const agent of options.adapters.names()) {
    const facts = options.adapters.get(agent).facts;
    const transcripts = isObj(facts) ? facts.transcripts : undefined;
    if (!isObj(transcripts) || typeof transcripts.path !== 'string') continue;
    const home = homeOf(transcripts.home, options.env);
    if (!home) continue;
    const segments = transcripts.path.split('/').map(segmentPattern);
    const walk = async (dir: string, depth: number, session: string | undefined): Promise<void> => {
      const last = depth === segments.length - 1;
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const m = segments[depth]!.exec(entry.name);
        if (!m || (last ? !entry.isFile() : !entry.isDirectory())) continue;
        const id = m[1] ?? session;
        if (last) { if (id) found.push({ agent, session: id, path: join(dir, entry.name) }); }
        else await walk(join(dir, entry.name), depth + 1, id);
      }
    };
    await walk(home, 0, undefined);
  }
  return found;
}

/**
 * The keys the pattern scrub finds in a text. A field name's mask hides whatever sits under it, code and
 * placeholders too, and some rules match what sits under a secret name; so a match a field mask covers is a key
 * only when a rule finds all of it by itself, as one finds a pasted token but not a plain password. Two rules
 * can match one key, one with the text around it, as `curl -u user:k` does; the key alone is the one asked for,
 * unless what is around it reads as a secret too, as a password beside a key-shaped user does.
 */
function secretsIn(text: string): string[] {
  const keys = patternMatches(text).filter(({ match, field }) => !field || patternMatches(match).some((m) => m.match === match))
    .map(({ match, at }) => ({ match, at, end: at + Buffer.byteLength(match) }))
    .sort((a, b) => a.at - b.at || b.end - a.end);
  // In start order, wider first: the keys a key holds start after it and before its end.
  return keys.filter((key, n) => {
    let around = key.match;
    for (let next = n + 1; next < keys.length && keys[next]!.at < key.end; next++) if (keys[next]!.end <= key.end) around = around.replaceAll(keys[next]!.match, ' ');
    return around === key.match || around.split(/[^\w+/=]+/).some((part) => part.length >= 8 && /\d/.test(part) && /[a-z]/i.test(part));
  }).map(({ match }) => match);
}
/** Whether a transcript line is a user message, however its agent nests the role. */
function fromUser(line: string): { uuid?: string } | undefined {
  let entry: unknown;
  try { entry = JSON.parse(line); } catch { return undefined; }
  if (!isObj(entry)) return undefined;
  const role = entry.role ?? (isObj(entry.message) ? entry.message.role : undefined) ?? (isObj(entry.payload) ? entry.payload.role : undefined);
  if (role !== 'user') return undefined;
  return typeof entry.uuid === 'string' ? { uuid: entry.uuid } : {};
}

export async function openArchive(options: ArchiveOptions): Promise<Archive> {
  const { record, now } = options;
  const writer: Writer = options.evidence.connect({ role: 'deepbuild', via: 'capture' });
  // What the record says was copied: each session's last copy, each agent's last capture, the CI runs and the alerts.
  const copied = new Map<string, Copied>();
  const captured = new Map<string, number>();
  const runs = new Set<string>();
  const alerted = new Set<string>();
  let cursor = 0;
  for (let after = 0; ;) {
    const page = await record.read({ after, limit: 1000, kinds: ['transcript.archived', 'ci.archived', 'archive.quiet'] });
    if (!page.length) break;
    for (const e of page) remember(e);
    after = page[page.length - 1]!.log_pos;
  }
  function remember(e: Event): void {
    const d = isObj(e.data) ? e.data : {};
    if (e.kind === 'transcript.archived' && typeof d.session === 'string' && isObj(d.source)) {
      copied.set(d.session, { size: Number(d.source.size), sha256: String(d.source.sha256) });
      if (e.agent) captured.set(e.agent, Math.max(captured.get(e.agent) ?? 0, e.ts));
    } else if (e.kind === 'ci.archived') runs.add(`${String(d.repo)}#${String(d.run)}`);
    else if (e.kind === 'archive.quiet') alerted.add(`${String(d.agent)}@${String(d.last)}`);
  }
  // Files seen unchanged since their last pass, by size and modification time: not read again.
  const seen = new Map<string, string>();
  // The keys each session was asked to rotate, by hash: never the same question twice.
  const asked = new Map<string, Set<string>>();
  // Each agent's newest hook, read from the record a page of new events at a time.
  const hooked = new Map<string, number>();

  const append = async (agent: string | undefined, kind: string, v: number, data: Obj, evidence: string[], session?: string) => {
    const ts = now();
    const connection = { ...options.connection, ...(agent && { agent }), ...(session && { session }) };
    const event = { v, id: ulid(ts), kind, ts, data: data as EventInput['data'], evidence };
    await record.append(connection, event);
    remember({ ...event, ...connection, log_pos: 0 } as unknown as Event);
  };
  /** Stores text as evidence and reads it back: its hash once the copy matches what was written, by size and hash. */
  const keep = async (kind: string, source: string, bytes: Uint8Array, complete: boolean): Promise<string> => {
    const sha = sha256(bytes);
    const put = await writer.put({ bytes, kind, source, redaction: complete ? 'complete' : 'incomplete', license: LICENSE });
    if (put.status !== 'stored') throw Error(`the evidence store refused the copy of ${source}: ${put.reason}`);
    const back = await options.evidence.read(put.evidence.sha256);
    if (put.evidence.sha256 !== sha || back.length !== bytes.length || sha256(back) !== sha) throw Error(`the copy of ${source} didn't read back as written`);
    return sha;
  };

  async function copy(source: Source): Promise<void> {
    const info = await stat(source.path).catch(() => undefined);
    if (!info) return;
    const mark = `${info.size}:${info.mtimeMs}`;
    if (seen.get(source.path) === mark) return;
    const raw = await readFile(source.path).catch(() => undefined);
    if (!raw) return;
    const session = `session:${letters(source.session)}`;
    const before = copied.get(session);
    const sourceSha = sha256(raw);
    if (before?.sha256 === sourceSha) { seen.set(source.path, mark); return; }
    const text = raw.toString('utf8');
    const redacted = Buffer.from(scrubText(text, { held: [...(options.held?.() ?? [])] }), 'utf8');
    const evidence = await keep('transcript-copy', `archive:${source.agent}`, redacted, isUtf8(raw));
    await append(source.agent, 'transcript.archived', 2, { session, evidence, source: { size: raw.length, sha256: sourceSha } }, [evidence]);
    seen.set(source.path, mark);
    // Only what the transcript gained since its last copy is searched for pasted keys, so a key asks once.
    const grew = before && before.size <= raw.length && sha256(raw.subarray(0, before.size)) === before.sha256;
    await rotateAsks(source, text.slice(grew ? Buffer.from(raw.subarray(0, before.size)).toString('utf8').length : 0), evidence);
  }

  async function rotateAsks(source: Source, added: string, evidence: string): Promise<void> {
    const session = letters(source.session);
    const done = asked.get(session) ?? asked.set(session, new Set()).get(session)!;
    for (const line of added.split('\n')) {
      const user = fromUser(line);
      if (!user) continue;
      for (const secret of secretsIn(line)) {
        const key = sha256(`${ROTATE_SOURCE}:${session}:${secret}`);
        if (done.has(key)) continue;
        done.add(key);
        const ts = now();
        await options.asks.raise({ ...options.connection, session, agent: source.agent }, ROTATE_SOURCE, {
          kind: 'exception',
          question: `A key was pasted into this session's chat${user.uuid ? ` (message ${user.uuid})` : ''}, so the agent and its provider have seen it. Rotate it?`,
          options: [{ id: 'rotated', label: 'I rotated it', decision: 'none' }, { id: 'later', label: 'Not now', decision: 'none' }],
          recommended: 'rotated', deadline: ts + 2 * DAY, fallback: 'you', default: 'later', provisional: false, owner: options.connection.actor,
          key, pinned_to: { kind: 'evidence', ref: evidence },
        });
      }
    }
  }

  /** An agent whose hooks kept landing for a day after its last capture: capture went quiet. */
  async function quiet(): Promise<void> {
    const rows = (await record.raw(`SELECT agent, max(ts) AS ts FROM events WHERE log_pos > ${cursor} AND writer = 'hook' AND agent IS NOT NULL GROUP BY agent`)) as { agent: string; ts: number }[];
    for (const { agent, ts } of rows) hooked.set(agent, Math.max(hooked.get(agent) ?? 0, ts));
    cursor = Number(((await record.raw('SELECT coalesce(max(log_pos), 0) AS pos FROM events')) as { pos: number }[])[0]!.pos);
    for (const [agent, last] of captured) {
      if ((hooked.get(agent) ?? 0) - last < DAY || alerted.has(`${agent}@${last}`)) continue;
      await append(agent, 'archive.quiet', 1, { agent, last }, []);
    }
  }

  async function forgeRuns(forge: NonNullable<ArchiveOptions['forge']>): Promise<void> {
    const token = options.env.GH_TOKEN ?? options.env.GITHUB_TOKEN;
    const headers = { accept: 'application/vnd.github+json', ...(token && { authorization: `Bearer ${token}` }) };
    const get = async (path: string) => {
      const res = await fetch(`${forge.api}${path}`, { headers });
      if (!res.ok) throw Error(`the forge answered ${res.status} for ${path}`);
      return res;
    };
    for (const repo of forge.repos) {
      // Newest first: a page whose runs were all copied already ends the walk.
      for (let page = 1; ; page++) {
        const list = (await (await get(`/repos/${repo}/actions/runs?status=completed&per_page=100&page=${page}`)).json()) as { workflow_runs?: Obj[] };
        const listed = (list.workflow_runs ?? []).filter((r) => r.status === 'completed');
        const fresh = listed.filter((r) => !runs.has(`${repo}#${String(r.id)}`));
        for (const run of fresh) {
          const jobs = ((await (await get(`/repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100`)).json()) as { jobs?: Obj[] }).jobs ?? [];
          const logs: { job: string; evidence: string }[] = [];
          for (const job of jobs) {
            const text = await (await get(`/repos/${repo}/actions/jobs/${String(job.id)}/logs`)).text();
            const redacted = Buffer.from(scrubText(text, { held: [...(options.held?.() ?? [])] }), 'utf8');
            logs.push({ job: String(job.id), evidence: await keep('ci.log', `forge:${repo}#${String(run.id)}`, redacted, true) });
          }
          await append(undefined, 'ci.archived', 1, { repo, run: String(run.id), result: String(run.conclusion ?? 'unknown'), logs }, logs.map((l) => l.evidence));
        }
        if (!listed.length || !fresh.length) break;
      }
    }
  }

  return {
    async pass() {
      const failed: unknown[] = [];
      for (const source of await sources(options)) await copy(source).catch((error: unknown) => failed.push(error));
      if (options.forge) await forgeRuns(options.forge).catch((error: unknown) => failed.push(error));
      await quiet();
      if (failed.length) throw new AggregateError(failed, `the archive pass left ${failed.length} cop${failed.length === 1 ? 'y' : 'ies'} undone`);
    },
  };
}

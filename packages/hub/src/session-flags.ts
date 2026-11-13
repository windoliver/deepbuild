import { homedir } from 'node:os';
import type { Asks } from '@deepbuild/asks';
import { canonicalize, sha256Hex, type JsonValue } from '@deepbuild/contracts';
import type { RecordStore } from '@deepbuild/record';
import { hookedAgents, type Agents } from './agents.js';
import { installedCodex } from './codex-settings.js';
import { hookItems } from './doctor.js';
import type { HookSchedule, HubEvents } from './hub-capabilities.js';
import type { McpOperationsPort, SessionStatePort } from './hub-ports.js';
import { DAY, letters, sql, type Obj } from './hub-shared.js';
import { modelCallOf } from './hookmap.js';
import type { Root } from './paths.js';
import { activePlant } from './plant.js';
import { headOf, unpushedOf } from './session-facts.js';
import type { Session } from './session-types.js';
import type { Siblings } from './siblings.js';
import { callFrom, REPEATS, repeatOf } from './status.js';
import type { TranscriptReader } from './transcript-reader.js';
import { gatesOff, watched, watchWords, type WatchCause } from './watch.js';
import { derivedId, ulid, type Draft, type HookMeta } from './wire.js';

export interface SessionFlagsOptions {
  services: {
    readonly record: RecordStore;
    readonly now: () => number;
    readonly asks: Asks;
    readonly agents: Agents;
    readonly root: Root;
    readonly siblings: Siblings;
    readonly transcriptReader: TranscriptReader;
  };
  state: () => Pick<SessionStatePort, 'sessions' | 'live' | 'versioned'>;
  mcp: () => Pick<McpOperationsPort, 'pinOf'>;
  events: Pick<HubEvents, 'append' | 'connection'>;
  schedule: Pick<HookSchedule, 'queue'>;
  /** Codex's own word on our entries' trust, read from a folder. */
  readCodexTrust: (cwd: string) => Promise<void>;
}

/** What a session's row flags beside its word (#2019): unpushed commits, alike failures, watch-only holds, agent reach and retried model calls. */
export class SessionFlags {
  constructor(private readonly options: SessionFlagsOptions) {}

  private gatesSeen: boolean | undefined;
  /** Each agent's newest agent.reach as appended, by agent, as JSON; read from the record once. */
  private readonly reached = new Map<string, string>();
  private reachRead = false;
  private trustRead = false;

  /**
   * A session's commits no remote branch holds (#2019): read off the hook path from its newest commits' worktree, and
   * recorded when the count or the branch changes. A repo git can't read records nothing.
   */
  async unpushed(session: string, agent: string): Promise<void> {
    const { record, now } = this.options.services;
    const made = (await record.raw('SELECT sha, worktree FROM commits WHERE session_id = ? ORDER BY created DESC LIMIT 100', [session])) as { sha: string; worktree: string | null }[];
    const worktree = made.find((c) => c.worktree)?.worktree;
    if (!worktree) return;
    const left = await unpushedOf(worktree, made.map((c) => c.sha));
    if (!left) return;
    const head = await headOf(worktree).catch(() => undefined);
    const [last] = (await record.raw("SELECT json_extract(data, '$.commits') AS commits, json_extract(data, '$.branch') AS branch FROM events WHERE kind = 'commits.unpushed' AND session_id = ? ORDER BY log_pos DESC LIMIT 1", [session])) as { commits: number; branch: string | null }[];
    if (last ? last.commits === left.length && last.branch === (head?.branch ?? null) : !left.length) return;
    const ts = now();
    await this.options.events.append(this.options.events.connection('core', { session, agent }), { v: 1, id: ulid(ts), kind: 'commits.unpushed', ts, subject: `session:${letters(session)}`, data: { commits: left.length, branch: head?.branch ?? null, head: head?.sha ?? null } });
  }

  /**
   * A failed call that makes its turn's newest calls fail alike for the REPEATS-th time (#2019): the session hears one
   * notice, built from the command, the count and the error signature, never the agent's text; keyed by the run's
   * first call, so a fourth alike failure, or a restart, brings none. It raises no ask and notifies no one.
   */
  async repeated(meta: HookMeta, failed: Draft): Promise<void> {
    const { record, now, asks, siblings } = this.options.services;
    const rows = (await record.raw(`SELECT data, ts, log_pos FROM events INDEXED BY events_session WHERE session_id = ? AND kind = 'tool.after' AND json_extract(data, '$.call') IS NOT ? AND log_pos > COALESCE((SELECT MAX(u.log_pos) FROM events u WHERE u.session_id = ? AND u.kind = 'user.ask' AND json_extract(u.data, '$.from') IS NOT 'subagent'), 0) ORDER BY log_pos DESC LIMIT 64`, [meta.session, String(failed.data.call ?? ''), meta.session])) as { data: string; ts: number; log_pos: number }[];
    const run = repeatOf([callFrom({ data: failed.data, ts: now(), log_pos: Number.MAX_SAFE_INTEGER }), ...rows.map(callFrom)]);
    if (!run || (activePlant() === 'repeat-notifies-each' ? run.count < REPEATS : run.count !== REPEATS)) return;
    const exit = run.first.exit_code !== null ? `exit ${run.first.exit_code}, ` : '';
    const text = `DeepBuild: \`${run.what}\` failed ${run.count} times in a row in this turn with the same error (${exit}${run.first.signature ?? 'no signature'}). Read the error before running it again.`;
    // The planted wrong program asks you instead.
    if (activePlant() === 'repeat-raises-ask') {
      const question = `${text} Stop the session?`;
      await asks.raise(this.options.events.connection('core', { session: meta.session, agent: meta.agent }), 'guard.overridden', { kind: 'exception', question, options: [{ id: 'checked', label: 'Stop it', decision: 'none' }, { id: 'later', label: 'Let it go on', decision: 'none' }], recommended: 'later', deadline: now() + 2 * 86_400_000, fallback: 'you', default: 'later', provisional: false, owner: 'you', key: sha256Hex(canonicalize({ kind: 'repeat', session: meta.session, first: run.first.at.log_pos } as JsonValue)), pinned_to: await this.options.mcp().pinOf(meta.cwd, question) }).catch(() => undefined);
      return;
    }
    await siblings.tell(meta, { type: 'repeat', source: null, files: [], pr: null, key: `repeat:${run.first.at.log_pos}`, version: activePlant() === 'repeat-notifies-each' ? String(run.count) : String(REPEATS), text });
  }

  /**
   * Holds that only watch, by their cause (#2019): a session's (its version past its facts, its hooks not reaching the
   * hub or unable to run, its repo's checks not approved), or every session's for `deep off`, with no session.
   */
  async watchOnly(session: string | undefined, agent: string, cause: WatchCause, on: boolean, version?: string): Promise<void> {
    const ts = this.options.services.now();
    await this.options.events.append(this.options.events.connection('core', session ? { session, agent } : {}), { v: 1, id: ulid(ts), kind: 'holds.watch', ts, ...(session ? { subject: `session:${letters(session)}` } : {}), data: { cause, on, ...(version ? { version } : {}) } });
  }

  /**
   * A hook's version, read as a watch-only cause (#2019): at the session's first hook on a version past its facts,
   * and again at each start, which reads its version again; a start on a version its facts cover takes the cause back.
   */
  async versionRead(meta: HookMeta, unread: boolean): Promise<void> {
    if (meta.watchOnly && meta.session && (unread || meta.event === 'SessionStart')) await this.watchOnly(meta.session, meta.agent, 'version', true, meta.version).catch(() => undefined);
    else if (meta.event === 'SessionStart' && meta.session && meta.version && !meta.watchOnly) {
      const [held] = (await this.options.services.record.raw("SELECT json_extract(data, '$.on') AS on_ FROM events WHERE kind = 'holds.watch' AND session_id = ? AND json_extract(data, '$.cause') = 'version' ORDER BY log_pos DESC LIMIT 1", [meta.session])) as { on_: number | boolean }[];
      if (held?.on_ === 1 || held?.on_ === true) {
        this.options.state().versioned.delete(meta.session);
        await this.watchOnly(meta.session, meta.agent, 'version', false).catch(() => undefined);
      }
    }
  }

  /** `deep off` as gates.json says it, recorded when it changes from what the record holds (#2019). */
  async gatesWatched(): Promise<void> {
    const off = gatesOff(this.options.services.root.dir);
    if (off === this.gatesSeen) return;
    if (this.gatesSeen === undefined) {
      const [last] = (await this.options.services.record.raw("SELECT json_extract(data, '$.on') AS on_ FROM events WHERE kind = 'holds.watch' AND session_id IS NULL AND json_extract(data, '$.cause') = 'off' ORDER BY log_pos DESC LIMIT 1")) as { on_: number | boolean }[];
      if ((last?.on_ === 1 || last?.on_ === true) === off) { this.gatesSeen = off; return; }
    }
    await this.watchOnly(undefined, 'deepbuild', 'off', off);
    this.gatesSeen = off;
  }

  /**
   * Whether each agent's sessions reach DeepBuild, as the Agents page lists it (#2019): unreachable, with why and its
   * fix, when one of `deep doctor`'s hook items for it warns or fails, or when its newest session runs a version past its
   * facts; otherwise waiting for its first session, or reached. Appended as agent.reach when an agent's reading
   * differs from the newest the record holds.
   */
  async agentsReached(): Promise<void> {
    const { record, now, agents, root } = this.options.services;
    // Codex's own word on our entries' trust, read once they're installed, so the page says it before any Codex session.
    if (!this.trustRead && installedCodex(root.dir)) {
      this.trustRead = true;
      await this.options.readCodexTrust(homedir());
    }
    const failing = hookItems(process.env, homedir()).filter((i) => i.level === 'fail' || i.level === 'warn');
    const installed = new Set(agents.installed().map((a) => a.id));
    for (const a of hookedAgents().filter((x) => installed.has(x.id))) {
      const [newest] = (await record.raw('SELECT id FROM sessions WHERE agent = ? AND last_seen IS NOT NULL ORDER BY last_seen DESC LIMIT 1', [a.id])) as { id: string }[];
      const held = newest ? (await watched((q) => record.raw(q), ` AND w.session_id = '${sql(newest.id)}'`)).sessions.get(newest.id) : undefined;
      const item = failing.find((i) => i.agent === a.id);
      const words = held?.cause === 'version' ? watchWords(held, a.name) : undefined;
      const reach = item ? { state: 'unreachable', code: item.code, why: item.evidence, fix: item.fix }
        : words ? { state: 'unreachable', code: 'version_uncovered', why: words.why, fix: words.fix }
          : { state: newest ? 'reached' : 'waiting' };
      const data = { agent: a.id, name: a.name, ...reach };
      if (this.reached.size === 0 && !this.reachRead) {
        for (const r of (await record.raw("SELECT data FROM events e WHERE kind = 'agent.reach' AND log_pos = (SELECT MAX(n.log_pos) FROM events n WHERE n.kind = 'agent.reach' AND json_extract(n.data, '$.agent') = json_extract(e.data, '$.agent'))")) as { data: string | Obj }[]) {
          const d = (typeof r.data === 'string' ? JSON.parse(r.data) : r.data) as Obj;
          this.reached.set(String(d.agent), JSON.stringify(d));
        }
        this.reachRead = true;
      }
      if (this.reached.get(a.id) === JSON.stringify(data)) continue;
      const ts = now();
      await this.options.events.append(this.options.events.connection('core'), { v: 1, id: ulid(ts), kind: 'agent.reach', ts, data });
      this.reached.set(a.id, JSON.stringify(data));
    }
  }

  /**
   * Each idle session of the last day with commits a remote branch didn't hold, or that were never read, at the start
   * and each minute: a push from anywhere clears its flag, and a hub started on a record no stop of it reached reads them.
   */
  async unpushedAgain(): Promise<void> {
    const open = (await this.options.services.record.raw(`SELECT DISTINCT c.session_id, s.agent FROM commits c JOIN sessions s ON s.id = c.session_id WHERE s.status NOT IN ('working', 'waiting', 'running') AND s.last_seen >= ? AND COALESCE((SELECT json_extract(e.data, '$.commits') FROM events e WHERE e.kind = 'commits.unpushed' AND e.session_id = c.session_id ORDER BY e.log_pos DESC LIMIT 1), -1) <> 0`, [this.options.services.now() - DAY])) as { session_id: string; agent: string | null }[];
    for (const s of open) await this.unpushed(s.session_id, s.agent ?? 'claude-code');
  }

  /** Each live session at work's transcript, read for what it wrote since its last hook (#2019). */
  async transcriptsRead(): Promise<void> {
    const state = this.options.state();
    for (const session of state.sessions.values()) {
      const at = state.live.get(session.id)?.state;
      if (!session.ended && (at === 'working' || at === 'waiting')) await this.options.schedule.queue(() => this.options.services.transcriptReader.readTranscript(session, this.modelCalled(session)));
    }
  }

  /**
   * A model call the agent retries, by its own record, and the reply that ends the retries (#2019): one event each, a
   * reply only after a retry, so a turn's every reply isn't one. What a transcript's reader calls with each line.
   */
  modelCalled(session: Session): (line: Obj) => Promise<void> {
    return async (line) => {
      const call = modelCallOf(session.agent, line);
      if (!call || !(call.outcome === 'retry' || session.retrying)) return;
      session.retrying = call.outcome === 'retry';
      await this.options.events.append(this.options.events.connection('core', { session: session.id, agent: session.agent }), { v: 1, id: derivedId(call.at, `${session.id}:${call.record}:model`), kind: 'model.call', ts: call.at, subject: `session:${letters(session.id)}`, data: { ...call } as unknown as JsonValue }).catch(() => undefined);
    };
  }
}

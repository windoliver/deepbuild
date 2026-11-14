import type { HubEvents, HubRuntime, HookSchedule } from './hub-capabilities.js';
import type { SessionFlagsPort, SessionStatePort } from './hub-ports.js';

import { readFile } from 'node:fs/promises';

import { scrubText } from '@deepbuild/evidence';

import { type Root } from './paths.js';

import { writeSynced } from './vfs.js';
import { derivedId, type CoreOptions } from './wire.js';
import type { Session, Turn, Cursor } from './session-types.js';

import { REACHED, HOOKS_MISSING, TURN_GRACE, CURSOR_SAVE, type Obj, isObj } from "./hub-shared.js";

export interface TranscriptsOptions {
  settings: CoreOptions;
  services: {
    readonly root: Root;
    readonly now: () => number;
  };
  state: () => Pick<SessionStatePort, "sessions">;
  flags: () => Pick<SessionFlagsPort, "watchOnly">;
  events: Pick<HubEvents, "appendReading" | "connection" | "append">;
kernel: Pick<HubRuntime, "stopping">;
schedule: Pick<HookSchedule, "replayLate" | "replaying" | "queue">;

}

/** Transcripts: owns its domain state; services are resolved only when used. */
export class Transcripts {
  constructor(private readonly options: TranscriptsOptions) {}

  /** The cursors the last hub left for sessions this one hasn't met yet. */
  cursors = new Map<string, Cursor>();

  /** The pending write of transcripts.json. */
  private saving: NodeJS.Timeout | undefined;

  /**
   * Judges the turns whose end the hub read at least TURN_GRACE ago, on its own monotonic clock: a hook started
   * before that read has reached the hub by then, since deep-hook gives up on the hub after 20 ms and spools. While
   * a replay runs, or a spool waits for one, the turns wait for it: one of their hooks may be there. A turn none of
   * whose calls reached the hub is recorded. Turns still in their grace are judged by a timer.
   */
  judge(session: Session): void {
    if (session.closed.length) this.options.schedule.replayLate();
    if (this.options.schedule.replaying) {
      session.deferred = true;
      return;
    }
    const now = performance.now();
    const waits = (turn: Turn) => turn.calls.some((call) => session.pending.has(call));
    for (const turn of session.closed.filter((t) => !t.recording && now - t.at! >= TURN_GRACE)) {
      if (waits(turn)) break;
      if (turn.calls.some((call) => session.reached.has(call))) {
        for (const call of turn.calls) session.reached.delete(call);
        session.closed.splice(session.closed.indexOf(turn), 1);
        continue;
      }
      turn.recording = true;
      // Settled like a hook's drafts: the next hook doesn't wait for its commit. The turn, and so where a restart
      // reads from, stays until its reading is durable; one whose append fails is judged again with the next hook.
      void this.options.events.appendReading(session.id, session.agent, HOOKS_MISSING).then(() => this.options.flags().watchOnly(session.id, session.agent, 'hooks', true)).then(() => {
        session.closed.splice(session.closed.indexOf(turn), 1);
        this.saveCursors();
      }, () => {
        turn.recording = false;
      });
    }
    const next = session.closed.find((t) => !t.recording);
    if (next && !waits(next) && !session.judging && !this.options.kernel.stopping) {
      session.judging = setTimeout(() => {
        session.judging = undefined;
        void this.options.schedule.queue(async () => this.judge(session), true).catch(() => undefined);
      }, Math.max(1, TURN_GRACE - (now - next.at!)));
      session.judging.unref();
    }
    // Calls no read turn holds (a subagent's) are forgotten oldest first; a read turn's are kept until it's judged.
    if (session.reached.size > REACHED) {
      const held = new Set([...session.closed, ...(session.turn ? [session.turn] : [])].flatMap((t) => t.calls));
      for (const call of session.reached) {
        if (session.reached.size <= REACHED) break;
        if (!held.has(call)) session.reached.delete(call);
      }
    }
    this.saveCursors();
  }

  /** Keeps where each live session's transcript is judged from (its oldest unjudged turn), so a restart judges what it missed. */
  saveCursors(): void {
    if (this.saving || this.options.kernel.stopping) return;
    this.saving = setTimeout(() => this.writeCursors(), CURSOR_SAVE);
    this.saving.unref();
  }

  writeCursors(): void {
    clearTimeout(this.saving);
    this.saving = undefined;
    const cursors = new Map(this.cursors);
    for (const s of this.options.state().sessions.values()) {
      cursors.delete(s.id);
      // An ended session is kept until its last turns are judged and their readings durable.
      if (s.ended && !s.closed.length) continue;
      cursors.set(s.id, { transcript: s.transcript, read: s.closed[0]?.from ?? s.turn?.from ?? s.read, reached: [...s.reached], ...(s.ended ? { ended: { agent: s.agent } } : {}), ...(s.watched && !s.ended ? { watch: { agent: s.agent, pid: s.pid, start: s.start } } : {}) });
    }
    // Synced, so a power cut leaves the last whole save; a failed save is made again with the next hook's.
    try {
      writeSynced(this.options.services.root.transcripts, Buffer.from(JSON.stringify(Object.fromEntries(cursors))));
    } catch (error) {
      process.stderr.write(`deep hub: ${this.options.services.root.transcripts} not saved: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  /** Reads a transcript and appends what its lines say, scrubbed: each prompt, and each turn's end; each once whatever the number of passes. */
  async backfill(spec: Obj): Promise<number> {
    const session = String(spec.session ?? '');
    const agent = String(spec.agent ?? '');
    const handle = session.replace(/[^0-9A-Za-z]/g, '');
    const text = await readFile(String(spec.transcript), 'utf8');
    const appends: Promise<void>[] = [];
    let msg = 0;
    let turn = 0;
    let worked = false;
    let waited = 0;
    for (const [i, raw] of text.split('\n').entries()) {
      if (!raw) continue;
      let line: Obj;
      try {
        line = JSON.parse(raw) as Obj;
      } catch {
        continue;
      }
      if (!isObj(line.message) || (line.type !== 'user' && line.type !== 'assistant')) continue;
      const content = line.message.content;
      const parts = Array.isArray(content) ? content.filter(isObj) : [];
      const ts = Date.parse(String(line.timestamp)) || this.options.services.now();
      const id = derivedId(ts, `${session}:${String(line.uuid ?? i)}`);
      const connection = this.options.events.connection('hook', { session, agent });
      if (line.type === 'user') {
        // A person's prompt; a user line that only carries tool results is part of the turn.
        if (parts.length && parts.every((c) => c.type === 'tool_result')) continue;
        const said = typeof content === 'string' ? content : parts.flatMap((c) => (typeof c.text === 'string' ? [c.text] : [])).join('\n');
        appends.push(this.options.events.append(connection, { v: 1, id, kind: 'user.ask', ts, data: { msg: msg++, text: scrubText(said, { held: this.options.settings.held }), tasks: [], from: 'person' } }, true));
      } else if (parts.some((c) => c.type === 'tool_use')) {
        worked = true;
      } else if (handle) {
        // An assistant message that calls no tool ends its turn.
        appends.push(this.options.events.append(connection, { v: 1, id, kind: 'agent.stop', subject: `session:${handle}`, ts, data: { turn: ++turn, did_work: worked } }, true));
        worked = false;
      }
      // Each thousand settle, and the stream's flush gets its turn, before the next are read: the stream carries
      // them while the backfill runs (#34).
      if (appends.length - waited >= 1000) {
        waited = appends.length;
        await Promise.allSettled(appends.slice(-1000));
        await new Promise((done) => setImmediate(done));
      }
    }
    await Promise.allSettled(appends);
    return appends.length;
  }
}

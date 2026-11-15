// #2065: the done gate's persisted actions and task progress. Only in-flight ordering belongs to StopJudging.
import { freshCount, type StallCount } from '@deepbuild/gate';
import type { RecordStore } from '@deepbuild/record';
import type { HubEvents } from './hub-capabilities.js';
import { letters } from './hub-shared.js';
import { ulid, type HookMeta } from './wire.js';

/** Older answers without words/images unambiguously selected an option; @6 records that choice explicitly. */
const SELECTED_OPTION = `CASE WHEN answered.v >= 6 THEN json_extract(answered.data, '$.option')
  WHEN json_extract(answered.data, '$.words') IS NULL AND json_extract(answered.data, '$.image') IS NULL THEN json_extract(answered.data, '$.answer') END`;

type GateAction = { kind: 'budget.issue'; scope: { kind: 'issue'; ref: string }; runs: number; cap_usd: number; ends: number }
  | { kind: 'claim.stalled'; task: string }
  | { kind: 'switch.off'; repo: string; name: string; deployed: string; task: string; issue: number };
export interface GateAsk { ask: string; action: GateAction; session: string; agent: string; status: string; answer: string | null }

export class GateRecord {
  constructor(private readonly o: { record(): RecordStore; now(): number; events: Pick<HubEvents, 'append' | 'connection'> }) {}

  /** The original action and the option the record accepted, never words interpreted as a choice. */
  async asks(ask?: string): Promise<GateAsk[]> {
    const rows = (await this.o.record().raw(`SELECT e.id, e.data, e.session_id AS session, e.agent, a.status,
      CASE a.status WHEN 'answered' THEN
        (SELECT ${SELECTED_OPTION} FROM events answered WHERE answered.kind = 'ask.answered' AND answered.writer = 'core' AND answered.subject = 'ask:' || e.id ORDER BY answered.log_pos DESC LIMIT 1)
        WHEN 'defaulted' THEN json_extract(a.answer, '$')
        WHEN 'decided' THEN (SELECT json_extract(d.answer, '$') FROM events applied JOIN decisions d ON 'decision:' || d.id = json_extract(applied.data, '$.decision')
          WHERE applied.kind = 'decision.applied' AND json_extract(applied.data, '$.ask') = 'ask:' || e.id ORDER BY applied.log_pos DESC LIMIT 1) END AS answer
      FROM events e JOIN asks a ON a.id = e.id WHERE e.kind = 'ask.created' AND e.writer = 'core' AND json_extract(e.data, '$.action') IS NOT NULL
      ${ask ? 'AND e.id = ?' : ''} ORDER BY e.log_pos`, ask ? [ask.slice(4)] : [])) as { id: string; data: string; session: string | null; agent: string | null; status: string; answer: string | null }[];
    return rows.map((r) => ({ ask: `ask:${r.id}`, action: (JSON.parse(r.data) as { action: GateAction }).action, session: r.session ?? '', agent: r.agent ?? 'deep', status: r.status, answer: r.answer }));
  }

  /** The decision follows the answer delivery callback; wait for the recorded link, never infer one. */
  async decisionOf(ask: string): Promise<string | null> {
    for (let i = 0; i < 30; i++) {
      const [row] = (await this.o.record().raw(`SELECT id FROM events WHERE kind = 'decision.created' AND json_extract(data, '$.ask') = ? ORDER BY log_pos DESC LIMIT 1`, [ask])) as { id: string }[];
      if (row) return `decision:${row.id}`;
      await new Promise((done) => setTimeout(done, 100));
    }
    return null;
  }


  async accepted(task: string): Promise<boolean> {
    return (await this.asks()).some((a) => a.action.kind === 'claim.stalled' && a.action.task === task && a.answer === 'accept');
  }

  async drafted(ask: string): Promise<boolean> {
    return (await this.o.record().raw(`SELECT 1 FROM events WHERE kind = 'issue.drafted' AND subject = ? LIMIT 1`, [ask])).length > 0;
  }

  async runsOf(claim: string): Promise<string[]> {
    return ((await this.o.record().raw(`SELECT id FROM runs WHERE claim_id = ?`, [claim.slice(6)])) as { id: string }[]).map((r) => r.id);
  }

  /** Latest task count; funding after it starts the send-backs again. */
  async count(task: string): Promise<StallCount> {
    const [row] = (await this.o.record().raw(`SELECT data, log_pos FROM events WHERE kind = 'claim.progress' AND writer = 'core' AND json_extract(data, '$.task') = ? ORDER BY log_pos DESC LIMIT 1`, [task])) as { data: string; log_pos: number }[];
    if (!row || await this.fundedAt(task) > row.log_pos) return freshCount();
    const d = JSON.parse(row.data) as { rounds: number; last: { items: string; passing: string[] } | null; seen: string[]; stalled: string | null };
    return { rounds: d.rounds, seen: new Set(d.seen), ...(d.last ? { last: { items: d.last.items, passing: new Set(d.last.passing) } } : {}), ...(d.stalled ? { stalled: d.stalled } : {}) };
  }

  private async fundedAt(task: string): Promise<number> {
    const [row] = (await this.o.record().raw(`SELECT COALESCE(MAX(answered.log_pos), 0) AS pos FROM events answered JOIN events raised ON answered.subject = 'ask:' || raised.id
      WHERE answered.kind = 'ask.answered' AND answered.writer = 'core' AND (${SELECTED_OPTION}) = 'fund'
      AND raised.kind = 'ask.created' AND raised.writer = 'core' AND json_extract(raised.data, '$.action.kind') = 'claim.stalled'
      AND json_extract(raised.data, '$.action.task') = ?`, [task])) as { pos: number }[];
    return row?.pos ?? 0;
  }

  /** Only an ask since this episode's reset counts, never an earlier funded or proven episode. */
  async askedSinceReset(task: string): Promise<boolean> {
    const [reset] = (await this.o.record().raw(`SELECT COALESCE(MAX(log_pos), 0) AS pos FROM events WHERE kind = 'claim.progress' AND writer = 'core'
      AND json_extract(data, '$.task') = ? AND json_extract(data, '$.stalled') IS NULL`, [task])) as { pos: number }[];
    const since = Math.max(reset?.pos ?? 0, await this.fundedAt(task));
    return (await this.o.record().raw(`SELECT 1 FROM events WHERE kind = 'ask.created' AND writer = 'core' AND log_pos > ?
      AND json_extract(data, '$.action.kind') = 'claim.stalled' AND json_extract(data, '$.action.task') = ? LIMIT 1`, [since, task])).length > 0;
  }

  async save(meta: HookMeta, claim: string, task: string, count: StallCount): Promise<void> {
    const ts = this.o.now();
    await this.o.events.append(this.o.events.connection('core', { session: meta.session, agent: meta.agent }), {
      v: 1, id: ulid(ts), kind: 'claim.progress', ts, subject: claim,
      data: { task, rounds: count.rounds, last: count.last ? { items: count.last.items, passing: [...count.last.passing] } : null, seen: [...count.seen], stalled: count.stalled ?? null },
    });
  }

  /** A task's claim and the round's receipt, both read and written under StopJudging's per-task queue. */
  async taskOf(claim: string): Promise<string | undefined> {
    const [row] = (await this.o.record().raw(`SELECT subject_ref FROM claims WHERE id = ?`, [claim.slice(6)])) as { subject_ref: string | null }[];
    return row?.subject_ref ?? undefined;
  }

  async sentBack(meta: HookMeta, claim: string, round: number): Promise<void> {
    const [verdict] = (await this.o.record().raw(`SELECT handle FROM verdicts WHERE claim_id = ? ORDER BY created DESC LIMIT 1`, [claim.slice(6)])) as { handle: string | null }[];
    const ts = this.o.now();
    if (verdict?.handle) await this.o.events.append(this.o.events.connection('core', { session: meta.session, agent: meta.agent }), { v: 1, id: ulid(ts), kind: 'claim.sent_back', ts, subject: claim, data: { claim, verdict: verdict.handle, round, to: `session:${letters(meta.session)}` } });
  }

  /** The requirement IDs a recorded split moved to a follow-up issue. */
  async movedOut(task: string): Promise<Set<string>> {
    const rows = (await this.o.record().raw(`SELECT data FROM events WHERE kind = 'issue.drafted' AND json_extract(data, '$.task_ref') = ? AND json_extract(data, '$.because') = 'split'`, [task])) as { data: string }[];
    return new Set(rows.flatMap((r) => (JSON.parse(r.data) as { items: { id: string }[] }).items.map((i) => i.id)));
  }

  /** A crash between durable progress and its send-back receipt must not lose or repeat that receipt. */
  async recoverReceipts(): Promise<void> {
    const missing = (await this.o.record().raw(`SELECT p.subject AS claim, p.session_id AS session, p.agent, json_extract(p.data, '$.rounds') AS round,
      (SELECT handle FROM verdicts v WHERE 'claim:' || v.claim_id = p.subject ORDER BY created DESC LIMIT 1) AS verdict
      FROM events p WHERE p.kind = 'claim.progress' AND p.writer = 'core' AND json_extract(p.data, '$.rounds') > 0 AND json_extract(p.data, '$.stalled') IS NULL
      AND NOT EXISTS (SELECT 1 FROM events sent WHERE sent.kind = 'claim.sent_back' AND sent.subject = p.subject AND json_extract(sent.data, '$.round') = json_extract(p.data, '$.rounds'))`)) as { claim: string; session: string; agent: string; round: number; verdict: string | null }[];
    for (const r of missing) if (r.verdict) {
      const ts = this.o.now();
      await this.o.events.append(this.o.events.connection('core', { session: r.session, agent: r.agent }), {
        v: 1, id: ulid(ts), kind: 'claim.sent_back', ts, subject: r.claim, data: { claim: r.claim, verdict: r.verdict, round: r.round, to: `session:${letters(r.session)}` },
      });
    }
  }
}

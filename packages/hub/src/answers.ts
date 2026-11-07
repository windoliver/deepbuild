// Answer content and delivery records (#25, #327, #906). Hook scheduling and transcript acknowledgements stay
// with session routing; this module reads only eligible answers and records what a route actually delivered.
import type { Delivery } from '@deepbuild/asks';
import type { RecordStore } from '@deepbuild/record';

/** An answered ask as stored, plus words and an image from its newest answer event. */
export interface Answer {
  id: string; session: string; question: string | null; options: string | null;
  answer: string | null; words: string | null; image: string | null;
  /** The option a provisional ask went on with; null on any other ask. */
  undoes?: string | null;
}
export type DeliveryOutcome = 'delivered' | 'stalled' | 'timed_out' | 'replaced' | 'waiting';
interface AnswersOptions {
  raw: RecordStore['raw'];
  /** Settles once every append in flight has, but the one of event `except`. */
  settled(except?: string): Promise<unknown>;
  /** Already in flight or owned by a permission prompt: neither is offered by another route. */
  excluded(id: string): boolean;
  /** A delivered answer is also input to the session's loop, unless a planted program drops it. */
  delivered: ((session: string) => void) | undefined;
  append(data: { delivery: string; via: string; outcome: DeliveryOutcome }, version: 1 | 2): Promise<void>;
}
const sql = (text: string): string => text.replace(/'/g, "''");

export class Answers {
  constructor(private readonly o: AnswersOptions) {}

  /**
   * Thread answers not delivered or already in flight; an explicit scope is the caller's record predicate. A hook's
   * reply passes its own event as `hook`, which it doesn't wait for.
   */
  async waitingFor(session: string, scope?: string, hook?: string): Promise<Answer[]> {
    await this.o.settled(hook);
    const thread = `COALESCE((SELECT thread_id FROM sessions WHERE id = '${sql(session)}'), '${sql(session)}')`;
    const mine = scope ?? `COALESCE((SELECT thread_id FROM sessions WHERE id = a.session_id), a.session_id) = ${thread}`;
    const rows = ((await this.o.raw(`SELECT a.id, a.session_id AS session, a.question, a.options, a.answer, iif(a.provisional = 1, a.recommended, NULL) AS undoes FROM asks a WHERE a.status = 'answered' AND ${mine}
      AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.delivery = a.id AND d.outcome = 'delivered') ORDER BY a.answered`)) as Omit<Answer, 'words' | 'image'>[])
      .filter((row) => !this.o.excluded(row.id));
    if (!rows.length) return [];
    const events = (await this.o.raw(`SELECT subject, data FROM events WHERE kind = 'ask.answered' AND subject IN (${rows.map(() => '?').join(', ')}) ORDER BY log_pos`, rows.map((row) => `ask:${row.id}`))) as { subject: string; data: string }[];
    const latest = new Map(events.map((e) => [e.subject, JSON.parse(e.data) as { words?: unknown; image?: unknown }]));
    return rows.map((row) => {
      const data = latest.get(`ask:${row.id}`) ?? {};
      return { ...row, words: typeof data.words === 'string' ? data.words : null, image: typeof data.image === 'string' ? data.image : null };
    });
  }

  /** An answer delivered into a session starts its loop's held checks at the next green turn end (#965). */
  async outcome(ask: string, via: string, outcome: DeliveryOutcome): Promise<void> {
    if (outcome === 'delivered' && this.o.delivered) {
      const [row] = (await this.o.raw('SELECT session_id FROM asks WHERE id = ?', [ask]).catch(() => [])) as { session_id: string | null }[];
      if (row?.session_id) this.o.delivered(row.session_id);
    }
    return this.o.append({ delivery: `ask:${ask}`, via, outcome }, outcome === 'waiting' ? 2 : 1).catch(() => undefined);
  }

  /** An ended Codex session's answer waits on its task; only the same thread's resume hears it (#39). */
  async waitsOnTask(delivery: Delivery): Promise<void> {
    const [last] = (await this.o.raw(`SELECT e.kind, s.agent FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.session_id = '${sql(delivery.session)}' AND e.kind IN ('session.start', 'session.end') ORDER BY e.log_pos DESC LIMIT 1`)) as { kind: string; agent: string }[];
    if (last?.kind === 'session.end' && last.agent === 'codex') await this.outcome(delivery.ask.replace(/^ask:/, ''), 'on_task', 'waiting');
  }
}

/** The answers as the agent reads them, each naming its ask; free text never becomes an authority decision. */
export function answerText(rows: Answer[], commitsUnder?: (ask: string) => string[] | undefined): string {
  const lines = rows.map((row) => {
    const chosen = row.answer === null ? null : JSON.parse(row.answer) as unknown;
    const options = row.options === null ? [] : JSON.parse(row.options) as { id: string; label: string }[];
    const label = options.find((o) => o.id === chosen)?.label;
    // Your answer differs from the option the agent went on with: it hears both, and the commits made under the old one.
    const under = row.undoes && chosen !== row.undoes && typeof chosen === 'string' && label ? commitsUnder?.(row.id) : undefined;
    if (under) return `Your answer to ask:${row.id}${row.question ? ` ("${row.question}")` : ''}: ${label} (${chosen}), in place of ${options.find((o) => o.id === row.undoes)?.label ?? row.undoes}, which you went on with. Undo it${under.length ? `: the commits made under it are ${under.join(', ')}` : ''}, then move to ${label}.`;
    const beside = [row.words === null || row.words === chosen ? [] : [`your words: "${row.words}"`], row.image === null ? [] : [`a screenshot, sha256 ${row.image}`]].flat();
    if (row.image !== null && row.image === chosen) return `Your answer to ask:${row.id}${row.question ? ` ("${row.question}")` : ''}: a screenshot, sha256 ${row.image}${row.words === null ? '' : ` — with your words: "${row.words}"`}.`;
    if (chosen === 'agent' && row.words) return `Your answer to ask:${row.id}: the agent can do it, so take this step yourself. ${row.words}`;
    return `Your answer to ask:${row.id}${row.question ? ` ("${row.question}")` : ''}: ${label ? `${label} (${String(chosen)})` : String(chosen)}${beside.length ? ` — with ${beside.join(' and ')}` : ''}.`;
  });
  return `DeepBuild delivers your answers:\n${lines.join('\n')}`;
}

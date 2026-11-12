// Send values shared with recorded schedule history.
/** One send, as the hub holds it. */
export interface SendRow {
  key: string; piece: string; schedule: string | null; run: string | null; kind: string; to: string[];
  outcome: 'sent' | 'not sent' | 'unknown' | 'waiting';
  plan: string;
  ask: string | null; rule: string | null;
}
/** A standing rule for sends: the piece that sends, its recipients and, for a scheduled send, the schedule. */
export interface SendRule { sentence: string; piece: string; recipients: string[]; schedule: string | null }

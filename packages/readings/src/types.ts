/** An event of the record, as plain data. `session` has no `session:` prefix. A turn is the id of the user.ask that began it. */
export interface RecordEvent { id: string; kind: string; v?: number; ts: number; session: string | null; subject?: string | null; data: Record<string, unknown> }
export type Cost = { basis: 'reported'; usd: number } | { basis: 'estimated'; usd: number; rate_card: string } | { basis: 'unpriced' };
export interface HeldBy { question: number; slow: number; fast: number; snapshot_start: number; queue_wait: number }
export interface ClassifierCheck { id: string; n: number; agreement: number | null; status: 'PASS' | 'FAIL' | 'BLOCKED'; labelled_by: string | null }
export interface Reading {
  id: string;
  subject: string | null;
  /** null is missing or unknown, never zero. */
  value: number | string | null;
  unit: string;
  source: string;
  /** The newest event or source reading it counts, in ms. */
  as_of: number;
  /** Measured, or worked out from a model such as a rate card or a classifier. */
  basis: 'observed' | 'modeled';
  cost?: Cost;
  /** On a spend: false when a turn it sums has no price or no known usage. */
  complete?: boolean;
  /** On a classifying reading: its check against your labels, or null when it has none. */
  classifier?: ClassifierCheck | null;
  by?: HeldBy;
  /** On a reading with a budget: whether it is inside it. Numbers lists those over it first. */
  band?: 'inside' | 'over';
}

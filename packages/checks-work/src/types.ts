// The shapes of R2's checks for work beyond code (#68): check@1's fields with each kind's own, and the fill.
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec, KindBudget } from '@deepbuild/conformance';

export type WorkKind = 'service' | 'data' | 'document' | 'message';
export type JsonType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

/** An endpoint answers with the expected shape, within its latency and throughput floor, from where its users are. */
export interface ServiceSpec extends CheckSpec {
  kind: 'service'; runner: 'http';
  url: string;
  /** A local address of this machine where the endpoint's users are; every request leaves from it. */
  from: string;
  shape: Record<string, JsonType>;
  floor: { latency_ms: number; throughput_rps: number };
  requests: number;
}
/** A query on a SQLite file in the checkout, opened read-only, returns the rows or totals that must hold. */
export interface DataSpec extends CheckSpec {
  kind: 'data'; runner: 'sqlite';
  database: string; query: string; rows: Record<string, string | number | null>[];
}
/** A Markdown file in the checkout whose every claim cites a JSON source and whose every number matches it. */
export interface DocumentSpec extends CheckSpec { kind: 'document'; runner: 'markdown'; document: string }
/** A message delivered to a Maildir in the checkout, and acknowledged by its seen flag. */
export interface MessageSpec extends CheckSpec { kind: 'message'; runner: 'maildir'; mailbox: string; message_id: string }
export type WorkSpec = ServiceSpec | DataSpec | DocumentSpec | MessageSpec;

/** A kind as the check.kind@1 fill deep.registerCheck registers, with its declared budget. */
export interface WorkFill extends CheckRunnerFill {
  kind: WorkKind;
  budget: KindBudget;
  run(spec: WorkSpec, ctx: CheckContext): CheckResult | Promise<CheckResult>;
}

/** The drafting job's proposal for one requirement: its ID, its text as the source states it, and the check it picked, or null. */
export interface DraftedRequirement { req: string; text: string; check: CheckSpec | null }
/** An early question: the requirement's ID and the question, which quotes the requirement's text. */
export interface EarlyQuestion { req: string; question: string }
export interface Draft { checks: { req: string; spec: CheckSpec }[]; questions: EarlyQuestion[] }

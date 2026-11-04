// The review check's shapes (#87): its spec, what the second model is given and answers, findings and send-backs.
import type { CheckContext, CheckResult, CheckRunnerFill, CheckSpec } from '@deepbuild/conformance';

/** check@1's spec for kind `review`: base..head on a claim's first round, or since.commit..head alone on a re-review,
 *  `since.items` being the items sent back on the claim still open. `rubric` is the wiki's rubric page, whose list
 *  items `- <rule>: <text>` are its rules, in order. */
export interface ReviewSpec extends CheckSpec {
  kind: 'review'; runner: 'second-model'; oracle: 'model';
  base: string; head: string; rubric: string;
  since: { commit: string; items: SendBackItem[] } | null;
}
/** What the second model is given: the diff alone and the rubric's rules, never a transcript, a claim or PR text. */
export interface ReviewRequest { diff: string; rubric: string[] }
/** The second model's structured answer: findings, beside whatever prose it adds, which is never trusted. */
export type ReviewerAnswer = { findings: unknown[]; [field: string]: unknown };
export type Reviewer = (request: ReviewRequest) => ReviewerAnswer | Promise<ReviewerAnswer>;

export interface Site { file: string; line: number; quote: string }
export interface ReviewFinding extends Site { rule: string }
/** One rule and every site of it, so the agent fixes the class. */
export interface SendBackItem { rule: string; sites: Site[] }
export interface ReviewSendBack { items: SendBackItem[] }
export interface DroppedFinding { finding: { file?: unknown; line?: unknown; rule?: unknown; quote?: unknown }; reason: string }

export interface ReviewResult extends CheckResult {
  sendBack: ReviewSendBack | null;
  /** Items sent back on this claim earlier and still open after this round, not sent again. */
  open: SendBackItem[];
  /** Counted findings on lines the change didn't add or alter: pre-existing. */
  followUps: ReviewFinding[];
  dropped: DroppedFinding[];
  verdictLine: string;
}
export interface ReviewFill extends CheckRunnerFill {
  kind: 'review';
  run(spec: ReviewSpec, ctx: CheckContext): Promise<ReviewResult>;
  review(spec: ReviewSpec, ctx: CheckContext, reviewer: Reviewer): Promise<ReviewResult>;
}

export interface SentBack { commit: string; items: SendBackItem[] }
export interface ItemOutcome { rule: string; sites: Site[]; ended: 'fixed' | 'left'; commit: string }

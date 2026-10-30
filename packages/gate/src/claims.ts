// Which stops and calls make a claim (#29; design: Every stop is judged, and Claim): one claim per open ask a
// source touched, never from a stop with no work since the turn began or from an answer, and never from the words
// of the agent's last message. `deep_claim` and `gh pr create` make claims inside a turn, which wait for its stop.
import { randomBytes } from 'node:crypto';

export type ClaimSource = 'stop' | 'deep_claim' | 'gh_pr_create';
export interface OpenAsk { task_ref: string; touched: boolean }
export interface ClaimIntake {
  source: ClaimSource;
  session: string;
  commit: string;
  asks: OpenAsk[];
  turn: { work: boolean; answer: boolean; last_message?: string };
  named?: string[];
}
export interface MadeClaim { claim: string; task_ref: string; source: ClaimSource; session: string; commit: string }
export type ClaimPlant = 'claims-every-open-ask' | 'claims-on-words' | 'claims-on-answers' | 'two-per-ask';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const id = (): string => {
  let n = BigInt(`0x${randomBytes(16).toString('hex')}`);
  let s = '';
  for (let i = 0; i < 26; i++) { s = CROCKFORD[Number(n & 31n)] + s; n >>= 5n; }
  return `claim:${s}`;
};
const DONE_WORDS = /\b(done|finished|complete|completed)\b/i;

export function claimsFor(intake: ClaimIntake, options: { plant?: ClaimPlant } = {}): MadeClaim[] {
  const { plant } = options;
  const { turn } = intake;
  const worked = turn.work || (plant === 'claims-on-words' && DONE_WORDS.test(turn.last_message ?? ''));
  if (!worked) return [];
  if (intake.source === 'stop' && turn.answer && plant !== 'claims-on-answers') return [];
  const refs = intake.named ?? intake.asks.filter((a) => a.touched || plant === 'claims-every-open-ask').map((a) => a.task_ref);
  const made = [...new Set(refs)].map((task_ref) => ({ claim: id(), task_ref, source: intake.source, session: intake.session, commit: intake.commit }));
  return plant === 'two-per-ask' ? made.flatMap((c) => [c, { ...c, claim: id() }]) : made;
}

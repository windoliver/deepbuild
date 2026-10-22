// The values the #86 tests build: a virtual clock, ULIDs minted from it, run handles, input digests, the
// issues and the GPU the budgets cover. It loads no package, so a file that fails to load names the ledger.

import { createHash } from 'node:crypto';

export const HOUR = 3_600_000;
export const DAY = 86_400_000;
/** 2026-10-20 12:00 UTC: every world's clock starts here, so a 1-day deadline falls at 2026-10-21 12:00 UTC. */
export const T0 = Date.UTC(2026, 9, 20, 12, 0, 0);
/** Every budget the tests approve ends 30 days after T0, far past any clock a test moves to. */
export const ENDS = T0 + 30 * DAY;

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---- ULIDs minted from the virtual clock, in minting order.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let minted = 0;
export function ulid(ms: number): string {
  let time = '';
  for (let t = ms, i = 0; i < 10; i++, t = Math.floor(t / 32)) time = CROCKFORD[t % 32] + time;
  let tail = '';
  for (let n = ++minted, i = 0; i < 16; i++, n = Math.floor(n / 32)) tail = CROCKFORD[n % 32] + tail;
  return time + tail;
}
/** A new run handle, `run:<ULID>`. */
export const runId = (): string => `run:${ulid(T0)}`;
/** A new decision handle, `decision:<ULID>`: the saved decision a resolver answers with. */
export const decisionId = (): string => `decision:${ulid(T0)}`;
/** The digest of a run's inputs: the same text is the same inputs. */
export const inputs = (text: string): string => sha256(`inputs:${text}`);

export interface Clock { now(): number; set(ms: number): void }
export const makeClock = (start = T0): Clock => {
  let t = start;
  return { now: () => t, set: (ms) => { t = ms; } };
};

// ---- What the budgets cover.
export const ISSUE_A = 'windoliver/deepbuild#41';
export const ISSUE_B = 'windoliver/deepbuild#42';
export const ISSUE_C = 'windoliver/deepbuild#43';
/** An issue nobody approved a budget for: its paid runs are requests that reach you or a resolver. */
export const ISSUE_UNBUDGETED = 'windoliver/deepbuild#77';
/** A GPU, by the key its lease names. */
export const GPU = 'local/gpu/a100-0';
/** The checks the runs belong to: a live call and a hosted browser run. */
export const LIVE_CALL = 'live.checkout-call';
export const HOSTED_RUN = 'hosted.browser-journey';
export const GPU_RENDER = 'gpu.render-golden';

/** Every order of the given items. */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

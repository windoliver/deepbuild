// Lifecycle numbers from a forge's merged pull requests: time from issue to merge, first-pass merges, time to first review.
export interface MergedPr {
  number: number;
  merged_at: number;
  /** When the issue it closes was opened; null when it closes none. */
  issue_opened_at: number | null;
  opened_at: number;
  /** Each review's time and state, in order. */
  reviews: { at: number; state: string }[];
}
export interface LifecycleNumber { reading: string; value: number; unit: string; n: number }
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)]!;
/** A number with nothing to count is left out, so it reads missing, never zero. */
export function lifecycleNumbers(repo: string, prs: readonly MergedPr[]): LifecycleNumber[] {
  const key = repo.replace(/[^0-9A-Za-z]/g, '');
  const out: LifecycleNumber[] = [];
  const toMerge = prs.flatMap((p) => (p.issue_opened_at === null ? [] : [p.merged_at - p.issue_opened_at]));
  if (toMerge.length) out.push({ reading: `reading:${key}issuetomerge`, value: median(toMerge), unit: 'ms', n: toMerge.length });
  if (prs.length) out.push({ reading: `reading:${key}firstpass`, value: prs.filter((p) => !p.reviews.some((r) => r.state === 'CHANGES_REQUESTED')).length / prs.length, unit: 'share', n: prs.length });
  const toReview = prs.flatMap((p) => (p.reviews.length ? [p.reviews[0]!.at - p.opened_at] : []));
  if (toReview.length) out.push({ reading: `reading:${key}firstreview`, value: median(toReview), unit: 'ms', n: toReview.length });
  return out;
}

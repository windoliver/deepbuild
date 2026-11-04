// The review replay (#87) the preflight's replay lane runs on the merge base and on a change to the review check:
// this checkout's finding filters over the cases it keeps, each a diff with the second model's recorded answer.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { judgeAnswer } from './review.js';
import type { ReviewFinding, ReviewerAnswer, SendBackItem } from './types.js';

export interface ReplayedCase { case: string; findings: ReviewFinding[] }
/** Where a checkout keeps the replay's cases: the planted-bug diffs, their clean twins and the recorded rounds. */
const CASES = 'packages/checks-review/replay';
interface Case { diff: string; rubric: string[]; answer: ReviewerAnswer; since?: SendBackItem[] }

export async function replayReview(root: string): Promise<ReplayedCase[]> {
  const dir = join(root, CASES);
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort().map((name) => {
    const c = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Case;
    const judged = judgeAnswer(c.diff, c.rubric.map((r) => r.slice(0, r.indexOf(':'))), c.answer, c.since ?? []);
    return { case: `${CASES}/${name}`, findings: judged.items.flatMap((i) => i.sites.map((s) => ({ ...s, rule: i.rule }))) };
  });
}

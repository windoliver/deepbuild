// Review passes that found bugs after a close in this repo (#87), run again before "Closes": each on the claim's own
// diff, and each on the diff of every PR it found bugs in. How many of those bugs a pass finds again is a reading for
// Decision 1's numbers (#43), never a pass or a fail. A pass has a scope (#2748), and the hub runs here only the
// passes whose scope covers the claim's diff. What a pass finds on the claim is judged as a review finding is: it
// counts only with its quote at the file and line it cites, one on a line the change didn't add or alter is
// pre-existing, and the rest go back as one item naming the pass. A replay the caller keeps already under its key is
// read as carried, and the reviewer isn't asked again.
import { createHash } from 'node:crypto';
import { diffOf } from './diff.js';
import { judgeAnswer } from './review.js';
import type { DroppedFinding, ReviewFinding, SendBackItem } from './types.js';

export interface PassFinding { file: string; line: number; rule: string; quote: string }
export type PassReviewer = (job: { pass: string; prompt: string; commit: string; diff: string }) => Promise<PassFinding[]>;
export interface PostClosePass {
  id: string; name: string; prompt: string;
  /** Path patterns in the form a rule's scope has on the rules page (#344); a pass with none covers every diff. */
  scope?: string[];
  found: { pr: number; base: string; head: string; bugs: { file: string; line: number }[] }[];
}
interface PassReading { measure: 'post-close review pass'; pass: string; found: number; of: number; prs: number[] }
export interface PostCloseReport {
  /** Each pass on the claim's diff: what its reviewer answered, and that answer judged: the item sent back, under the pass's ID, the pre-existing findings and the dropped ones. */
  claim: { pass: string; findings: PassFinding[]; sendBack: SendBackItem | null; followUps: ReviewFinding[]; dropped: DroppedFinding[] }[];
  /** `key` is what a replay's result depends on beside the model that answers: the pass's ID and prompt, and the PR's commits and bug sites. */
  replays: { pass: string; pr: number; head: string; key: string; found: number; of: number; carried?: true }[];
  readings: PassReading[];
}

export async function reviewBeforeCloses(o: {
  repo: string; base: string; head: string; passes: PostClosePass[]; reviewer: PassReviewer;
  /** How many of a PR's bugs the pass found on a replay kept under `key`, or undefined when none is kept. */
  carried?: (key: string) => Promise<number | undefined>;
}): Promise<PostCloseReport> {
  const report: PostCloseReport = { claim: [], replays: [], readings: [] };
  for (const p of o.passes) {
    const diff = diffOf(o.repo, o.base, o.head);
    const findings = await o.reviewer({ pass: p.id, prompt: p.prompt, commit: o.head, diff });
    const judged = judgeAnswer(diff, [p.id], { findings: findings.map((f) => ({ ...f, rule: p.id })) }, []);
    report.claim.push({ pass: p.id, findings, sendBack: judged.items[0] ?? null, followUps: judged.followUps, dropped: judged.dropped });
    for (const f of p.found) {
      const replay = { pass: p.id, pr: f.pr, head: f.head, key: createHash('sha256').update(JSON.stringify([p.id, p.prompt, f.pr, f.base, f.head, f.bugs])).digest('hex'), of: f.bugs.length };
      const kept = await o.carried?.(replay.key);
      if (kept !== undefined) { report.replays.push({ ...replay, found: kept, carried: true }); continue; }
      const again = await o.reviewer({ pass: p.id, prompt: p.prompt, commit: f.head, diff: diffOf(o.repo, f.base, f.head) });
      report.replays.push({ ...replay, found: f.bugs.filter((b) => again.some((x) => x.file === b.file && x.line === b.line)).length });
    }
    const mine = report.replays.filter((r) => r.pass === p.id);
    report.readings.push({ measure: 'post-close review pass', pass: p.id, found: mine.reduce((n, r) => n + r.found, 0), of: mine.reduce((n, r) => n + r.of, 0), prs: [...new Set(mine.map((r) => r.pr))] });
  }
  return report;
}

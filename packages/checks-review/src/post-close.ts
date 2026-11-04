// Review passes that found bugs after a close in this repo (#87), run again before "Closes": each on the claim's own
// diff, and each on the diff of every PR it found bugs in. How many of those bugs a pass finds again is a reading for
// Decision 1's numbers (#43), never a pass or a fail.
import { diffOf } from './diff.js';

export interface PassFinding { file: string; line: number; rule: string; quote: string }
export type PassReviewer = (job: { pass: string; prompt: string; commit: string; diff: string }) => Promise<PassFinding[]>;
export interface PostClosePass {
  id: string; name: string; prompt: string;
  found: { pr: number; base: string; head: string; bugs: { file: string; line: number }[] }[];
}
export interface PassReading { measure: 'post-close review pass'; pass: string; found: number; of: number; prs: number[] }
export interface PostCloseReport {
  claim: { pass: string; findings: PassFinding[] }[];
  replays: { pass: string; pr: number; head: string; found: number; of: number }[];
  readings: PassReading[];
}

export async function reviewBeforeCloses(o: { repo: string; base: string; head: string; passes: PostClosePass[]; reviewer: PassReviewer }): Promise<PostCloseReport> {
  const report: PostCloseReport = { claim: [], replays: [], readings: [] };
  const ask = (p: PostClosePass, base: string, head: string): Promise<PassFinding[]> =>
    o.reviewer({ pass: p.id, prompt: p.prompt, commit: head, diff: diffOf(o.repo, base, head) });
  for (const p of o.passes) {
    report.claim.push({ pass: p.id, findings: await ask(p, o.base, o.head) });
    for (const f of p.found) {
      const findings = await ask(p, f.base, f.head);
      const found = f.bugs.filter((b) => findings.some((x) => x.file === b.file && x.line === b.line)).length;
      report.replays.push({ pass: p.id, pr: f.pr, head: f.head, found, of: f.bugs.length });
    }
    const mine = report.replays.filter((r) => r.pass === p.id);
    report.readings.push({ measure: 'post-close review pass', pass: p.id, found: mine.reduce((n, r) => n + r.found, 0), of: mine.reduce((n, r) => n + r.of, 0), prs: [...new Set(mine.map((r) => r.pr))] });
  }
  return report;
}

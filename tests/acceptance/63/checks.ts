// The criterion checks that a criterion's wrong program is run through too (README, Wrong programs). Each returns
// the problems it found, each naming the handle or the job, so a test asserts none on the real program and the
// named problem on the twin.

import type { Line, Prompt, Ran } from './helpers.ts';
import { CAP, promptsOf, repliesOf } from './helpers.ts';
import type { Run, World } from './world.ts';
import { dataOf } from './world.ts';

// ---- AC3: a session read resolves through the record, to the evidence its transcript.archived event links.
/** A message of an archived copy, read from the evidence store's bytes as Claude Code's JSONL. */
export interface Stored { at: string; text: string }
export async function storedMessages(w: World, handle: string): Promise<{ evidence: string; messages: Stored[] }> {
  const links = (await w.events(['transcript.archived'])).filter((e) => dataOf(e).session === handle);
  if (!links.length) throw Error(`no transcript.archived event links ${handle}`);
  const evidence = String(dataOf(links[links.length - 1]!).evidence);
  const messages: Stored[] = [];
  for (const raw of Buffer.from(await w.store.read(evidence)).toString('utf8').split('\n')) {
    let e: Line;
    try { e = JSON.parse(raw) as Line; } catch { continue; }
    const content = e.message?.content;
    const parts: string[] = [];
    if (typeof content === 'string') parts.push(content);
    else if (Array.isArray(content)) for (const b of content as Line[]) {
      if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
      if (b.type === 'tool_result') parts.push(typeof b.content === 'string' ? b.content : (b.content as Line[]).map((c) => String(c.text ?? '')).join('\n'));
    }
    if (typeof e.uuid === 'string' && parts.join('').length) messages.push({ at: `${handle}#${e.uuid}`, text: parts.join('\n') });
  }
  return { evidence, messages };
}
/** What `deep read <handle> --slice --json` must give for an archived session: its messages, from the linked evidence. */
export function sessionSliceProblems(handle: string, ran: Ran, stored: readonly Stored[], decoys: readonly string[]): string[] {
  if (ran.status !== 0) return [`${handle}: the read exited ${ran.status}: ${ran.stderr.slice(0, 400)}`];
  let slice: Line;
  try { slice = JSON.parse(ran.stdout) as Line; } catch { return [`${handle}: the read printed no slice: ${ran.stdout.slice(0, 400)}`]; }
  const problems: string[] = [];
  const text = String(slice.text ?? '');
  const listed = (Array.isArray(slice.messages) ? slice.messages : []) as Line[];
  for (const m of stored) {
    const at = listed.find((x) => x.at === m.at);
    if (!at) { problems.push(`${handle}: the slice lists no ${m.at}`); continue; }
    const got = text.slice(Number(at.start), Number(at.end));
    if (got !== m.text) problems.push(`${handle}: ${m.at} reads ${JSON.stringify(got.slice(0, 80))}, not the archived copy's ${JSON.stringify(m.text.slice(0, 80))}`);
  }
  for (const d of decoys) if (ran.stdout.includes(d)) problems.push(`${handle}: the slice holds ${JSON.stringify(d)}, which only a file outside the record holds`);
  return problems;
}
/** What it must give for a session no transcript.archived event links: an error naming the handle, never a slice. */
export function missingSliceProblems(handle: string, ran: Ran, texts: readonly string[]): string[] {
  const problems: string[] = [];
  if (ran.status === 0) problems.push(`${handle}: the read exited 0 for a session no transcript.archived event links`);
  if (!ran.stderr.includes(handle)) problems.push(`${handle}: the error doesn't name the handle: ${JSON.stringify(ran.stderr.slice(0, 300))}`);
  let slice: Line | undefined;
  try { slice = JSON.parse(ran.stdout) as Line; } catch { slice = undefined; }
  if (slice && typeof slice === 'object' && 'text' in slice) problems.push(`${handle}: the read printed a slice (text ${JSON.stringify(String(slice.text).slice(0, 80))}) instead of an error`);
  for (const t of texts) if (ran.stdout.includes(t.slice(0, 40))) problems.push(`${handle}: the read printed the agent's own transcript text ${JSON.stringify(t.slice(0, 40))}`);
  return problems;
}

// ---- AC4: no prompt holds more of the record than a capped slice.
/** How many characters of record text a prompt holds: for each corpus message whose tag is in it, the run of its text that follows. */
export function recordChars(prompt: string, tags: ReadonlyMap<string, string>): number {
  let total = 0;
  for (const m of prompt.matchAll(/\[q\d+m\d+\]/g)) {
    const text = tags.get(m[0]);
    if (!text) continue;
    let k = 0;
    while (k < text.length && prompt[m.index! + k] === text[k]) k++;
    total += k;
  }
  return total;
}
export function promptProblems(runs: readonly Run[], tags: ReadonlyMap<string, string>): string[] {
  const problems: string[] = [];
  for (const run of runs) {
    for (const p of promptsOf(run.stdout) as Prompt[]) {
      const n = recordChars(p.text, tags);
      if (n > CAP) problems.push(`${run.job}: the prompt of ${p.who} holds ${n} characters of the record, more than a capped slice (${CAP})`);
    }
    for (const r of repliesOf(run.stdout)) {
      const n = r.slice ? String(r.slice.text ?? '').length : r.text.length;
      if (n > CAP) problems.push(`${run.job}: the reply to read ${r.args.handle} holds ${n} characters, past the cap (${CAP})`);
    }
  }
  return problems;
}

// ---- AC9: a marker no delivered slice covers appears in no prompt the job sent.
export function markerProblems(runs: readonly Run[], marker: string): string[] {
  const problems: string[] = [];
  for (const run of runs) {
    for (const p of promptsOf(run.stdout)) if (p.text.includes(marker)) problems.push(`${run.job}: the prompt of ${p.who} holds the marker ${marker}`);
    for (const r of repliesOf(run.stdout)) if (r.text.includes(marker)) problems.push(`${run.job}: the reply to read ${r.args.handle} holds the marker ${marker}`);
    if (!problems.some((x) => x.startsWith(run.job)) && run.stdout.includes(marker)) problems.push(`${run.job}: its output holds the marker ${marker}`);
  }
  return problems;
}

// ---- AC10: the quote check's verdicts on the issue's cases.
export type Verdict = 'at' | 'refused';
export interface Case { name: string; at: string; quote: string; expected: Verdict }
export function caseProblems(cases: readonly Case[], verdicts: ReadonlyMap<string, Verdict>): string[] {
  return cases.filter((c) => verdicts.get(c.name) !== c.expected)
    .map((c) => `${c.name}: the quote ${JSON.stringify(c.quote)} at ${c.at} was ${verdicts.get(c.name) ?? 'not judged'}, expected ${c.expected}`);
}

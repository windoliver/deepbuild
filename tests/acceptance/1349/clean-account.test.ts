// AC1 and AC6's real-world part: the one recorded run on a clean macOS test account (README: The contract, 9). No
// fixture can make a clean account or a person signing in, so these read the evidence the implementer puts under
// docs/evidence/1349/: the recording, its marks, a copy of that account's ~/.deepbuild, and a person's call on the
// recording. Without them, or without the call recorded on exactly these files, each reads INCONCLUSIVE, never PASS.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cards, closing, CREDENTIAL, CRITERION, EVIDENCE, inconclusive, named, recordCopy, said, sha256, signInTasks, walk, type Line } from './helpers.ts';

const FILES = { recording: 'clean-account.mov', run: 'clean-account.json', copy: 'deepbuild', call: 'watched.json' } as const;
/** The marks the run's file must hold, in this order, each the seconds into the recording it happened. */
const MARKS = ['opened from Finder', 'Set up pressed', 'box ready', 'topic sent', 'Sign in pressed', 'signed in', 'card'];

interface Evidence { run: Line; copy: string; call?: Line; recordingSha: string; runSha: string }
/** The evidence, or INCONCLUSIVE naming what's missing. */
function evidence(): Evidence {
  const missing = Object.values(FILES).filter((f) => f !== FILES.call && !existsSync(join(EVIDENCE, f)));
  if (missing.length) inconclusive(`the clean account's run isn't recorded: docs/evidence/1349/ lacks ${missing.join(', ')}`);
  const run = JSON.parse(readFileSync(join(EVIDENCE, FILES.run), 'utf8')) as Line;
  const call = existsSync(join(EVIDENCE, FILES.call)) ? JSON.parse(readFileSync(join(EVIDENCE, FILES.call), 'utf8')) as Line : undefined;
  return { run, copy: join(EVIDENCE, FILES.copy), ...(call ? { call } : {}), recordingSha: sha256(readFileSync(join(EVIDENCE, FILES.recording))), runSha: sha256(readFileSync(join(EVIDENCE, FILES.run))) };
}
/** What the run's file must say: a clean account, the marks in order, a person signing in. */
function runFailures(run: Line): string[] {
  const out: string[] = [];
  for (const k of ['agent', 'node', 'git', 'developer_tools']) if (run.had?.[k] !== false) out.push(`clean-account.json doesn't say the account had no ${k}: had.${k} is ${said(run.had?.[k])}`);
  const marks = (Array.isArray(run.marks) ? run.marks : []) as { at_s?: number; what?: string }[];
  let last = -1;
  for (const want of MARKS) {
    const m = marks.find((x) => String(x.what ?? '').toLowerCase() === want.toLowerCase());
    if (!m || typeof m.at_s !== 'number') { out.push(`the recording's marks hold no "${want}"`); continue; }
    if (m.at_s < last) out.push(`the mark "${want}" at ${m.at_s} s comes before the one before it`);
    last = m.at_s;
  }
  return out;
}
/** The person's call on the recording: on exactly these files, `pass` for the criterion; a `fail` fails, anything else is INCONCLUSIVE. */
function callOn(e: Evidence, criterion: 'AC1' | 'AC6'): void {
  const c = e.call;
  if (!c) inconclusive(`no one has watched the recording: docs/evidence/1349/${FILES.call} holds no call`);
  if (c!.files?.[FILES.recording] !== e.recordingSha || c!.files?.[FILES.run] !== e.runSha) inconclusive(`the call in ${FILES.call} is on other files than these (sha256 ${e.recordingSha.slice(0, 12)}…, ${e.runSha.slice(0, 12)}…)`);
  if (typeof c!.who !== 'string' || !c!.who || typeof c!.when !== 'string') inconclusive(`the call in ${FILES.call} names no one or no time`);
  expect(c!.calls?.[criterion], `${c!.who}'s call on the recording for ${criterion}: ${said(c!.note ?? '')}`).not.toBe('fail');
  if (c!.calls?.[criterion] !== 'pass') inconclusive(`${FILES.call} holds no call for ${criterion}`);
}
/** Anything credential-shaped in the copy of the account's ~/.deepbuild, the program under versions/ left out. */
function copyHits(copy: string): string[] {
  return walk(copy).filter((f) => !f.startsWith(`${join(copy, 'versions')}/`)).flatMap((f) => {
    const text = readFileSync(f).toString('latin1');
    return CREDENTIAL.filter((re) => re.test(text)).map((re) => `${f}: ${re.source}`);
  });
}

describe('the clean account', () => {
  it(`${named(1)} ${CRITERION[1]} (the recorded run)`, () => {
    const e = evidence();
    const failures = runFailures(e.run);
    const all = recordCopy(e.copy);
    const installs = all.filter((x) => x.kind === 'setup.step' && x.data?.step === 'install').map((x) => x.data?.agent);
    if (installs.length !== 1 || installs[0] !== 'claude-code') failures.push(`the account's record names ${said(installs)} as installed by Set up, not Claude Code once`);
    failures.push(...copyHits(e.copy).map((h) => `the account's state folder holds something credential-shaped: ${h}`));
    expect(failures, 'the recorded run is a clean account taken from the download to the box, and its state folder holds no credential').toEqual([]);
    callOn(e, 'AC1');
  });

  it(`${named(6)} ${CRITERION[6]} (the recorded run: a person signs in once from the row's button)`, () => {
    const e = evidence();
    const failures = runFailures(e.run);
    if (e.run.signed_in_by !== 'person') failures.push(`clean-account.json says the sign-in was by ${said(e.run.signed_in_by)}, not a person`);
    const all = recordCopy(e.copy);
    const tasks = signInTasks(all, 0);
    if (tasks.length !== 1) failures.push(`the account's record holds ${tasks.length} sign-in tasks, not one`);
    const closed = tasks[0] ? closing(all, tasks[0]) : undefined;
    if (tasks[0] && (closed?.kind !== 'ask.moot' || closed.data?.because !== 'signed_in')) failures.push(`the sign-in task closed as ${said(closed ? [closed.kind, closed.data] : 'never')}, not ask.moot because signed_in`);
    const card = closed ? cards(all, closed.log_pos)[0] : undefined;
    if (!card) failures.push('no card came for the topic after the sign-in');
    else if (typeof e.run.topic === 'string' && !JSON.stringify(card.brief ?? {}).toLowerCase().includes(e.run.topic.toLowerCase().split(' ').slice(0, 3).join(' '))) failures.push(`the card's brief doesn't carry the words sent, ${said(e.run.topic)}`);
    expect(failures, 'the recorded run: one sign-in, closed by its probe, then the words went to the agent and came back as a card').toEqual([]);
    callOn(e, 'AC6');
  });
});

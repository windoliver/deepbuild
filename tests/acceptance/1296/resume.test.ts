// #1296 AC4: a planted resume block of about 14,000 characters is delivered with every requirement ID and every rule
// you typed inside the 10,000-character cap, and the rest goes by handle. A hub that sends it whole
// (DEEP_HUB_PLANT=sends-block-whole) lets Claude Code cut it to a 2,000-character preview and fails, naming the first
// missing ID. The record says what went inline and what went by handle.
//
// The world, hub and session are #340's (../340/flow/helpers.ts). The session opens #340's three asks, each locking a
// handed definition (R1 to R12), and you type five rules (`rule: <text>.`). The repo's AGENTS.md holds 54 rule lines
// (`bulk-00` to `bulk-53`), 13,661 characters, which DeepBuild gives a Claude Code session as rules from your
// rule files. The block is the context the SessionStart of a resume injects (README, The planted resume block):
// `hookSpecificOutput.additionalContext` on deep-hook's stdout. What the model sees is modelled from the issue's
// numbers (helpers.ts, seenByModel): all of it inside the cap, else only its first 2,000 characters.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HANDLE_SCHEMES } from '@deepbuild/contracts';
import {
  allEvents, childEnv, CLI, cleanup, contextOf, failureOf, makeWorld, must, NODE, OPEN_DRAFTS, OPEN_IDS, openAsks, run, Session, settle, shown,
  startHub, type Ev, type Ran, type World,
} from '../340/flow/helpers.ts';
import { AC4, CAP, seenByModel } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The rules you type in the session, each in its own prompt. */
const TYPED = [
  'Name every branch after the issue number it closes',
  'Never print a session token in full in any log line',
  'Keep each pull request under four hundred handwritten lines',
  'Run the login tests before you say a change to the auth middleware is done',
  'Ask before adding a dependency that the lockfile does not already hold',
];
const FILLER = 'keep the change small, read the module before editing it, prefer the existing helper over a new one, leave the public entry as it is, write the test that fails first, and say in the summary which files you touched and why each one changed';
/** The rule lines of the repo's AGENTS.md, each with its own marker. */
const BULK = Array.from({ length: 54 }, (_, i) => `Rule bulk-${String(i).padStart(2, '0')}: ${FILLER}`);
const PLANTED = BULK.join('\n').length + TYPED.join('\n').length + OPEN_IDS.join(', ').length;

const names = (text: string, id: string) => new RegExp(`(?<![A-Za-z0-9])${id}(?![A-Za-z0-9])`).test(text);
const HANDLE = new RegExp(`(?<![A-Za-z0-9])((?:${[...HANDLE_SCHEMES, 'wiki', 'rule'].join('|')}):[0-9A-Za-z][0-9A-Za-z._/-]*(?:#[A-Za-z0-9][A-Za-z0-9._-]*)?)`, 'g');

interface Resumed { w: World; session: string; reply: Ran; events: Ev[]; startPos: number }

/** The session up to its resume: three open asks, five typed rules, an end, then SessionStart with source resume. */
async function resumed(plant?: string): Promise<Resumed> {
  const w = makeWorld({ drafts: OPEN_DRAFTS() });
  writeFileSync(join(w.repo, 'AGENTS.md'), `# Rules for agents in this repo\n\n${BULK.map((b) => `- ${b}`).join('\n')}\n`);
  const hub = await startHub(w, { plant });
  const s = new Session(w, 'terminal');
  await s.start();
  await openAsks(hub, s);
  for (const rule of TYPED) {
    await s.typed(`rule: ${rule}.`);
    await s.stop('Noted.');
  }
  await s.end('prompt_input_exit');
  const reply = await s.start('resume');
  const isResume = (e: Ev) => e.kind === 'session.start' && e.session === s.id && e.data.source === 'resume';
  let events = await settle(hub, (all) => all.some(isResume), 30_000);
  // What the core records after the reply: read until the record is quiet for 2 s.
  for (let last = events.length; ;) {
    await new Promise((done) => setTimeout(done, 2000));
    events = await allEvents(hub);
    if (events.length === last) break;
    last = events.length;
  }
  const startPos = events.filter(isResume).at(-1)?.log_pos ?? events.filter((e) => e.kind === 'session.start' && e.session === s.id).at(-1)?.log_pos ?? 0;
  return { w, session: s.id, reply, events, startPos };
}

/** `deep read <handle> --json`, following each slice's cursor: every slice's text. */
async function readAll(w: World, handle: string): Promise<{ text: string; ran: Ran }> {
  let text = '';
  let cursor: string | undefined;
  let last: Ran | undefined;
  for (let i = 0; i < 50; i++) {
    last = await run(NODE, [CLI, 'read', handle, '--json', ...(cursor !== undefined ? ['--slice', cursor] : [])], { env: childEnv(w.home), cwd: w.repo });
    if (last.code !== 0) break;
    const slice = JSON.parse(last.stdout) as { text?: string; next?: string | number };
    text += `${slice.text ?? ''}\n`;
    if (slice.next === undefined || slice.next === null) break;
    cursor = String(slice.next);
  }
  return { text, ran: last! };
}

/** The criterion on the resume's reply and the record. Throws naming what is missing. */
async function deliveredInsideCap(r: Resumed): Promise<void> {
  const context = contextOf(r.reply);
  must(context.length > 0, `${AC4} the resume's SessionStart must inject context (hookSpecificOutput.additionalContext): ${shown(r.reply)}`);
  const seen = seenByModel(context);
  const over = context.length > CAP ? `, past the ${CAP}-character cap, so Claude Code shows the model only its first ${seen.length} characters` : '';
  const missing = OPEN_IDS.find((id) => !names(seen, id));
  must(missing === undefined, `${AC4} the resume's injected context is ${context.length} characters${over}; the first requirement ID missing from what the model sees is ${missing}`);
  const rule = TYPED.find((t) => !seen.includes(t));
  must(rule === undefined, `${AC4} the resume's injected context is ${context.length} characters${over}; the rule you typed "${rule}" is missing from what the model sees`);
  must(context.length <= CAP, `${AC4} the resume's injected context must stay inside the ${CAP}-character cap; it is ${context.length}`);
  const where = context.split('\n').filter((l) => /deep[ _]read/.test(l));
  const handles = [...new Set(where.flatMap((l) => [...l.matchAll(HANDLE)].map((m) => m[1]!)))];
  must(handles.length > 0, `${AC4} what doesn't fit goes by handle, with a line saying where to continue (a line naming deep read and a handle): the context's lines naming deep read are ${JSON.stringify(where)}; it reads ${JSON.stringify(context.slice(0, 1500))}`);
  let rest = '';
  for (const h of handles) {
    const read = await readAll(r.w, h);
    rest += read.text;
  }
  const lost = BULK.map((b) => b.slice(5, 12)).find((marker) => !seen.includes(marker) && !rest.includes(marker));
  must(lost === undefined, `${AC4} every rule line of the block is inline or behind the handle (${handles.join(', ')}): ${lost} is in neither; deep read gave ${JSON.stringify(rest.slice(0, 800))}`);
  const recorded = r.events.filter((e) => e.log_pos >= r.startPos && e.kind !== 'session.start' && (e.session === r.session || JSON.stringify(e.data).includes(r.session)))
    .filter((e) => { const text = JSON.stringify(e.data); return handles.some((h) => text.includes(h)) && OPEN_IDS.every((id) => names(text, id)); });
  must(recorded.length > 0, `${AC4} the record says what went inline (every requirement ID) and what went by handle (${handles.join(', ')}): no event of session ${r.session} since its resume names both; its kinds since then: ${[...new Set(r.events.filter((e) => e.log_pos >= r.startPos).map((e) => e.kind))].join(', ')}`);
}

describe(`${AC4} a planted resume block of 14,000 characters is delivered with every requirement ID and every rule you typed inside the cap, the rest by handle, and the record says which went where`, () => {
  it(`${AC4} the resume's context holds R1 to R12 and the five typed rules inside 10,000 characters; the AGENTS.md lines that don't fit go by a handle deep read returns; the record names both`, async () => {
    expect(PLANTED, 'the planted block is at least 14,000 characters').toBeGreaterThanOrEqual(14_000);
    await deliveredInsideCap(await resumed());
  }, 600_000);

  it(`${AC4} (wrong program) a hub that sends the block whole (sends-block-whole) lets it be cut to a preview and fails, naming the first missing ID`, async () => {
    const r = await resumed('sends-block-whole');
    must(contextOf(r.reply).length > CAP, `${AC4} the planted hub must send the block whole, past the cap; it sent ${contextOf(r.reply).length} characters`);
    const failure = await failureOf(() => deliveredInsideCap(r));
    must(failure !== null, `${AC4} the hub that sends the block whole must fail this test: it passed`);
    expect(failure, 'it fails naming the first missing requirement ID').toMatch(/the first requirement ID missing from what the model sees is R\d+/);
  }, 600_000);
});

// AC2 #83.5bcede40: a status question returns the state, time in state, next step and the Needs-you count with no
// model call.
// AC4 #83.4b0836ba: a prompt that reads like a status question but comes from a scheduled task, a subagent's report
// or another session reaches the model unchanged; only a prompt a person typed is answered from the record.
// AC6 #83.eb2dc033: where the work is, which session holds it, how to resume it and its link are answered from the
// record.
//
//
// A blind redraft of ../status.test.ts for #319 (README): asks come in batches, and an ask waiting for its batch isn't
// shown in Needs you. The Needs-you count a status answer carries is the number of asks Needs you shows, the rows
// `deep inbox` lists, so an ask still waiting for its batch isn't counted. Only AC2's count changes; AC4 and AC6 are
// ../status.test.ts's tests as they stand.
//
// A status question is a prompt through Claude Code's UserPromptSubmit entry, run by the stand-in. "Answered from the
// record with no model call" is the reply blocking the prompt with the answer as its reason, so the prompt never
// reaches the model, and the stand-in's hook log holding no model line for it (README: Defined here, a status answer).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC2, AC4, AC6, allEvents, answerOf, begin, Claude, cleanup, deep, edits, firedShown, hubWithSetup, inboxRead, makeHome, modelCalled, newSession, parseObject, payload, promptEntry, rootOf, shown, sleep, startHub, STATE_WORDS, stop, stopHub, waitFor,
  type Hub, type Home, type Line, type Origin, type Session,
} from '../helpers.ts';

afterAll(cleanup, 60_000);

const QUESTIONS =['still going?', 'all done?', "what's next?", 'anything for me?'];
const TIME = /\b(?:\d+\s?(?:s|m|h|d|sec|secs|min|mins|hour|hours|day|days)|\d+:\d\d)\b/;
const NEEDS_YOU = /needs you\D{0,4}(\d+)|(\d+)\D{0,4}needs? you/i;
const needsYouCount = (answer: string): number | undefined => { const m = NEEDS_YOU.exec(answer); return m ? Number(m[1] ?? m[2]) : undefined; };

/** A session that did work and stopped: its stop was judged, so the record holds its state. */
async function worked(h: Home, hub: Hub): Promise<{ s: Session; claude: Claude }> {
  const s = newSession(h);
  const claude = await begin(h, s);
  await edits(claude, s);
  const fired = await stop(claude, s);
  if (fired.blocked) throw Error(`the stop was sent back (unexpected here): ${firedShown(fired)}`);
  void hub;
  return { s, claude };
}
/** A prompt of the given origin, then its UserPromptSubmit through the stand-in. */
async function ask(claude: Claude, s: Session, text: string, origin: Origin | 'unknown'): Promise<ReturnType<Claude['hook']>> {
  if (origin === 'unknown') s.prompt = `unplaced-${Date.now()}`;
  else promptEntry(s, text, origin);
  return claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
}
/** Your own settings: the home's ~/.deepbuild/config.json, which `deep setup` drafts. */
const configFile = (h: Home) => join(rootOf(h), 'config.json');
const readConfig = (h: Home): Line => JSON.parse(readFileSync(configFile(h), 'utf8')) as Line;
/**
 * A hub under settings with no `asks.batch`, so every ask shows when it's raised (#319): `deep setup` drafts the
 * settings against a first hub, the test takes `asks.batch` out as you would, and a second hub starts on them.
 */
async function hubWithoutBatches(h: Home): Promise<Hub> {
  await stopHub(await hubWithSetup(h));
  const config = readConfig(h);
  delete config.asks?.batch;
  writeFileSync(configFile(h), `${JSON.stringify(config, null, 2)}\n`);
  return startHub(h);
}
/** The rows Needs you shows, as `deep inbox --json` lists them: one per ask shown. */
async function needsYouRows(h: Home): Promise<Line[]> {
  const r = await deep(h, ['inbox', '--json']);
  const rows: unknown = r.code === 0 ? parseObject(r.stdout.trim())?.rows : undefined;
  if (!Array.isArray(rows)) throw Error(`BLOCKED: deep inbox --json must exit 0 and print the rows Needs you shows: ${shown(r)}`);
  return rows as Line[];
}
/** The ask's row in the hub's inbox projection (inbox.read: its status and outcome, #319). */
const inboxRow = async (hub: Hub, a: Asked): Promise<Line | undefined> => (await inboxRead(hub)).find((r) => r.ask === a.handle);
interface Asked { claude: Claude; question: string; handle: string }
/** One open ask, from a second session that asked through deep_ask and left it open. */
async function openAsk(h: Home, hub: Hub): Promise<Asked> {
  const s = newSession(h);
  const claude = await begin(h, s, 'Pick a header colour.');
  const question = `Which header colour for ${Date.now()}?`;
  // deep_ask waits before it says "still waiting"; the ask is filed at once. Its reply isn't waited for here.
  void claude.deepTool(s, 'deep_ask', { kind: 'choice', question, options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }], recommended: 'blue', steps: null, where: null, why: null, check: null }, 180_000).catch(() => undefined);
  const filed = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed`);
  return { claude, question, handle: `ask:${filed.id}` };
}
/** Batches fall at the whole multiples of `every` since the Unix epoch (tests/acceptance/319/README.md: Settings). */
const HOUR = 3_600_000;
const untilBatch = (everyMs: number) => everyMs - (Date.now() % everyMs);

describe(`${AC2} A status question returns the state, time in state, next step and the Needs-you count with no model call`, () => {
  it(`${AC2} each of "${QUESTIONS.join('", "')}" typed after a judged stop is answered from the record: the reply blocks the prompt with the answer, naming a state, a time, the next step and the Needs-you count, and the hook log shows no model call; a prompt that isn't a status question reaches the model`, async () => {
    const h = makeHome();
    // No asks.batch in your settings: every ask shows when it's raised (#319), so this one is in Needs you.
    const hub = await hubWithoutBatches(h);
    const asked = await openAsk(h, hub);
    const { s, claude } = await worked(h, hub);
    const row = await waitFor(async () => { const r = await inboxRow(hub, asked); return r?.status === 'shown' ? r : undefined; }, 30_000, `with no asks.batch in your settings, ${asked.handle} ("${asked.question}") reads shown in the inbox (inbox.read)`);
    expect(row.outcome, `${asked.handle} is open`).toBe('unanswered');
    const open = await needsYouRows(h);
    expect(open.map((r) => r.id), `Needs you shows ${asked.handle}, the ask that has shown (deep inbox lists its row)`).toContain(asked.handle);
    expect(open.length, 'one ask is shown in Needs you (the Needs-you count)').toBeGreaterThan(0);
    for (const q of QUESTIONS) {
      const fired = await ask(claude, s, q, 'person');
      const answer = answerOf(fired);
      expect(answer, `"${q}" is answered from the record (the UserPromptSubmit reply blocks the prompt with the answer as its reason): ${firedShown(fired)}`).toBeDefined();
      expect(modelCalled(h, s, q), `"${q}" never reached the model (no model line in the hook log for it)`).toBe(false);
      expect(STATE_WORDS.some((w) => answer!.includes(w)), `the answer names the session's state with one of the design's words (${STATE_WORDS.join(', ')}): ${JSON.stringify(answer)}`).toBe(true);
      expect(answer, `the answer says how long the session has been in that state: ${JSON.stringify(answer)}`).toMatch(TIME);
      expect(answer, `the answer names the next step: ${JSON.stringify(answer)}`).toMatch(/\bnext\b/i);
      expect(needsYouCount(answer!), `the answer carries the Needs-you count, ${open.length} (the asks Needs you shows, as deep inbox lists them; ${asked.handle} has shown, so it is counted): ${JSON.stringify(answer)}`).toBe(open.length);
    }
    const work = 'Now add a test for total.ts.';
    const fired = await ask(claude, s, work, 'person');
    expect(answerOf(fired), `a prompt that asks for work isn't answered from the record: ${firedShown(fired)}`).toBeUndefined();
    expect(modelCalled(h, s, work), 'it reaches the model').toBe(true);
    await claude.end();
    await asked.claude.end();
  }, 240_000);

  it(`${AC2} an ask still waiting for its batch isn't counted: under the settings deep setup drafts (batches 8 hours apart), an ask raised between batches is open but not shown in Needs you, deep inbox lists no row for it, and each status question's answer carries the Needs-you count deep inbox shows, without it`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const batch = readConfig(h).asks?.batch as Line | undefined;
    expect(batch?.every, `deep setup drafts batches 8 hours apart (asks.batch.every in ~/.deepbuild/config.json): ${JSON.stringify(batch)}`).toBe('8h');
    expect(typeof batch?.cap, `deep setup drafts the daily cap (asks.batch.cap, a number): ${JSON.stringify(batch)}`).toBe('number');
    // Raised well before the next batch, so no batch falls inside this test: one closer than 4 minutes passes first.
    if (untilBatch(8 * HOUR) < 4 * 60_000) await sleep(untilBatch(8 * HOUR) + 5_000);
    const asked = await openAsk(h, hub);
    const { s, claude } = await worked(h, hub);
    // The ask is open and waits for its batch: a choice's deadline is 2 days off (setup's draft), past the next batch.
    const row = await inboxRow(hub, asked);
    expect(row, `the inbox (inbox.read) holds ${asked.handle} ("${asked.question}")`).toBeDefined();
    expect(row!.outcome, `${asked.handle} is open: ${JSON.stringify(row)}`).toBe('unanswered');
    expect(row!.status, `${asked.handle} waits for its batch (queued, not shown): ${JSON.stringify(row)}`).toBe('queued');
    const rows = await needsYouRows(h);
    expect(rows.map((r) => r.id), `Needs you shows no row for ${asked.handle}, which still waits for its batch (deep inbox --json lists the rows shown)`).not.toContain(asked.handle);
    const listed = await deep(h, ['inbox']);
    expect(listed.code, `deep inbox exits 0: ${shown(listed)}`).toBe(0);
    expect(listed.stdout, `deep inbox doesn't list the waiting ask's question: ${shown(listed)}`).not.toContain(asked.question);
    expect(rows.length, `nothing else was raised in this home, so Needs you shows no ask: ${JSON.stringify(rows.map((r) => r.id))}`).toBe(0);
    for (const q of QUESTIONS) {
      const fired = await ask(claude, s, q, 'person');
      const answer = answerOf(fired);
      expect(answer, `"${q}" is answered from the record (the UserPromptSubmit reply blocks the prompt with the answer as its reason): ${firedShown(fired)}`).toBeDefined();
      expect(modelCalled(h, s, q), `"${q}" never reached the model (no model line in the hook log for it)`).toBe(false);
      expect(needsYouCount(answer!), `the answer to "${q}" carries the Needs-you count, ${rows.length} (the asks Needs you shows; ${asked.handle} still waits for its batch, so it isn't counted): ${JSON.stringify(answer)}`).toBe(rows.length);
    }
    // It was still waiting when the answers were given: no batch passed, and nothing showed or closed it meanwhile.
    const after = await inboxRow(hub, asked);
    expect(after?.status, `${asked.handle} still waits for its batch after the answers: ${JSON.stringify(after)}`).toBe('queued');
    await claude.end();
    await asked.claude.end();
  }, 600_000);
});

describe(`${AC4} Only a prompt a person typed is answered from the record; one from a scheduled task, a subagent's report or another session reaches the model unchanged`, () => {
  const origins: { origin: Origin | 'unknown'; what: string }[] = [
    { origin: 'scheduled', what: 'a scheduled task' },
    { origin: 'subagent', what: "a subagent's report" },
    { origin: 'session', what: 'another session' },
    { origin: 'unknown', what: 'a prompt the adapter can\'t place' },
  ];
  it(`${AC4} "still going?" from ${origins.map((o) => o.what).join(', ')} reaches the model unchanged (no block, a model call in the hook log); the same words a person typed are answered from the record`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const { s, claude } = await worked(h, hub);
    for (const { origin, what } of origins) {
      const q = `still going? (${origin})`;
      const fired = await ask(claude, s, q, origin);
      expect(answerOf(fired), `"${q}" from ${what} isn't answered from the record: ${firedShown(fired)}`).toBeUndefined();
      expect(modelCalled(h, s, q), `"${q}" from ${what} reaches the model`).toBe(true);
    }
    const typed = 'still going? (person)';
    const fired = await ask(claude, s, typed, 'person');
    expect(answerOf(fired), `the same words a person typed are answered from the record: ${firedShown(fired)}`).toBeDefined();
    expect(modelCalled(h, s, typed), 'and never reach the model').toBe(false);
    await claude.end();
  }, 240_000);

  it(`${AC4} (wrong program) a hub that reads an unplaced prompt as a person's (DEEP_HUB_PLANT=unplaced-is-person) answers a status question nobody typed from the record, and fails this check naming the prompt`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h, { plant: 'unplaced-is-person' });
    const { s, claude } = await worked(h, hub);
    const q = 'all done? (unplaced)';
    const fired = await ask(claude, s, q, 'unknown');
    // The planted hub answers it; the criterion's check fails on that, naming the prompt.
    let failure: string | null = null;
    try {
      expect(answerOf(fired), `"${q}" from a prompt the adapter can't place isn't answered from the record: ${firedShown(fired)}`).toBeUndefined();
    } catch (error) { failure = (error as Error).message; }
    expect(failure, 'the planted hub must fail the unplaced-prompt check').not.toBeNull();
    expect(failure, 'the failure names the prompt').toContain(q);
    await claude.end();
  }, 180_000);
});

describe(`${AC6} Where the work is, which session holds it, how to resume it and its link are answered from the record`, () => {
  it(`${AC6} "what's next?" typed into the session that holds the work is answered from the record with the worktree the work is in, the session that holds it, a resume command naming that session, and its link`, async () => {
    const h = makeHome();
    const hub = await hubWithSetup(h);
    const { s: holder, claude: holding } = await worked(h, hub);
    // The question comes from the session that holds the work itself: its answer names where that work is.
    const q = "what's next?";
    const fired = await ask(holding, holder, q, 'person');
    const answer = answerOf(fired);
    expect(answer, `the question is answered from the record: ${firedShown(fired)}`).toBeDefined();
    expect(answer, `the answer says where the work is (the worktree ${holder.cwd}): ${JSON.stringify(answer)}`).toContain(holder.cwd);
    expect(answer, `the answer names the session that holds it (${holder.id}, or its first 8 characters): ${JSON.stringify(answer)}`).toContain(holder.id.slice(0, 8));
    expect(answer, 'the answer says how to resume it').toMatch(/\bresume\b/i);
    const resume = /\bresume\b[^\n]*/i.exec(answer!)?.[0] ?? '';
    expect(resume, `the resume command names the session: ${JSON.stringify(resume)}`).toContain(holder.id.slice(0, 8));
    expect(answer, 'the answer carries the session\'s link').toMatch(/\b[a-z][a-z0-9+.-]*:\/\/\S+/);
    expect(modelCalled(h, holder, q), 'the answer came with no model call').toBe(false);
    await holding.end();
  }, 180_000);
});

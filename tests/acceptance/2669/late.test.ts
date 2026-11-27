import { afterAll, describe, expect, it } from 'vitest';
import {
  answerOf, begin, Claude, cleanup, edits, firedShown, hubWithSetup, makeHome, modelCalled, newSession, payload, promptEntry, readLines, stop, waitFor,
  type Home, type Hub, type Session,
} from '../83/helpers.ts';
import { firedCarries, landed, LATE, noticeReached, ONCE, promptBeforeEntry, reachedShown } from './helpers.ts';

afterAll(cleanup, 60_000);

const FIRST = 'Fix the cart total, then stop.';
const WORK = 'Now add a test for total.ts.';

async function typed(claude: Claude, s: Session, text: string) {
  promptEntry(s, text, 'person');
  return claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
}

async function lateRun(): Promise<{ h: Home; hub: Hub; s: Session; claude: Claude }> {
  const h = makeHome();
  const hub = await hubWithSetup(h);
  const s = newSession(h);
  const claude = Claude.start(h);
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  const { fired, writeEntry } = await promptBeforeEntry(claude, s, FIRST);
  expect(firedCarries(fired), `the run's precondition: "${FIRST}"'s reply went before its task landed, so it carries no workspace notice: ${firedShown(fired)}`).toBe(false);
  writeEntry();
  await claude.initialize();
  await edits(claude, s);
  await waitFor(() => landed(hub, s), 60_000, `the record to show the workspace "${FIRST}"'s task landed in`);
  await stop(claude, s);
  return { h, hub, s, claude };
}

describe(`${LATE} A status question after a session outside any repo opened its first task is answered from the record, however late the task lands`, () => {
  it(`${LATE} a session outside any repo whose first task lands after its first prompt's reply: "still going?" typed as the next prompt is answered from the record (the reply blocks it with the answer) and the hook log shows no model call for it`, async () => {
    const { h, s, claude } = await lateRun();
    const q = 'still going?';
    const fired = await typed(claude, s, q);
    expect(answerOf(fired), `"${q}", typed as the next prompt after the session's first task landed late, is answered from the record (the UserPromptSubmit reply blocks the prompt with the answer as its reason): ${firedShown(fired)}`).toBeDefined();
    expect(modelCalled(h, s, q), `"${q}" reaches no model (no model line in the hook log for it)`).toBe(false);
    await claude.end();
  }, 240_000);
});

describe(`${ONCE} The workspace notice still reaches the agent once, at the first prompt or at the next prompt that goes to the model`, () => {
  it(`${ONCE} first task landing late: across "${FIRST}", "still going?" and "${WORK}", the workspace notice reaches the agent exactly once, at the next prompt that goes to the model`, async () => {
    const { h, s, claude } = await lateRun();
    await typed(claude, s, 'still going?');
    const fired = await typed(claude, s, WORK);
    expect(fired.model, `"${WORK}" reaches the model: ${firedShown(fired)}`).toBe(true);
    const reached = noticeReached(h, s);
    expect(reached.length, `the workspace notice reaches the agent exactly once (not zero, not twice): ${reachedShown(reached)}`).toBe(1);
    const models = readLines(h.hookLog).filter((l) => l.phase === 'model' && l.session === s.id).map((l) => String(l.prompt));
    const next = models.find((p) => p !== FIRST);
    expect(reached[0]!.event, `the notice came with a prompt: ${reachedShown(reached)}`).toBe('UserPromptSubmit');
    expect([FIRST, next], `the notice came with "${FIRST}" or with the next prompt that went to the model (${JSON.stringify(next)}): ${reachedShown(reached)}`).toContain(reached[0]!.prompt);
    await claude.end();
  }, 240_000);

  it(`${ONCE} first task opened as usual (its transcript entry before the hook): across "${FIRST}" and "${WORK}" after the stop, the workspace notice reaches the agent exactly once, with one of those prompts`, async () => {
    const h = makeHome();
    await hubWithSetup(h);
    const s = newSession(h);
    const claude = await begin(h, s, FIRST);
    await edits(claude, s);
    await stop(claude, s);
    const fired = await typed(claude, s, WORK);
    expect(fired.model, `"${WORK}" reaches the model: ${firedShown(fired)}`).toBe(true);
    const reached = noticeReached(h, s);
    expect(reached.length, `the workspace notice reaches the agent exactly once (not zero, not twice): ${reachedShown(reached)}`).toBe(1);
    expect([FIRST, WORK], `the notice came with "${FIRST}" or "${WORK}": ${reachedShown(reached)}`).toContain(reached[0]!.prompt);
    expect(modelCalled(h, s, FIRST), `"${FIRST}" reached the model`).toBe(true);
    await claude.end();
  }, 240_000);
});

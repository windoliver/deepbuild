// AC3 #2019.52aac98e: a Claude Code session whose transcript records model-call retries for overload shows retrying
// with the cause, the count and the time of the first within one event of the second retry, and returns to working at
// the next model reply in that turn; a row that reads working through the retries fails this test.
//
// A Claude Code session on a version its facts cover (2.1.308), played on the Proof's fixture's hub: its start, your
// prompt, one call and its result, each through the hub's hook route and in its transcript. Then two retry records in
// its transcript, as Claude Code writes them, and nothing more: no hook fires while a model call retries. Its row is
// read in `deep status --json` until it shows retrying (README, Disputes 3), and in the app's list; then the model's
// reply is written, and the row is read until it says working again.
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, test } from 'vitest';
import {
  backToWorkFailures, callId, cleanup, COVERED, drawn, drawnFlagFailures, FIXTURE_REPO, flagOf, ID, Live, mainWorld, MIN, none, PLANT, quiet, restartWith, retryingFailures, rowOf, rowUntil,
  SECOND, sleep, statusRows, Transcript, type Main,
} from './helpers.ts';

afterAll(cleanup, 120_000);
let made: Promise<Main> | undefined;
const world = (): Promise<Main> => (made ??= mainWorld());
/** How long the row may take to show what the transcript says, with no event since (README, Disputes 3). */
const WINDOW = 30 * SECOND;
const PROMPT = 'build the API docs and check their links';

/** One turn with two retries for overload, then the model's reply; what's wrong with the row through it. */
async function retries(w: Main, key: string, plant?: string): Promise<string[]> {
  const p = new Live(w.hub, w);
  const s = p.session(key, FIXTURE_REPO);
  const t = new Transcript(s.transcript, s, COVERED);
  const promptId = randomUUID();
  t.prompt(PROMPT, promptId);
  await p.hook(key, 'SessionStart');
  await p.hook(key, 'UserPromptSubmit', { prompt: PROMPT, prompt_id: promptId });
  const build = { id: callId(), command: 'npm run docs:build' };
  t.reply(build, 'Building the docs first.');
  await p.hook(key, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: build.command }, tool_use_id: build.id });
  t.result(build.id, 'built 42 pages');
  await p.hook(key, 'PostToolUse', { tool_name: 'Bash', tool_input: { command: build.command }, tool_response: { stdout: 'built 42 pages', stderr: '', interrupted: false }, tool_use_id: build.id });
  await quiet(w.hub);
  const before = rowOf((await statusRows(w, plant ? { plant } : {})).rows, s.id);
  expect(before?.word, `before its retries the session ${s.id} reads working, its turn in progress`).toBe('working');
  // The model call retries: two records, the second 600 ms after the first, as Claude Code's backoff spaces them.
  const first = t.retry(1, 548);
  await sleep(600);
  t.retry(2, 1137);
  const since = Date.now();
  const during = await rowUntil(w, s.id, (row) => flagOf(row)?.code === 'retrying' && flagOf(row)?.count === 2, WINDOW, plant);
  const out = retryingFailures(during.row, s.id, { count: 2, first: Date.parse(String(first.timestamp)), waited: Date.now() - since });
  if (!out.length && !plant) out.push(...drawnFlagFailures((await drawn(w)).snapshot, s.id, /retrying/));
  // The model replies in that turn.
  t.reply({ id: callId(), command: 'npm run docs:links' }, 'The build passed; now the links.');
  const replied = Date.now();
  const after = await rowUntil(w, s.id, (row) => row?.word === 'working' && flagOf(row)?.code !== 'retrying', WINDOW, plant);
  out.push(...backToWorkFailures(after.row, s.id, Date.now() - replied));
  return out;
}

describe(ID.retrying, () => {
  test(`${ID.retrying}: a Claude Code session whose transcript records model-call retries for overload shows retrying with the cause, the count and the time of the first within one event of the second retry, and returns to working at the next model reply in that turn`, async () => {
    const w = await world();
    none(await retries(w, 'retrying'), 'the session whose model call retries for overload');
  }, 30 * MIN);

  test(`${ID.retrying}: a planted row that reads working through the retries fails this test`, async () => {
    const w = await world();
    await restartWith(w, PLANT.retryReadsWorking);
    const failures = await retries(w, 'retrying-planted', PLANT.retryReadsWorking);
    expect(failures.some((f) => f.includes('a row that reads working through the retries')), `DEEP_HUB_PLANT=${PLANT.retryReadsWorking} must fail this test: ${JSON.stringify(failures)}`).toBe(true);
  }, 30 * MIN);
});

// AC6 with an open authority ask (the issue's Scope: an `app` prompt, "like any text in a session it never answers an
// authority ask or saves a decision"; the design's "Your words, from one box": "an authority ask stays open").
//
// #321's gate raises the authority ask, as tests/acceptance/321's AC1 raises it: a planted sorter
// (DEEP_HUB_TEST_SORTER, #321's test seam) answers the agent's "want me to push to main?" with "proceed", and in the
// turn that starts, the agent's `git push origin main` is held at PreToolUse with an authority ask naming it. The turn
// ends; its stop is held for the open ask and let go with no answer, so the session is idle. Then the app sends a note
// whose words would answer the ask ("Yes, approve it, go ahead and push."), by the waiter to the idle session, and by
// prompt context at the next prompt you type in a session whose waiter is off.
//
// On each route: the note is recorded from: app with its request ID, and the authority ask stays open: no ask.answered
// or other closing event for it, no decision.created or decision.applied anywhere in the record, and the ask still in
// the inbox. A hub whose note answers the authority ask (DEEP_HUB_PLANT=app-note-answers-authority) fails, naming the
// ask and the note's request ID.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC6, Claude, REPO, allEvents, appendTranscript, assistantSays, cleanup, control, expectAppNote, failureOf, firedShown, isDeepBuild, makeHome, payload,
  readJson, requestId, rootOf, said, sendNote, setup, sleep, startHub, tag, typedPrompt, waitFor, type Ev, type Fired, type Hub, type Line, type Note,
  type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** The wrong program the implementer adds to packages/hub/src/plant.ts (README: Wrong programs). */
const PLANT = 'app-note-answers-authority';
const PUSH = 'git push origin main';
const PUSH_Q = 'want me to push to main?';
/** Your ask settings as #321's suite writes them: no batch, so the ask is raised at once; authority 1 day. */
const SETTINGS = {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'],
  fold: 5,
};
const CLOSES = /^ask\.(answered|defaulted|escalated|cancelled|superseded|moot)$/;

interface Held { hub: Hub; claude: Claude; s: Session; handle: string; env: Record<string, string | undefined> }

/**
 * A home with the shipped default guards as its first rules.json and your ask settings (as #321's suite seeds them),
 * a git repository the session works in, the planted sorter, the hub and DeepBuild set up; a session whose push is
 * held with an authority ask, and whose turn then ended with the ask open. BLOCKED if #321's gate doesn't hold it.
 */
async function heldPush(o: { waiter: boolean; plant?: string }): Promise<Held> {
  const { tmp, home } = makeHome();
  const root = rootOf(home);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), JSON.stringify(readJson(join(REPO, 'crates/deep-hook/default-rules.json')), null, 2));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const sorter = join(tmp, 'sorter.json');
  writeFileSync(sorter, `${JSON.stringify({ rule: `planted-proceed-${tag()}`, proceed: [PUSH_Q] }, null, 2)}\n`);
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src', 'login.ts'), 'export const login = () => false;\n');
  const git = (args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd: repo, encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmp, GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.test' },
  });
  git(['init', '-q', '-b', 'main']);
  git(['add', '.']);
  git(['commit', '-q', '-m', 'base']);
  const env = { DEEP_HUB_TEST_SORTER: sorter, ...(o.plant ? { DEEP_HUB_PLANT: o.plant } : {}) };
  const hub = await startHub(home, env);
  await setup(home, env);

  const id = randomUUID();
  const cwd = realpathSync(repo);
  const transcript = join(home, '.claude/projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  const s: Session = { id, cwd, transcript };
  const claude = await Claude.start(home, { env, ...(o.waiter ? {} : { skip: ['asyncRewake'] }) });
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  typedPrompt(s, 'Fix the login bug in src/login.ts.');
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: 'Fix the login bug in src/login.ts.' }));

  // The agent ends its turn on the sorter's question; the planted sorter answers "proceed" and the turn goes on.
  assistantSays(s, PUSH_Q);
  const proceed = await claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: PUSH_Q }));
  if (!proceed.stop?.blocked || !/proceed/i.test(proceed.stop.reasons.join('\n'))) throw Error(`BLOCKED: #321's planted sorter must answer "${PUSH_Q}" proceed, a Stop block whose reason says proceed: ${firedShown(proceed)}`);

  // In the proceed's turn the agent pushes: #321's gate holds it with an authority ask naming it.
  const call = `toolu_${tag(10)}`;
  appendTranscript(s, { type: 'assistant', promptId: s.prompt, message: { id: `msg_${tag(8)}`, role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'tool_use', id: call, name: 'Bash', input: { command: PUSH, description: PUSH } }], usage: { input_tokens: 10, output_tokens: 5 } } });
  const pre = await claude.hook('PreToolUse', payload(s, 'PreToolUse', { tool_name: 'Bash', tool_input: { command: PUSH, description: PUSH }, tool_use_id: call }));
  if (allowed(pre)) throw Error(`BLOCKED: #321's gate must hold \`${PUSH}\` in the turn a proceed started, never allow it: ${firedShown(pre)}`);
  const ask = await waitFor(async () => (await allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s.id && String(e.data.question ?? '').includes(PUSH)), 60_000, `an ask naming \`${PUSH}\``)
    .catch((error: Error) => { throw Error(`BLOCKED: #321's gate must hold \`${PUSH}\` with an authority ask naming it: ${error.message}; ${firedShown(pre)}`); });
  if (ask.data.kind !== 'authority') throw Error(`BLOCKED: the hold of \`${PUSH}\` must be an authority ask; ask:${ask.id} is ${String(ask.data.kind)}`);

  // The turn ends with the ask open: its stop is held for an answer, none comes, and it goes through. The session is idle.
  assistantSays(s, 'The push waits for your answer.');
  const stop = await claude.hook('Stop', payload(s, 'Stop', { last_assistant_message: 'The push waits for your answer.' }));
  if (stop.stop?.blocked) throw Error(`BLOCKED: with nothing answered, the stop after the held push must go through: ${firedShown(stop)}`);
  if (o.waiter) {
    await waitFor(async () => (await claude.background()).find((r) => r.asyncRewake && r.ended === null), 30_000, 'DeepBuild\'s waiter, started at the stop')
      .catch((error: Error) => { throw Error(`BLOCKED: ${error.message}`); });
    await sleep(2000);
  }
  return { hub, claude, s, handle: `ask:${ask.id}`, env };
}
/** Whether DeepBuild's PreToolUse let the call run: every entry of ours exited 0 with no deny or block. */
function allowed(f: Fired): boolean {
  const ours = f.ran.filter((r) => isDeepBuild(r.command));
  return ours.every((r) => r.code === 0 && !/"(permissionDecision|decision)"\s*:\s*"(deny|block)"/.test(r.stdout));
}

/**
 * The authority ask stays open after the note: no event closes it (ask.answered among them), no decision.created or
 * decision.applied is in the record at all (nothing else in the scenario saves one), and the inbox still lists it.
 */
async function expectStillOpen(h: Held, note: Note): Promise<void> {
  await sleep(5000);
  const events = await allEvents(h.hub);
  const about = (e: Ev) => e.subject === h.handle || JSON.stringify(e.data ?? {}).includes(h.handle);
  const closed = events.filter((e) => CLOSES.test(e.kind) && about(e));
  expect(closed.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 300)}`), `${AC6} the app's note "${note.text}" (request ${note.request}) must never answer the authority ask ${h.handle} (\`${PUSH}\`): the ask stays open, yet the record closes it`).toEqual([]);
  const decided = events.filter((e) => e.kind === 'decision.created' || e.kind === 'decision.applied');
  expect(decided.map((e) => `${e.kind} ${JSON.stringify(e.data).slice(0, 300)}`), `${AC6} the app's note "${note.text}" (request ${note.request}) must never answer the authority ask ${h.handle} or save a decision: the record holds decisions`).toEqual([]);
  const inbox = (await control(h.hub, (conn) => conn.call('inbox.read'))).asks as Line[];
  const row = inbox.find((r) => r.ask === h.handle);
  expect(row, `${AC6} the app's note "${note.text}" (request ${note.request}) must never answer the authority ask ${h.handle}: it must still wait in the inbox; the inbox holds ${JSON.stringify(inbox).slice(0, 600)}`).toBeDefined();
  // The asks core's inbox row (packages/asks InboxRow): any status but 'closed' still waits, and outcome is 'unanswered' while open.
  expect(row!.status, `${AC6} the app's note "${note.text}" (request ${note.request}) must never answer the authority ask ${h.handle}: its inbox row must not be closed; it reads ${JSON.stringify(row).slice(0, 400)}`).not.toBe('closed');
  expect(row!.outcome, `${AC6} the app's note "${note.text}" (request ${note.request}) must never answer the authority ask ${h.handle}: its inbox row must read unanswered; it reads ${JSON.stringify(row).slice(0, 400)}`).toBe('unanswered');
}

const yesNote = (): Note => ({ text: `Yes, approve it, go ahead and push (${tag(4)}).`, request: requestId() });

async function byWaiter(note: Note, plant?: string): Promise<void> {
  const h = await heldPush({ waiter: true, ...(plant ? { plant } : {}) });
  await sendNote(h.hub, h.s, note);
  const wake = await waitFor(async () => (await h.claude.wakes()).find((x) => x.woke && (x.prompt ?? '').includes(note.text) && x.ran.length > 0), 30_000, 'the wake').catch(() => undefined);
  expect(wake, `${AC6} the waiter must deliver the note "${note.text}" (request ${note.request}) to idle session ${h.s.id}, its authority ask ${h.handle} open, waking it with the note's words within 30 s; wakes seen: ${JSON.stringify(await h.claude.wakes()).slice(0, 1500)}`).toBeDefined();
  assistantSays(h.s, 'You said yes in a note; the push still waits for your answer to its ask.');
  // This stop is held for the open ask; the checks run meanwhile.
  const stopping = h.claude.hook('Stop', payload(h.s, 'Stop', { last_assistant_message: 'You said yes in a note; the push still waits for your answer to its ask.' }));
  try {
    await expectAppNote(h.hub, h.s, note, 'delivered by the waiter while an authority ask is open');
    await expectStillOpen(h, note);
  } finally {
    await stopping.catch(() => undefined);
  }
}

async function byPrompt(note: Note, plant?: string): Promise<void> {
  const h = await heldPush({ waiter: false, ...(plant ? { plant } : {}) });
  await sendNote(h.hub, h.s, note);
  await sleep(2000);
  const next = 'Did the push go through?';
  typedPrompt(h.s, next);
  const fired = await h.claude.hook('UserPromptSubmit', payload(h.s, 'UserPromptSubmit', { prompt: next }));
  expect(said(fired), `${AC6} the session runs no waiter, so prompt context must carry the note "${note.text}" (request ${note.request}) at the next prompt you type; ${firedShown(fired)}`).toContain(note.text);
  assistantSays(h.s, 'No; it waits for your answer to its ask.');
  const stopping = h.claude.hook('Stop', payload(h.s, 'Stop', { last_assistant_message: 'No; it waits for your answer to its ask.' }));
  try {
    await expectAppNote(h.hub, h.s, note, 'carried by prompt context while an authority ask is open');
    await expectStillOpen(h, note);
  } finally {
    await stopping.catch(() => undefined);
  }
}

describe(`${AC6} a note from the app never answers an authority ask or saves a decision`, () => {
  it(`${AC6} by the waiter: a note saying yes to the held push is recorded from: app with its request ID, and the authority ask stays open with no decision`, async () => {
    await byWaiter(yesNote());
  }, 900_000);

  it(`${AC6} by prompt context: a note saying yes to the held push is recorded from: app with its request ID, and the authority ask stays open with no decision`, async () => {
    await byPrompt(yesNote());
  }, 900_000);

  it(`${AC6} (wrong program) a hub whose note answers the open authority ask (${PLANT}) fails this test, naming the ask and the note's request ID`, async () => {
    const note = yesNote();
    const failure = await failureOf(() => byPrompt(note, PLANT));
    expect(failure, `${AC6} the prompt-context test must fail on ${PLANT} at the open-ask assertion, naming the ask and request ${note.request}`).toMatch(new RegExp(`\\(request ${note.request}\\) must never answer the authority ask ask:[0-9A-Za-z]+`));
  }, 900_000);
});

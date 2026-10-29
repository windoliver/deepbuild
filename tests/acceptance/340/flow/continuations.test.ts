// #340 AC3: Codex goal continuations, heartbeats and the desktop app's resume prompt are recorded as automatic
// continuations, `from: continuation`, never as your asks. Each asks for a change in its words, so only its origin
// keeps it from opening a task, and each session carries a prompt you typed that opens one, so a kernel that opens
// nothing fails too.
//
// - The Claude desktop app (the corpus's 2.1.299 desktop-resume session): you ask for a change, and the app is quit in
//   the middle of a call (PreToolUse with no PostToolUse, SessionEnd `other`). Reopened, the app enqueues its resume
//   prompt and dequeues it a few ms later; the session resumes (SessionStart `resume`, the same session ID and
//   process), its transcript gains the app's "No response requested." and the prompt's entry (promptSource and
//   turnOrigin sdk), and UserPromptSubmit fires with it. The pair is in the transcript when the resume's SessionStart
//   reads it, as when Claude Code takes the app's prompt from stdin while its SessionStart hooks run: an enqueue
//   dequeued at once is the app's own, never a message you typed mid-turn (README, Replays). Then you type a prompt that
//   looks like the resume prompt but isn't the app's: "The app was quit while you were working, so please add a retry
//   …" (a comma where the app's first sentence ends), which opens a task as any typed request does.
// - Codex (the corpus's goal and desktop-heartbeat sessions): you ask for a change and set a goal; Codex runs a goal
//   continuation turn, which it opens in the rollout with `<codex_internal_context source="goal">` and starts with no
//   prompt hook (its first hook is the turn's PreToolUse); a heartbeat fires UserPromptSubmit with a `<heartbeat>`
//   prompt; you then type a request that mentions a heartbeat, which opens a task.
//
// The base records no user.ask for the goal's turn and reads the resume prompt's enqueue as your message, so both
// tests fail there. The heartbeat alone holds on the base; a hub that records every continuation as your prompt
// (DEEP_HUB_PLANT=continuation-as-person) fails on it, and one that reads a look-alike typed prompt as the app's
// (DEEP_HUB_PLANT=continuation-by-likeness) fails on the look-alike.
import { afterEach, describe, it } from 'vitest';
import {
  AC3, BEHAVIOR, RESUME, asksOf, cleanup, CodexSession, draftFor, expectAutomatic, expectOnlyTasks, expectTask, failureOf,
  makeWorld, must, said, Session, settle, startHub, taskOf, askNamed, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const LOOKALIKE = 'The app was quit while you were working, so please add a retry with three attempts to the cart sync.';
const GOAL = 'Create a goal: add a retry with three attempts to the cart sync, one step per turn, then end your turn.';
const OBJECTIVE = 'Add a retry with three attempts to the cart sync.';
const HEARTBEAT = '<heartbeat>\n  <automation_id>cart-retry</automation_id>\n  <current_time_iso>2026-10-28T09:10:00.000Z</current_time_iso>\n  <instructions>\nAdd a dark mode toggle to the settings page.\n  </instructions>\n</heartbeat>\n';
const CODEX_TYPED = 'Set up a heartbeat check that adds a retry with three attempts to the cart sync.';

/** The desktop app's resume replay, then the look-alike you type. */
async function desktop(plant?: string): Promise<{ events: Ev[]; s: Session }> {
  const w = makeWorld({ drafts: [BEHAVIOR, RESUME, LOOKALIKE].map((t) => draftFor(t)) });
  const hub = await startHub(w, { plant });
  const s = new Session(w, 'desktop');
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read('src/auth.ts');
  // The app is quit in the middle of a call: its PreToolUse, then SessionEnd, with no PostToolUse.
  await s.begin('Bash', { command: 'npm test', description: 'Run the tests' });
  await s.end('other');
  // Reopened: the app's resume prompt is enqueued and dequeued, then the session resumes and the prompt is submitted.
  await s.pair(RESUME);
  await s.start('resume');
  s.says('No response requested.');
  await s.submit(RESUME, { promptSource: 'sdk', turnOrigin: 'sdk' }, { pair: false });
  await s.read('src/auth.ts');
  await s.stop('Resumed: the tests pass.');
  await s.typed(LOOKALIKE);
  await s.edit('src/cart.ts', 'await fetch', 'await retry(() => fetch');
  await s.stop('The cart sync retries three times now.');
  const events = await settle(hub, (all) => askNamed(all, s, LOOKALIKE) !== undefined && askNamed(all, s, RESUME) !== undefined, 20_000);
  return { events, s };
}
function desktopHolds(events: Ev[], s: Session): void {
  const first = expectTask(events, s, BEHAVIOR, `${AC3} [your first prompt]`);
  expectAutomatic(events, s, RESUME, 'continuation', AC3, 'the desktop app\'s resume prompt, with its queue pair');
  const lookalike = expectTask(events, s, LOOKALIKE, `${AC3} [your typed look-alike of the resume prompt]`);
  expectOnlyTasks(events, s, [first, lookalike], AC3);
}

/** Codex: your goal prompt, a goal continuation turn with no prompt hook, a heartbeat, then a prompt you type. */
async function codex(plant?: string): Promise<{ events: Ev[]; s: CodexSession; goalTurn: string; afterFirstStop: number }> {
  const w = makeWorld({ drafts: [GOAL, HEARTBEAT, CODEX_TYPED].map((t) => draftFor(t)) });
  const hub = await startHub(w, { plant });
  const s = new CodexSession(w);
  await s.start();
  await s.prompt(GOAL);
  await s.shell('cat src/cart.ts');
  await s.stop('The goal is set; step one is done.');
  const stopped = await settle(hub, (all) => all.some((e) => e.kind === 'agent.stop' && e.session === s.id), 20_000);
  const afterFirstStop = Math.max(...stopped.filter((e) => e.session === s.id).map((e) => e.log_pos));
  const goalTurn = s.goalTurn(OBJECTIVE);
  await s.shell('cat src/auth.ts');
  await s.stop('Step two is done.');
  await s.prompt(HEARTBEAT, 'heartbeat');
  await s.stop('beat');
  await s.prompt(CODEX_TYPED);
  await s.shell('cat src/cart.ts');
  await s.stop('Done.');
  const events = await settle(hub, (all) => askNamed(all, s, CODEX_TYPED) !== undefined && askNamed(all, s, HEARTBEAT) !== undefined, 20_000);
  return { events, s, goalTurn, afterFirstStop };
}
function heartbeatHolds(events: Ev[], s: CodexSession): void {
  expectAutomatic(events, s, HEARTBEAT, 'continuation', AC3, 'the Codex heartbeat\'s <heartbeat> prompt');
}
function goalHolds(events: Ev[], s: CodexSession, goalTurn: string, afterFirstStop: number): void {
  // The goal's turn fired no prompt hook: its user.ask is the one the session records after your first turn's stop
  // and before the heartbeat's, whatever text it carries.
  const heartbeat = askNamed(events, s, HEARTBEAT);
  const between = asksOf(events, s).filter((e) => e.log_pos > afterFirstStop && (!heartbeat || e.log_pos < heartbeat.log_pos));
  must(between.length === 1, `${AC3} the Codex goal's continuation turn (${goalTurn}), which fires no prompt hook, must be recorded as one user.ask before its first hook's events, from: continuation; between your first turn's stop and the heartbeat the session records ${between.length} user.ask (${between.map(said).join('; ') || 'none'}); all its user.asks: ${asksOf(events, s).map(said).join('; ')}`);
  const ask = between[0]!;
  must(ask.data.from === 'continuation', `${AC3} the Codex goal's continuation turn must be recorded from: continuation, never as your ask: ${said(ask)}`);
  must(Array.isArray(ask.data.tasks) && ask.data.tasks.length === 0, `${AC3} the Codex goal's continuation turn must open no task, tasks: []: ${said(ask)}`);
}
function codexHolds(r: Awaited<ReturnType<typeof codex>>): void {
  const goal = expectTask(r.events, r.s, GOAL, `${AC3} [your Codex prompt that sets the goal]`);
  heartbeatHolds(r.events, r.s);
  goalHolds(r.events, r.s, r.goalTurn, r.afterFirstStop);
  const typed = expectTask(r.events, r.s, CODEX_TYPED, `${AC3} [your typed Codex prompt that mentions a heartbeat]`);
  expectOnlyTasks(r.events, r.s, [goal, typed], AC3);
}

describe(`${AC3} Codex goal continuations, heartbeats and the desktop app's resume prompt are recorded as automatic continuations, from: continuation, never as your asks`, () => {
  it(`${AC3} the Claude desktop app's resume prompt, enqueued and dequeued by the app, is one user.ask from continuation that opens no task; your typed look-alike opens one`, async () => {
    const { events, s } = await desktop();
    desktopHolds(events, s);
  }, 240_000);

  it(`${AC3} a Codex goal's continuation turn and a heartbeat are each one user.ask from continuation that opens no task; your typed Codex prompts open theirs`, async () => {
    codexHolds(await codex());
  }, 240_000);

  it(`${AC3} (wrong program) a hub that records automatic continuations as your prompts (DEEP_HUB_PLANT=continuation-as-person) fails, naming the heartbeat`, async () => {
    const r = await codex('continuation-as-person');
    const failure = await failureOf(() => heartbeatHolds(r.events, r.s));
    must(failure !== null, `${AC3} the planted hub that records continuations as your prompts must fail this test on the heartbeat: it passed`);
    must(failure.includes('<heartbeat>') && failure.includes('from: person'), `${AC3} the planted hub must fail on the heartbeat recorded from person, naming it; it said: ${failure}`);
  }, 240_000);

  it(`${AC3} (wrong program) a hub that reads a typed look-alike as the app's resume prompt (DEEP_HUB_PLANT=continuation-by-likeness) fails, naming the look-alike`, async () => {
    const { events, s } = await desktop('continuation-by-likeness');
    expectAutomatic(events, s, RESUME, 'continuation', AC3, 'the desktop app\'s resume prompt, with its queue pair');
    const failure = await failureOf(() => expectTask(events, s, LOOKALIKE, `${AC3} [your typed look-alike of the resume prompt]`));
    must(failure !== null, `${AC3} the planted hub that reads a look-alike as the app's prompt must fail this test: it passed (${said(askNamed(events, s, LOOKALIKE))}, task ${taskOf(askNamed(events, s, LOOKALIKE))})`);
    must(failure.includes(LOOKALIKE), `${AC3} the planted hub must fail naming the look-alike "${LOOKALIKE}"; it said: ${failure}`);
  }, 240_000);
});

// The journey on the fixture machine, from the download to a first result, judged by criterion. One world walks it
// once (README: The journey): the replica opens as a fresh account with the app's runtime folder; Set up is pressed
// (it installs the agent with the stand-in installer); the box reads ready; a topic is sent; the sign-in row's task
// comes up and its button is pressed; the agent's page comes back with nobody signed in; the person signs in; the card
// comes, is approved, and makes a workspace whose history and going back are used; then the sign-in lapses in the
// middle of a second topic's job and comes back; last, DeepBuild's state folder is swept for the credentials the
// stand-ins showed it. Each test below reads its part; a stage that didn't happen makes the tests after it fail
// naming that stage.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  agentCalls, approve, cards, closedEarly, closeWorlds, closing, CRITERION, credentialHits, deep, events, firstLaunch, hubAnswers, installed,
  installerRuns, installEventFailures, installOnScreen, lapse, MIN, named, openSignIns, openWorld, plainLineFailures, PORTO, pressSetUp,
  pressSignIn, refusedCalls, runtime, said, send, shippedGit, signIn, signInTasks, sleep, TRIP, tripAnswer, waitFor, withinBudget,
  type Card, type Ev, type Line, type SetUp, type World,
} from './helpers.ts';

afterAll(closeWorlds, 5 * MIN);

interface Seen {
  w?: World;
  screenAgent?: string | undefined;
  setup?: SetUp;
  installer?: { runs: number; ms: number };
  hubUp?: boolean;
  sent?: { at: number; since: number; reply: Line };
  task?: Ev | undefined;
  reachedBeforePress?: number;
  pressed?: { at: number; reply: Line; logins: number };
  heldOpen?: { events: Ev[]; reached: number; at: number };
  signedInAt?: number;
  closed?: Ev | undefined;
  card?: Card | undefined;
  reached?: number;
  approved?: { code: number | null; out: string };
  workspace?: { id: string; folder: string };
  history?: string[];
  lapse?: { started: boolean; lapsedAt: number; tasks: Ev[]; open: Ev[]; cardsWhileLapsed: number; restoredAt?: number; closed?: Ev | undefined; card?: Card | undefined; commitsBefore: string[]; commitsAfter?: string[] };
  hits?: string[];
  refused?: string[];
  stopped?: string;
}
let walk: Promise<Seen> | undefined;
/** The journey, walked once; each stage records what it saw, and the first stage that couldn't happen is `stopped`. */
const journey = (): Promise<Seen> => (walk ??= (async () => {
  const s: Seen = {};
  const stop = (why: string): Seen => { s.stopped = why; return s; };
  const w = await openWorld({ runtime: await runtime('plain') });
  s.w = w;
  try {
    // The download, opened: the first screen, then Set up.
    const { d, screen } = await firstLaunch(w);
    s.screenAgent = installOnScreen(screen).agent;
    s.setup = await pressSetUp(d);
    s.installer = installerRuns(w);
    await d.stop();
    if (!s.setup.ready) return stop(`after the Set up press the box never read ready: ${s.setup.failures.join('; ')}`);
    s.hubUp = await hubAnswers(w);
    if (!s.hubUp) return stop('after Set up no hub answers at ~/.deepbuild/hub.sock');

    // A topic, sent before anyone signed in.
    w.model.answer(TRIP, tripAnswer(TRIP));
    s.sent = await send(w, TRIP);
    s.task = await waitFor(async () => signInTasks(await events(w), s.sent!.since)[0], 2 * MIN);
    s.reachedBeforePress = w.model.reached(TRIP).length;
    if (!s.task) return stop(`no sign-in task came up within 2 minutes of the Send (box.say answered ${said(s.sent.reply)})`);

    // The row's button: the agent's own sign-in command starts; its page comes back with nobody signed in.
    const at = Date.now();
    const reply = await pressSignIn(w, `ask:${s.task.id}`);
    await waitFor(() => agentCalls(w).includes('auth login'), 15_000, 250);
    s.pressed = { at, reply: reply as Line, logins: agentCalls(w).filter((c) => c === 'auth login').length };
    await sleep(12_000);
    s.heldOpen = { events: await events(w), reached: w.model.reached(TRIP).length, at: Date.now() };

    // The person signs in, in the agent's own page.
    s.signedInAt = Date.now();
    signIn(w);
    s.closed = await waitFor(async () => closing(await events(w), s.task!), 30_000, 500);
    s.card = await waitFor(async () => cards(await events(w), s.sent!.since)[0], 5 * MIN);
    if (!s.card) return stop('no card came for the topic within 5 minutes of signing in');
    await sleep(10_000);
    s.reached = w.model.reached(TRIP).length;

    // The card approved: a workspace, its history, and going back, all on the shipped git.
    const answered = await approve(w, s.card);
    s.approved = { code: answered.code, out: `${answered.stdout}${answered.stderr}`.slice(-1500) };
    const made = await waitFor(async () => (await events(w)).find((e) => e.kind === 'workspace.created' && e.log_pos > s.sent!.since), 5 * MIN);
    if (!made) return stop(`no workspace.created within 5 minutes of approving ${s.card.ask}: deep inbox answer said ${said(s.approved)}`);
    s.workspace = { id: String(made.data.workspace), folder: String(made.data.folder) };
    s.history = await historyFailures(w, s.workspace);

    // A planted lapse in the middle of a second topic's job.
    w.model.answer(PORTO, tripAnswer(PORTO), 'porto');
    const commitsBefore = commits(w, s.workspace.folder);
    const sentPorto = await send(w, PORTO);
    const started = (await waitFor(() => w.model.reached(PORTO).length > 0, 3 * MIN)) === true;
    const lapsedAt = Date.now();
    lapse(w);
    w.model.open('porto');
    const tasks = (await waitFor(async () => { const t = signInTasks(await events(w), sentPorto.since); return t.length ? t : undefined; }, 2 * MIN)) ?? [];
    await sleep(10_000);
    const now = await events(w);
    s.lapse = { started, lapsedAt, tasks, open: openSignIns(now), cardsWhileLapsed: cards(now, sentPorto.since).length, commitsBefore };
    if (!started) return stop(`the second topic's job never reached the agent within 3 minutes of its Send (box.say answered ${said(sentPorto.reply)})`);
    s.lapse.restoredAt = Date.now();
    signIn(w);
    if (tasks[0]) s.lapse.closed = await waitFor(async () => closing(await events(w), tasks[0]!), 30_000, 500);
    s.lapse.card = await waitFor(async () => cards(await events(w), sentPorto.since)[0], 5 * MIN);
    s.lapse.commitsAfter = commits(w, s.workspace.folder);
  } catch (error) {
    s.stopped ??= error instanceof Error ? error.message : String(error);
  } finally {
    s.refused = refusedCalls(w);
    if (existsSync(w.root)) s.hits = credentialHits(w.root, w.canaries);
  }
  return s;
})());

/** The commits on a workspace's main, newest first, read with the shipped git. */
function commits(w: World, folder: string): string[] {
  const r = shippedGit(w, folder, 'log', '--format=%H', 'refs/heads/main');
  return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : [];
}
/** AC2: the workspace has history, and going back undoes a change, on the shipped git: a day's notes kept, then reverted with `deep workspace revert`. */
async function historyFailures(w: World, ws: { id: string; folder: string }): Promise<string[]> {
  const out: string[] = [];
  if (!existsSync(installed(w, 'git', 'bin', 'git'))) return [`no shipped git at ${installed(w, 'git', 'bin', 'git')}`];
  const before = commits(w, ws.folder);
  if (!before.length) out.push(`the workspace ${ws.folder} has no history on main: git log ${said(shippedGit(w, ws.folder, 'log', '--oneline', '-5'))}`);
  writeFileSync(join(ws.folder, 'day-1.md'), '# Day 1\n\nTram 28 to the castle.\n');
  for (const args of [['add', 'day-1.md'], ['commit', '-q', '-m', 'Day 1']]) {
    const r = shippedGit(w, ws.folder, ...args);
    if (r.code !== 0) return [...out, `the shipped git couldn't keep a change: git ${args.join(' ')} ${said(r)}`];
  }
  const kept = commits(w, ws.folder)[0]!;
  const back = await deep(w, ['workspace', 'revert', ws.id, kept]);
  if (back.code !== 0) return [...out, `deep workspace revert ${ws.id} ${kept} failed: exit ${back.code} ${said(`${back.stdout}${back.stderr}`, 800)}`];
  const after = commits(w, ws.folder);
  if (!after.includes(kept)) out.push(`going back rewrote history: the kept change ${kept} is gone from main`);
  if (after[0] === kept) out.push('going back made no new commit on main');
  if (shippedGit(w, ws.folder, 'cat-file', '-e', 'refs/heads/main:day-1.md').code === 0) out.push('after going back, main still holds day-1.md');
  return out;
}

describe('the journey on the fixture machine', () => {
  it(`${named(1)} ${CRITERION[1]} (the fixture machine's part: from the Set up press to the box with no developer tool run)`, async () => {
    const s = await journey();
    expect(s.setup?.failures ?? [s.stopped], 'after the Set up press the window reaches the box, ready for your words').toEqual([]);
    expect(s.refused, "no call reached the refusing git, xcrun, cc or node: on a clean Mac each is the developer tools prompt or isn't there").toEqual([]);
  }, 180 * MIN);

  it(`${named(2)} ${CRITERION[2]} (a topic makes a workspace with working history and going back)`, async () => {
    const s = await journey();
    if (!s.workspace) throw Error(`the journey made no workspace: ${s.stopped ?? 'it stopped before'}`);
    expect(s.approved?.code, `deep inbox answer for the card: ${said(s.approved)}`).toBe(0);
    expect(s.history, 'the workspace has history on its main, and a kept change goes back with deep workspace revert, on the shipped git').toEqual([]);
    expect(s.refused, 'no call reached the system git or any other refusing stand-in').toEqual([]);
  }, 180 * MIN);

  it(`${named(3)} ${CRITERION[3]}`, async () => {
    const s = await journey();
    if (!s.hits) throw Error(`the journey left no state folder to scan: ${s.stopped}`);
    if (!s.card) throw Error(`the journey stopped before the sign-in and its job, so the scan would see too little: ${s.stopped}`);
    expect(s.hits, 'no file under ~/.deepbuild (record, logs, evidence; the program under versions/ left out) holds a canary the installer, the probe, the sign-in command or the Keychain showed, in any form, or anything credential-shaped').toEqual([]);
    // The scan sees a credential when one is there: the Keychain's token, base64-encoded into a log beside the record.
    const w = s.w!;
    const planted = join(w.tmp, 'planted-scan');
    mkdirSync(join(planted, 'logs'), { recursive: true });
    writeFileSync(join(planted, 'logs', 'hub.log'), `${readFileSync(join(w.root, 'ledger.db'))}\nheader ${Buffer.from(`x:${w.canaries.token}`).toString('base64')}\n`);
    expect(credentialHits(planted, w.canaries).join('\n'), 'the scan names a planted copy of the token, base64-encoded in a log').toContain(join(planted, 'logs', 'hub.log'));
  }, 180 * MIN);

  it(`${named(4)} ${CRITERION[4]}`, async () => {
    const s = await journey();
    const l = s.lapse;
    if (!l) throw Error(`the journey stopped before the lapse: ${s.stopped}`);
    if (!l.started) throw Error(s.stopped ?? 'the second topic\'s job never started');
    const failures: string[] = [];
    if (l.open.length !== 1) failures.push(`while the sign-in lapsed, ${l.open.length} sign-in tasks were open, not one: ${l.open.map((e) => said(e.data.question, 200)).join('; ')}`);
    const task = l.tasks[0];
    if (!task) failures.push('the lapsed sign-in raised no sign-in task within 2 minutes');
    else failures.push(...plainLineFailures(String(task.data.question ?? ''), s.w!.canaries));
    if (l.cardsWhileLapsed) failures.push(`the work went on while nobody was signed in: ${l.cardsWhileLapsed} card(s) for the second topic`);
    if (task && !l.closed) failures.push(`after signing in again the sign-in task ask:${task.id} stayed open for 30 s`);
    if (!l.card) failures.push('the work didn\'t resume: no card for the second topic within 5 minutes of signing in again');
    else if (!JSON.stringify(l.card.brief ?? {}).includes('for four people')) failures.push(`the second topic's card lost your words: ${said(l.card.brief, 600)}`);
    const lost = l.commitsBefore.filter((c) => !(l.commitsAfter ?? []).includes(c));
    if (lost.length) failures.push(`the first workspace lost history across the lapse: ${lost.join(', ')}`);
    expect(failures, 'a lapsed sign-in pauses the work with one plain line, and the work resumes after signing in, with nothing lost').toEqual([]);
  }, 180 * MIN);

  it(`${named(5)} ${CRITERION[5]} (timed on the fixture machine, the stand-in installer's own time left out)`, async (ctx) => {
    const s = await journey();
    if (!s.setup?.ready) throw Error(`the box never read ready after Set up: ${s.stopped}`);
    const ms = s.setup.ended - s.setup.pressed - (s.installer?.ms ?? 0);
    withinBudget(ctx, ms, 2 * MIN, `the app's part, from the Set up press to the box ready for your words, leaving out the installer's ${s.installer?.ms ?? 0} ms`);
  }, 180 * MIN);

  it(`${named(6)} ${CRITERION[6]} (the fixture machine's part: the words typed before sign-in reach the agent once, and only the probe closes the row)`, async () => {
    const s = await journey();
    if (!s.task) throw Error(`no sign-in task: ${s.stopped}`);
    const failures: string[] = [];
    if (s.reachedBeforePress) failures.push(`the words reached the agent ${s.reachedBeforePress} time(s) before anyone signed in`);
    if (s.pressed?.reply.error) failures.push(`the row's button (signin.open) was refused: ${said(s.pressed.reply.error)}`);
    if (s.pressed?.logins !== 1) failures.push(`the row's button started the agent's own sign-in command (claude auth login) ${s.pressed?.logins ?? 0} times, not once`);
    failures.push(...closedEarly(s.heldOpen?.events ?? [], s.task, undefined));
    if (s.heldOpen?.reached) failures.push(`the words reached the agent ${s.heldOpen.reached} time(s) while the probe read not signed in`);
    if (!s.closed) failures.push(`the sign-in task ask:${s.task.id} stayed open for 30 s after the probe read signed in`);
    else if (s.closed.kind !== 'ask.moot' || s.closed.data?.because !== 'signed_in') failures.push(`the sign-in task closed as ${s.closed.kind} ${said(s.closed.data)}, not ask.moot because signed_in`);
    if (s.reached !== 1) failures.push(`the words typed before sign-in reached the agent ${s.reached ?? 0} times, not once (${s.card ? 'the card came' : s.stopped})`);
    expect(failures, 'the words wait for the probe to read signed in, then reach the agent once').toEqual([]);
  }, 180 * MIN);

  it(`${named(8)} ${CRITERION[8]} (the record's half)`, async () => {
    const s = await journey();
    if (!s.hubUp) throw Error(`no hub to read after Set up: ${s.stopped}`);
    expect(s.screenAgent, 'the first screen named the agent Set up installs (setup-step:install:<agent>)').toBe('claude-code');
    expect(installEventFailures(s.screenAgent, await events(s.w!)), 'setup\'s install events name the agent the first screen\'s row named').toEqual([]);
    expect(s.installer?.runs, 'the agent\'s own installer ran once').toBe(1);
  }, 180 * MIN);
});

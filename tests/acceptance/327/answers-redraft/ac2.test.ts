// Blind redraft of #327 AC2 (README): the hub half of "A taste call with options A, B and C, B recommended and drawn
// first, answered by a hardware click on C, records option C in `ask.answered`, and the agent's next input holds C's
// ID and label, with `delivery.outcome` delivered and acknowledged; a card that maps the click to the record's index
// delivers B and fails, naming the option".
//
// One Claude Code session (the stand-in, running DeepBuild's deep-hook entries) stops with the taste call open; the
// hub holds its Stop; the app's paired key answers with the option the card's click picked. The agent's next input is
// read from the session's transcript, where Claude Code writes what a hook's reply gave the agent, and delivered is
// judged against when the transcript showed it: delivered and acknowledged means a turn showed the answer, so an
// outcome recorded delivered while the transcript doesn't show it yet fails. The click's mapping in the app itself is
// card.rs's (../card.rs ac2_…); here the card is the two mappings the criterion names, the right one and the wrong one.
import { afterEach, describe, expect, it } from 'vitest';
import { buildDeepHook } from '../../16/helpers.ts';
import {
  AC2, asApp, cleanup, clickToken, commit, Confirmer, confirmEnv, eventsAbout, installedRoot, makeHome, newDevice, pair, seedInSessions,
  shown, signed, sleep, startHub, tasteAsk, type Obj,
} from '../helpers.ts';
import { assistantSays, Claude, inputs, lineCount, newSession, payload, typed, writeSettings, type Fired, type Input } from './helpers.ts';

afterEach(cleanup, 60_000);

/** How long the stand-in's transcript lags a hook's reply (README: Readings, 3). */
const LAG_MS = 2000;
/** The bound on delivered once the transcript shows the answer (the dispute's ≤ 30 s). */
const DELIVERED_WITHIN_MS = 30_000;

interface Option { id: string; label: string; decision: 'none' }
// IDs that appear in no label, so "holds C's ID" can't be met by C's label alone.
const A: Option = { id: 'a-amber', label: 'A: amber header', decision: 'none' };
const B: Option = { id: 'b-bone', label: 'B: bone header', decision: 'none' };
const C: Option = { id: 'c-cobalt', label: 'C: cobalt header', decision: 'none' };
/** The ask's options in the record's order: B, the recommended one, is last there and drawn first. */
const RECORD: Option[] = [A, C, B];

/** The card's draw order: the recommended option first, then the others in the record's order (card.rs ac2_…). */
const drawn = (record: Option[], recommended: string): Option[] => [record.find((o) => o.id === recommended)!, ...record.filter((o) => o.id !== recommended)];
/** What a card sends for a click on the option drawn at `clicked`. */
type Card = (record: Option[], recommended: string, clicked: number) => string;
const rightCard: Card = (record, recommended, clicked) => drawn(record, recommended)[clicked]!.id;
/** The wrong program the criterion names: the click's drawn position read as the record's index. */
const byRecordIndex: Card = (record, _recommended, clicked) => record[clicked]!.id;

const named = (id: string) => `${id} (${RECORD.find((o) => o.id === id)?.label ?? 'no such option'})`;

async function outcomesOf(app: Awaited<ReturnType<typeof asApp>>, handle: string): Promise<string[]> {
  return (await eventsAbout(app, handle, 'delivery.outcome')).map((e) => String((e.data as Obj).outcome));
}
async function stopsOf(app: Awaited<ReturnType<typeof asApp>>, session: string): Promise<number> {
  let n = 0;
  for (let after = 0; ;) {
    const reply = await app.call('events.read', { after, limit: 1000 }, 30_000);
    const events = ((reply.result ?? {}) as Obj).events as Obj[] | undefined ?? [];
    if (!events.length) return n;
    n += events.filter((e) => e.kind === 'agent.stop' && e.session === session).length;
    after = events[events.length - 1]!.log_pos as number;
  }
}

/**
 * The scenario, judged as it goes: each failure is one line naming what failed. A failure that leaves nothing more
 * to judge returns at once; the others are collected, so a run shows every way it misses.
 */
async function answeredByClickOnC(card: Card): Promise<{ handle: string; failures: string[] }> {
  const failures: string[] = [];
  await buildDeepHook();
  const home = makeHome();
  const s = newSession(home);
  writeSettings(home);
  const ask = { ...tasteAsk('Which header colour on the checkout total?', 'checkout', 'total', commit('ac2-redraft'), Date.now(), RECORD), recommended: B.id, default: B.id };
  const [seeded] = await seedInSessions(installedRoot(home), [{ session: s.id, source: 'deep_ask.taste', ask }]);
  const handle = seeded!.handle;

  const confirm = new Confirmer();
  const hub = await startHub({ home, env: confirmEnv(confirm) });
  if (hub.socket !== `${installedRoot(home)}/hub.sock`) throw Error(`BLOCKED: setup: deep-hook reaches ~/.deepbuild/hub.sock, and the hub listens at ${hub.socket}`);
  const app = await asApp(hub);
  const device = newDevice("this Mac's app");
  confirm.say(true);
  const paired = await pair(app, device);
  confirm.say(false);
  if (!device.id) throw Error(`BLOCKED: setup: device.pair didn't pair the app's key with the OS confirming you: ${shown(paired)}`);

  // The session: it starts, you type, the agent asks (the seeded taste call) and stops with the ask open.
  const claude = await Claude.start(home, { lag: LAG_MS });
  await claude.hook('SessionStart', payload(s, 'SessionStart'));
  const prompt = 'Pick a header colour for the checkout total.';
  typed(s, prompt);
  await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt }));
  const asked = 'I asked which header colour you want on the checkout total.';
  assistantSays(s, asked);
  const before = lineCount(s);
  const stopping = claude.hook('Stop', payload(s, 'Stop', { stop_hook_active: false, last_assistant_message: asked }));
  stopping.catch(() => undefined);
  const recorded = Date.now();
  while ((await stopsOf(app, s.id)) < 1) {
    if (Date.now() - recorded > 60_000) throw Error(`BLOCKED: setup: the hub never recorded session ${s.id}'s Stop`);
    await sleep(100);
  }
  await sleep(300);

  // Your click on C, drawn third: the card sends the option it maps the click to, signed by the app's key.
  const clicked = drawn(RECORD, B.id).findIndex((o) => o.id === C.id);
  const option = card(RECORD, B.id, clicked);
  const reply = await app.call('ask.answer', signed({ ask: handle, option, token: clickToken() }, device), 20_000);
  if (!('result' in reply)) return { handle, failures: [`the hub refused the card's answer ${named(option)} to ${handle}: ${shown(reply)}`] };
  const answered = (await eventsAbout(app, handle, 'ask.answered')).map((e) => String((e.data as Obj).answer));
  if (answered.length !== 1 || answered[0] !== C.id) failures.push(`ask.answered for ${handle} records ${answered.map(named).join(', ') || 'nothing'}, not ${named(C.id)}, the option clicked`);

  const stop: Fired | undefined = await Promise.race([stopping, sleep(90_000).then(() => undefined)]);
  if (!stop) return { handle, failures: [...failures, `session ${s.id}'s Stop never ended within 90 s of your answer`] };

  // Until the transcript shows the answer, nothing may say it was delivered: outcomes are read first, then the
  // transcript, so a delivered read here preceded the turn showing it.
  const carries = (i: Input) => i.text.includes(handle) || RECORD.some((o) => i.text.includes(o.id) || i.text.includes(o.label));
  let next: Input | undefined;
  let early = false;
  for (const since = Date.now(); Date.now() - since < LAG_MS + DELIVERED_WITHIN_MS; await sleep(100)) {
    const outcomes = await outcomesOf(app, handle);
    next = inputs(s, before).find(carries);
    if (next) break;
    if (!early && outcomes.includes('delivered')) {
      early = true;
      failures.push(`delivery.outcome for ${handle} reads delivered (${outcomes.join(', ')}) while session ${s.id}'s transcript doesn't show the answer yet: delivered and acknowledged is when the agent's turn shows it, not when the hub replies (the Stop came back ${shown(stop.stop)})`);
    }
  }
  if (!next) return { handle, failures: [...failures, `the agent's next input never showed the answer to ${handle}: session ${s.id}'s transcript after its Stop holds ${shown(inputs(s, before))}; the Stop came back ${shown(stop.stop)}`] };
  const shownAt = Date.now();

  // The agent's next input holds C's ID and label, and not B's.
  if (!next.text.includes(C.id) || !next.text.includes(C.label)) failures.push(`the agent's next input (transcript line ${next.line}, ${next.kind}) doesn't hold ${named(C.id)}: ${shown(next.text)}`);
  if (next.text.includes(B.id) || next.text.includes(B.label)) failures.push(`the agent's next input (transcript line ${next.line}, ${next.kind}) delivers ${named(B.id)}, the recommended option drawn first: ${shown(next.text)}`);

  // The session goes on as a real one would: a tool call with the answer, its words, and the stop that ends the turn.
  await claude.tool(s, 'Edit', { file_path: `${s.cwd}/src/checkout/total.css`, old_string: 'header { }', new_string: 'header { color: cobalt; }' }, { filePath: `${s.cwd}/src/checkout/total.css` });
  const done = 'The checkout total has the cobalt header.';
  assistantSays(s, done);
  void claude.hook('Stop', payload(s, 'Stop', { stop_hook_active: true, last_assistant_message: done })).catch(() => undefined);

  // Delivered and acknowledged, within the bound once the turn showed it.
  let outcomes = await outcomesOf(app, handle);
  while (!outcomes.includes('delivered') && Date.now() - shownAt < DELIVERED_WITHIN_MS) {
    await sleep(250);
    outcomes = await outcomesOf(app, handle);
  }
  if (!outcomes.includes('delivered')) failures.push(`delivery.outcome for ${handle} isn't delivered ${DELIVERED_WITHIN_MS / 1000} s after session ${s.id}'s transcript showed the answer (line ${next.line}): ${shown(outcomes)}`);
  app.close();
  return { handle, failures };
}

describe(`AC2 ${AC2} a click on C records C, the agent's next input holds C's ID and label, and delivery.outcome is delivered once the turn shows it`, () => {
  it(`${AC2} a taste call (A, C, B in the record; B recommended, drawn first) answered by a click on C: ask.answered records C, the session's transcript shows C's ID and label as its next input, and delivered is recorded only once it does`, async () => {
    const { failures } = await answeredByClickOnC(rightCard);
    expect(failures, 'the answer C reaches the agent, delivered and acknowledged').toEqual([]);
  }, 240_000);

  it(`${AC2} wrong program: a card that maps the click to the record's index delivers B and fails, naming the option`, async () => {
    const { failures } = await answeredByClickOnC(byRecordIndex);
    expect(failures.filter((f) => f.includes(B.id)), `the planted card is caught, naming ${named(B.id)}: ${shown(failures)}`).not.toEqual([]);
  }, 240_000);
});

// #3429: a session paseo runs in a mode that doesn't ask is named as unguarded. A Copilot agent has no hooks of its
// own, so DeepBuild sees a call of its only when it asks permission; in Copilot's Allow All mode it asks nobody. The
// plugin reads the agent's mode from its snapshot at each turn's start, and the record, the session's row and its page
// say that no call is checked before it runs, once per change of mode; a mode the facts don't list reads "mode not
// known". Paseo is #55's stand-in around the real plugin (../55/fixtures/paseo-host.mjs), its Copilot snapshot reading
// the modes the pinned paseo's real daemon gives (README, The worlds); the hub and the plugin are real.
// First: what you gave the suite by hand, before ../29's helpers (loaded through ../55) delete DEEP_* (#55 D1).
import '../55/env.ts';
import { afterEach, expect, it } from 'vitest';
import { about, cleanup, events, kinds, readFacts, said, turnStarts, waitFor, type Ev } from '../55/helpers.ts';
import { AC, ALLOW_ALL, ASKING, needRun } from './run.ts';
import { NOT_KNOWN, UNCHECKED, UNLISTED, copilot, ends, inMode, naming, pageOf, readingsOf, rowOf, rowSays, saying, stating, type Row, type World } from './world.ts';

afterEach(cleanup, 120_000);

const PROMPT = 'Make the cart total take the 10% discount off.';
/** The reading's third part (Scope): the turn's end is still checked. */
const TURN_END = /turn(?:'s|’s)? ends?\b|end of (?:its|the|each|every|a) turn/i;
/** How long the hub may take to show what a turn's start brought, on a loaded machine. */
const SHOWS = 60_000;

/** The session's readings that name the mode. */
const modeReadings = async (w: World, mode: string): Promise<Ev[]> => naming(readingsOf(await events(w.home), w.f.session), mode);
/** The session's record, for a failure's message. */
const record = async (w: World): Promise<string> => {
  const evs = (await events(w.home)).filter((e) => about(e, w.f.session));
  return `${kinds(evs) || 'nothing'}; its readings: ${readingsOf(evs, w.f.session).map(said).join('; ') || 'none'}; plugin errors ${JSON.stringify(w.host.errors()).slice(0, 400)}`;
};
/** Waits, within the bound, for the record to hold `n` readings of the session naming `mode`; what it holds then. */
async function readings(w: World, mode: string, n: number): Promise<Ev[]> {
  await waitFor(async () => (await modeReadings(w, mode)).length >= n, SHOWS, '', 500).catch(() => undefined);
  return modeReadings(w, mode);
}
/** Waits, within the bound, for the session's row to hold a line saying `words` (or, with `gone`, to hold none); the row then. */
async function row(w: World, words: RegExp, gone = false): Promise<Row> {
  await waitFor(async () => (saying(await rowOf(w.home, w.f.session), words).length > 0) !== gone, SHOWS, '', 500).catch(() => undefined);
  return rowOf(w.home, w.f.session);
}
/** The session's stops in the record: each turn's end the hub took, and so each start before it. */
const stops = async (w: World): Promise<Ev[]> => (await events(w.home)).filter((e) => e.kind === 'agent.stop' && e.session === w.f.session);
/** A whole turn in the snapshot's mode: its start, its end, and the hub's stop for it. */
async function turn(w: World, id: string, n: number): Promise<void> {
  await turnStarts(w.host, w.f, id, PROMPT);
  await ends(w, id);
  await waitFor(async () => (await stops(w)).length >= n, 2 * SHOWS, `the hub's stop for turn ${id} of session ${w.f.session}`, 500)
    .catch(async (e: Error) => { throw Error(`${e.message}; the session's record: ${await record(w)}`); });
}

it(`${AC.reading} a Copilot session whose snapshot reads allow-all starts a turn: the record holds one reading naming the mode, and its row and its page say no call is checked before it runs`, async () => {
  const w = await copilot(ALLOW_ALL);
  const who = `Copilot session ${w.f.session} (paseo agent ${w.f.agent.id})`;
  await turnStarts(w.host, w.f, 't1', PROMPT);

  const named = await readings(w, ALLOW_ALL, 1);
  expect(named.map(said), `${AC.reading} ${who} started a turn with its snapshot reading currentModeId ${ALLOW_ALL}, a mode in which Copilot approves its own calls, so the record must hold one reading of the session naming ${ALLOW_ALL}; the session's record: ${await record(w)}`).toHaveLength(1);
  const text = JSON.stringify(named[0]!.data);
  expect(text, `${AC.reading} ${who}'s reading says which mode, that no call is checked before it runs, and that the turn's end still is: ${said(named[0])}`).toMatch(UNCHECKED);
  expect(text, `${AC.reading} ${who}'s reading says which mode, that no call is checked before it runs, and that the turn's end still is: ${said(named[0])}`).toMatch(TURN_END);

  const shown = await row(w, UNCHECKED);
  const lines = saying(shown, UNCHECKED);
  expect(lines, `${AC.reading} ${who}'s row says no call is checked before it runs; it reads ${rowSays(shown)}`).not.toEqual([]);
  expect(lines.filter((line) => line.includes(ALLOW_ALL) && !line.includes('\n')), `${AC.reading} ${who}'s row says so in one line, naming the mode ${ALLOW_ALL}: ${JSON.stringify(lines)}`).not.toEqual([]);

  const page = stating(readingsOf(await pageOf(w.home, w.f.session), w.f.session), UNCHECKED);
  expect(page.map(said), `${AC.reading} ${who}'s page says so in one line, the reading naming ${ALLOW_ALL}`).toHaveLength(1);
  expect(JSON.stringify(page[0]!.data), `${AC.reading} ${who}'s page says so in one line, the reading naming ${ALLOW_ALL}`).toContain(ALLOW_ALL);
  expect((await modeReadings(w, ALLOW_ALL)).map(said), `${AC.reading} one reading for ${who}, once its row and page show it`).toHaveLength(1);
  needRun(AC.reading);
}, 400_000);

it(`${AC.switched} a second turn in allow-all adds no second reading; switched to its asking mode the session loses the line at its next turn's start, and a turn back in allow-all is a change of mode again`, async () => {
  const w = await copilot(ALLOW_ALL);
  const who = `Copilot session ${w.f.session}`;
  await turn(w, 't1', 1);
  const first = await readings(w, ALLOW_ALL, 1);
  expect(first.map(said), `${AC.switched} ${who}'s first turn in ${ALLOW_ALL} gives one reading naming the mode; the session's record: ${await record(w)}`).toHaveLength(1);

  // A second turn, the mode unchanged: its start and its end reach the hub, and no reading comes with them.
  await turn(w, 't2', 2);
  expect((await modeReadings(w, ALLOW_ALL)).map(said), `${AC.switched} ${who}'s second turn in ${ALLOW_ALL} adds no second reading: one reading per change of mode`).toHaveLength(1);
  const kept = await row(w, UNCHECKED);
  expect(saying(kept, UNCHECKED), `${AC.switched} ${who}'s row keeps its line through a second turn in ${ALLOW_ALL}; it reads ${rowSays(kept)}`).not.toEqual([]);

  // A person switches it to Agent, the mode that asks, in paseo's app; its next turn starts.
  inMode(w.f, ASKING);
  await turnStarts(w.host, w.f, 't3', 'Carry on.');
  const asking = await row(w, UNCHECKED, true);
  expect(saying(asking, UNCHECKED), `${AC.switched} ${who} switched to its asking mode (${ASKING}) loses the line at its next turn's start; its row reads ${rowSays(asking)}`).toEqual([]);
  expect(saying(asking, NOT_KNOWN), `${AC.switched} ${who} in Copilot's asking mode (${ASKING}) reads as one that asks, with no mode line; its row reads ${rowSays(asking)}`).toEqual([]);
  expect((await modeReadings(w, ALLOW_ALL)).map(said), `${AC.switched} the turn in the asking mode adds no reading naming ${ALLOW_ALL}`).toHaveLength(1);
  await ends(w, 't3');

  // Switched back: a turn that starts in allow-all after a turn that asked is a change of mode, so one more reading.
  inMode(w.f, ALLOW_ALL);
  await turnStarts(w.host, w.f, 't4', 'Carry on.');
  const again = await readings(w, ALLOW_ALL, 2);
  expect(again.map(said), `${AC.switched} ${who} switched back to ${ALLOW_ALL}: one reading per change of mode, so a second one now; the session's record: ${await record(w)}`).toHaveLength(2);
  const back = await row(w, UNCHECKED);
  expect(saying(back, UNCHECKED), `${AC.switched} ${who}'s row says no call is checked before it runs again; it reads ${rowSays(back)}`).not.toEqual([]);
  needRun(AC.switched);
}, 600_000);

it(`${AC.unlisted} a Copilot session in a mode its facts entry doesn't list reads "mode not known", never as one that asks`, async () => {
  const w = await copilot(UNLISTED);
  const who = `Copilot session ${w.f.session}`;
  await turnStarts(w.host, w.f, 't1', PROMPT);
  const shown = await row(w, NOT_KNOWN);
  expect(saying(shown, NOT_KNOWN), `${AC.unlisted} ${who} started a turn in mode ${UNLISTED}, which Copilot's entry in paseo's facts doesn't list: it reads "mode not known", never as a mode that asks; its row reads ${rowSays(shown)}; the session's record: ${await record(w)}`).not.toEqual([]);
  needRun(AC.unlisted);
}, 400_000);

it(`${AC.reading} ${AC.unlisted} Copilot's entry in paseo's facts lists allow-all, the mode in which it approves its own calls`, () => {
  const entry = JSON.stringify(readFacts().providers?.copilot ?? null);
  expect(entry, `${AC.unlisted} providers.copilot in adapters/paseo.facts.json lists the modes in which Copilot approves its own calls, as an agent's own facts list the modes that skip its prompts: for Copilot that is ${ALLOW_ALL}`).toContain(JSON.stringify(ALLOW_ALL));
  needRun(AC.unlisted);
});

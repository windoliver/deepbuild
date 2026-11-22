// Test-side tools for the #278 acceptance tests (README: The surface under test). They reuse #549's suite for what it
// already drives (building `deep-show` and the shipped relay, the scenario, the throwaway certificate, the door in
// front of the relay, the web bundle's server and headless Chrome), #550's for a relay frame read in its documented
// layout, and #277's for what a copy holds (its seat entries, its catch-up, its rows, its work), and add what #278's
// criteria read: `deep-show run` answered without an assertion, so each test asserts in its own file; a match that
// starts with whoever is there, that a copy joins later and that finishes and starts again; the relay's log read for
// what it handed a joiner; and a room of live app copies whose first player clicks Start. Nothing here stands in for
// the net module, the relay, the player or the piece: every entry, hash, report and frame a test reads is the
// implementation's own, and every expected value comes from the issue, the design and fixtures.ts.

import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, expect } from 'vitest';
import {
  Chrome, LIVE_MS, PANEL, REPO, Script, arr, centreOf, copyOf, gaveUp, isObject, joinedMatches, num, obj, pinOf, promptOf, putEvidence, scenario, serve, show, startDoor,
  startRelay, type Builds, type Certs, type Copy, type Door, type Tab,
} from '../549/helpers.ts';
import { MESSAGE_MAX, frameOf } from '../550/helpers.ts';
import { firstDifference, rowsOf, seatsOf, type Rows } from '../277/helpers.ts';
import { HASH_EVERY, LOGIC, type JsonObject, type JsonValue, type Piece, type Planted, type Plays } from './fixtures.ts';

export {
  FULL, REPO, Script, TIMEOUT, failsNaming, framesThrough, joinedMatches, playedOf, sentThrough, show, useBuilds, useCertificate, useCleanup, useClosers, useTemp,
} from '../549/helpers.ts';
export { attempt, benchmark, catchUpsOf, loadNote, oneSeat, seatsOf, trackLines, tracksAgree, workOf, type Work } from '../277/helpers.ts';
export { hashesOf, replayCall } from '../551/helpers.ts';
export type { Copy };

/** Each criterion's ID: `#278.` and the first 8 hex digits of the SHA-256 of its text (the trace lane's criterionId). */
export const AC = {
  1: 'AC1 #278.108a8250',
  2: 'AC2 #278.9b37a90c',
  3: 'AC3 #278.aa43e69b',
  4: 'AC4 #278.bbb4eb66',
  5: 'AC5 #278.fe1a5277',
  6: 'AC6 #278.c711dda6',
} as const;

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

// ---------------------------------------------------------------------------------------------------
// `deep-show run` (#393): one scenario line on stdin, one answer line. Unlike #549's `runShow`, this one asserts
// nothing: it gives back what the run answered, so a test's own file says what it expected.

const live = new Set<ChildProcess>();
/** Stops every `deep-show` this file started that still runs, by its PID, after each test. */
export function useChildren(): void {
  afterEach(() => { stopChildren(); });
}
/** Stops every `deep-show` this file started that still runs, by its PID (a copy left waiting in a lobby). */
export function stopChildren(): void {
  for (const c of live) c.kill('SIGKILL');
  live.clear();
}
/** What one `deep-show run` answered: `ok` and `replies` as it gave them (one reply a call), `code` when it refused the
 * scenario (a planted name it doesn't know: `bad_input`), and `why`, what it said, for a failure's message. */
export interface Run { ok: boolean; code: string | null; replies: JsonObject[]; why: string }
export function runShow(bin: string, sc: JsonObject, what: string, timeoutMs = LIVE_MS): Promise<Run> {
  const tag = typeof sc['planted'] === 'string' ? `${what} (planted ${sc['planted']})` : what;
  return new Promise((done, fail) => {
    const child = spawn(bin, ['run'], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'] });
    live.add(child);
    const out: Buffer[] = [];
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d: Buffer) => { out.push(d); });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-20_000); });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const end = (status: number | null, signal: string | null, error = ''): void => {
      clearTimeout(timer);
      const stopped = !live.delete(child);
      if (timedOut) { try { gaveUp(`${tag}: deep-show run did not finish within ${Math.round(timeoutMs / 60_000)} minutes`); } catch (e) { fail(e as Error); } return; }
      const line = Buffer.concat(out).toString('utf8').split('\n').find((l) => l !== '') ?? '';
      let parsed: JsonValue = null;
      try { parsed = JSON.parse(line) as JsonValue; } catch { parsed = null; }
      if (error || status !== 0 || !isObject(parsed)) {
        done({ ok: false, code: null, replies: [], why: `${tag}: deep-show run ${stopped ? 'was stopped by the test' : `exited ${String(status)} (${signal ?? 'no signal'})`}${error ? `: ${error}` : ''}; stdout: ${line.slice(0, 600)}; stderr: ${stderr.slice(-1200)}` });
        return;
      }
      const replies = Array.isArray(parsed['replies']) ? parsed['replies'].filter(isObject) : [];
      const ok = parsed['ok'] === true && replies.length === arr(sc['calls'], 'calls').length;
      done({ ok, code: typeof parsed['code'] === 'string' ? parsed['code'] : null, replies, why: ok ? '' : `${tag}: deep-show run answered ${show(parsed, 600)}` });
    };
    child.once('error', (e) => end(null, null, `${bin} could not run: ${e.message}`));
    child.once('close', (status, signal) => end(status, signal));
    child.stdin.on('error', () => {});
    child.stdin.end(`${JSON.stringify(sc)}\n`);
  });
}
/** #549's scenario, with this suite's planted names, the link a copy opened the piece through and the relay's
 * throwaway authority. */
export function world(evidence: string, doc: string, calls: JsonObject[], o: { planted?: Planted | undefined; link?: string | undefined; relayCa?: string | undefined } = {}): JsonObject {
  return { ...scenario({ evidence, docs: [{ id: doc, ...(o.link ? { link: o.link } : {}) }], calls, ...(o.relayCa ? { relayCa: o.relayCa } : {}) }), ...(o.planted ? { planted: o.planted } : {}) };
}
/** A `deep show` reply: its outcome (`presented`, or what else it said) and its error issues. */
export function shownOf(reply: JsonObject | undefined): { outcome: string; errors: JsonObject[] } {
  const issues = Array.isArray(reply?.['issues']) ? reply['issues'].filter(isObject) : [];
  return { outcome: String(reply?.['outcome'] ?? 'no reply'), errors: issues.filter((i) => i['severity'] === 'error') };
}

// ---------------------------------------------------------------------------------------------------
// `match` (README: `match`'s members): #549's call with #551's and #277's members, and what this suite adds.

/** Copy `player` is killed right after it runs match step `step` (#277's). */
export interface Kill { player: number; step: number }
/** Copy `player`'s person clicks Join right after the first player's copy runs match step `step`: a copy that wasn't
 * there at the start, or one that was killed and comes back. */
export interface Join { player: number; step: number }
/** How the match starts: copies 1 … `joined` have joined when the first player's Start is clicked; with `click: false`
 * nobody clicks it. */
export interface Start { joined: number; click?: boolean }
export interface RelayAsk {
  seed: number; log?: boolean;
  /** #551's: each frame held back a seeded whole number of match steps up to n. */
  back?: { up_to: number };
  /** #551's: player `player`'s message for match step `step` reaches copy `to` only once that copy has run step `at`. */
  deliver?: { player: number; step: number; to: number; at: number }[];
}
export interface MatchAsk {
  plays: Plays; relay?: RelayAsk; start?: Start; join?: Join[]; kill?: Kill[];
  /** After the match finishes, the first player's Start begins the next in the same room, for `steps` steps. */
  next?: { steps: number; plays: Plays };
}
export function matchCall(doc: string, steps: number, o: MatchAsk): JsonObject {
  const j = (v: unknown): JsonValue => v as JsonValue;
  return {
    call: 'match', doc, steps, plays: j(o.plays), ...(o.relay ? { relay: j(o.relay) } : {}), ...(o.start ? { start: j(o.start) } : {}),
    ...(o.join ? { join: j(o.join) } : {}), ...(o.kill ? { kill: j(o.kill) } : {}), ...(o.next ? { next: j(o.next) } : {}),
  };
}

/** One match of a `match` reply: each player's copy's report in player order, the test relay's report, and the next
 * match of the room when the call asked for one and the reply holds it. */
export interface Match { copies: Copy[]; relay: JsonObject; reply: JsonObject; next: Match | null }
function matchOf(reply: JsonObject, what: string): Match {
  const copies = arr(reply['copies'], `${what}: copies`).map((c, i) => copyOf(c, `${what}: copies[${i}]`)).sort((a, b) => a.player - b.player);
  return { copies, relay: obj(reply['relay'], `${what}: relay`), reply, next: isObject(reply['next']) ? matchOf(reply['next'], `${what}: next (the room's next match)`) : null };
}
/** What one `deep-show run` of a piece and its match gave. A test's own file asserts, in this order: `ok` (the run took
 * the scenario and its planted name), `outcome` is `presented`, `code` is null (the match call answered); then `match`
 * is there. `why` says what the run said instead. */
export interface Played { ok: boolean; outcome: string; code: string | null; match: Match | null; why: string }
export interface PlayAsk extends MatchAsk { piece: Piece; steps: number; planted?: Planted }
/** One `deep-show run`: the piece shown, then one match of it over the test relay, every copy in this process. */
export async function play(bin: string, evidence: string, what: string, ask: PlayAsk): Promise<Played> {
  putEvidence(evidence, ask.piece.program.bytes);
  const doc = String(ask.piece.doc['id']);
  const s = new Script();
  s.present(doc, ask.piece.doc);
  const m = s.add(matchCall(doc, ask.steps, ask));
  const r = await runShow(bin, world(evidence, doc, s.calls, { planted: ask.planted }), what);
  if (!r.ok) return { ok: false, outcome: '', code: r.code, match: null, why: r.why };
  const shown = shownOf(r.replies[0]);
  if (shown.outcome !== 'presented' || shown.errors.length) return { ok: true, outcome: shown.errors.length ? 'refused' : shown.outcome, code: null, match: null, why: `${what}: deep show answered ${shown.outcome}: ${show(shown.errors, 1500)}` };
  const reply = r.replies[m]!;
  if (typeof reply['code'] === 'string') return { ok: true, outcome: 'presented', code: reply['code'], match: null, why: `${what}: the match call refused: ${show(reply, 1200)}` };
  return { ok: true, outcome: 'presented', code: null, match: matchOf(reply, `${what}: the match`), why: '' };
}
/** The players of a match's copies, in order. */
export const playersOf = (m: Match): number[] => m.copies.map((c) => c.player);
/** The copy of `player`. */
export function copyFor(m: Match, player: number): Copy {
  const c = m.copies.find((x) => x.player === player);
  expect(c, `the match reply holds a copy for player ${player}; it holds players ${playersOf(m).join(', ')}`).toBeDefined();
  return c!;
}

// ---------------------------------------------------------------------------------------------------
// The judges the criteria share. Each failure names what it found.

/** Every pair of copies reports the same full-state hash at every step both report, and each of `full` at least
 * `atLeast` hashes, each at a hash interval. */
export function hashesAgree(copies: readonly Copy[], full: readonly Copy[], what: string, atLeast: number, every = HASH_EVERY): string[] {
  const f: string[] = [];
  for (const c of full) if (c.hashes.length < atLeast) f.push(`${what}: copy ${c.player} reports ${c.hashes.length} full-state hashes, fewer than ${atLeast}`);
  for (const c of copies) {
    const off = c.hashes.find((h) => h.step % every !== 0);
    if (off) f.push(`${what}: copy ${c.player} reports a full-state hash at step ${off.step}, not a hash interval of ${every}`);
  }
  for (let i = 0; i < copies.length; i++) for (let j = i + 1; j < copies.length; j++) {
    const s = firstDifference(copies[i]!, copies[j]!);
    if (s !== null) f.push(`${what}: copies ${copies[i]!.player} and ${copies[j]!.player} part at the hash for step ${s}`);
  }
  return f;
}
/** "At the next hash interval": every copy reports a full-state hash at the first hash interval after `step`, all the
 * same. */
export function nextHashAgrees(copies: readonly Copy[], step: number, what: string, every = HASH_EVERY): string[] {
  const next = (Math.floor(step / every) + 1) * every;
  const f: string[] = [];
  const seen = new Set<string>();
  for (const c of copies) {
    const h = c.hashes.find((x) => x.step === next);
    if (!h) f.push(`${what}: copy ${c.player} reports no full-state hash at step ${next}, the next hash interval after step ${step}`);
    else seen.add(h.hash);
  }
  if (seen.size > 1) f.push(`${what}: the copies' full-state hashes at step ${next}, the next hash interval after step ${step}, differ: ${[...seen].join(', ')}`);
  return f;
}
/** A copy's rows (#540's `steps`), by step. */
export const rows = (c: Copy, what: string): Rows => rowsOf(c.raw['steps'], `${what} copy ${c.player}`);
/** One logic array of the rules after a step, as a row holds it (`rules.<name>`). */
export function arrayAt(r: Rows, step: number, array: string, what: string): JsonValue[] {
  const row = r.get(step);
  expect(row, `${what}: a row for step ${step}`).toBeDefined();
  return arr(row![`${LOGIC}.${array}`], `${what}: step ${step}'s ${LOGIC}.${array}`);
}
/** Whom each seat is played by after a step: the rules' `owner`, a player or 0, the piece's bot. */
export const ownersAt = (r: Rows, step: number, what: string): JsonValue[] => arrayAt(r, step, 'owner', what);
/** A copy played the whole match: it ran `steps` match steps and its match didn't end. */
export function playedOn(copies: readonly Copy[], steps: number, what: string): string[] {
  return copies.filter((c) => c.ran !== steps || c.end !== null).map((c) => `${what}: copy ${c.player} ran ${c.ran} of ${steps} steps and its match ended ${String(c.end)} (${show(c.raw['ended'] ?? null, 300)})`);
}
/** The seat entries of every copy but those for the players who joined before the start (`joined` at step 0). */
export const laterSeats = (c: Copy): ReturnType<typeof seatsOf> => seatsOf(c).filter((s) => !(s.state === 'joined' && s.step === 0));
/** Why a copy's Join was refused, as its report says (README: `join_refused`), or null. */
export const joinRefused = (c: Copy): string | null => (typeof c.raw['join_refused'] === 'string' ? c.raw['join_refused'] : null);
/** The step a finished copy's report names (`ended.step`), or null. */
export function endedStep(c: Copy): number | null {
  const e = c.raw['ended'];
  return isObject(e) && typeof e['step'] === 'number' ? e['step'] : null;
}

// ---------------------------------------------------------------------------------------------------
// The relay's log (README: The relay's log), read for what the relay handed one copy.

/** One row of the test relay's log: a frame it handed copy `to`, with its bytes. */
export interface Handed { index: number; player: number; to: number; first: number; count: number; at: number; delivered: number | null; bytes: Buffer | null }
export function logOf(m: Match, what: string): Handed[] {
  return arr(m.relay['log'], `${what}: relay.log (the match asks for it)`).map((x, index) => {
    const r = obj(x, `${what}: relay.log[${index}]`);
    const hex = r['bytes'];
    return {
      index, player: num(r['player'], `${what}: relay.log[${index}].player`), to: num(r['to'], `${what}: relay.log[${index}].to`), first: num(r['first'], `${what}: relay.log[${index}].first`),
      count: num(r['count'], `${what}: relay.log[${index}].count`), at: num(r['at'], `${what}: relay.log[${index}].at`),
      delivered: r['delivered'] === null ? null : num(r['delivered'], `${what}: relay.log[${index}].delivered`),
      bytes: typeof hex === 'string' && /^(?:[0-9a-f]{2})*$/.test(hex) ? Buffer.from(hex, 'hex') : null,
    };
  });
}
/** A state value worth looking for in a frame: not whole, with more than six significant digits (so no entry's). */
const distinctive = (v: number): boolean => Number.isFinite(v) && !Number.isInteger(v) && Math.abs(v) >= 1e-3 && Number(v.toPrecision(6)) !== v;
/** The piece's state as the copies' rows show it: every distinctive value of the rules' `pos` and `ema`, by its f64
 * bytes either way round (hex) and by its decimal text. */
function stateValues(copies: readonly Copy[], what: string): { binary: Map<string, number>; text: Map<string, number> } {
  const binary = new Map<string, number>();
  const text = new Map<string, number>();
  for (const c of copies) for (const row of rows(c, what).values()) for (const name of ['pos', 'ema']) {
    const a = row[`${LOGIC}.${name}`];
    for (const v of Array.isArray(a) ? a : []) {
      if (typeof v !== 'number' || !distinctive(v)) continue;
      const le = Buffer.alloc(8); le.writeDoubleLE(v);
      const be = Buffer.alloc(8); be.writeDoubleBE(v);
      binary.set(le.toString('hex'), v); binary.set(be.toString('hex'), v); text.set(String(v), v);
    }
  }
  return { binary, text };
}
export interface LogAsk {
  /** The copy that joined, and the seconds on the relay's clock from which what the relay handed it is read. */
  to: number; since: number;
  /** The players whose every message from step 0 through `through` the joiner must have been handed. */
  from: readonly number[]; through: number;
  /** The copies whose rows show the piece's state (those that played from the start). */
  state: readonly Copy[];
}
/**
 * "Receives only entries, as the relay's log shows … from step 0" (criteria 2 and 3; README: The relay's log), as
 * #550's suite reads a log for nothing but entries: every frame the relay handed the joiner from `since` on is a relay
 * frame in its documented layout, of this match, from the seat of the player its row names, with the first step and
 * the count its row names; no step's message is longer than #550's MESSAGE_MAX; no message holds a value of the
 * piece's state, as f64 bytes either way round or as its decimal text; and together the frames carry each of `from`'s
 * messages for every step from 0 through `through`. A failure about one frame starts `frame <its row in the log>`.
 */
export function onlyEntries(m: Match, ask: LogAsk, what: string): string[] {
  const f: string[] = [];
  const log = logOf(m, what);
  const mine = log.filter((r) => r.to === ask.to && r.at >= ask.since && r.delivered !== null);
  if (mine.length === 0) f.push(`${what}: the relay's log holds no frame it handed copy ${ask.to} from ${ask.since.toFixed(3)} s on (of ${log.length} rows)`);
  const id = String(ask.state[0]?.raw['match'] ?? '');
  if (!/^[0-9a-f]{32}$/.test(id)) f.push(`${what}: copy ${ask.state[0]?.player}'s report names no match ID of 32 hex digits (match)`);
  const { binary, text } = stateValues(ask.state, what);
  if (binary.size < 100) f.push(`${what}: the copies' rows show only ${binary.size / 2} distinct values of the piece's state (${LOGIC}.pos, ${LOGIC}.ema) to look for in the frames`);
  const got = new Map<number, Set<number>>(ask.from.map((p) => [p, new Set<number>()]));
  for (const row of mine) {
    const name = `frame ${row.index} (to copy ${ask.to}, from player ${row.player}, handed at ${row.delivered!.toFixed(3)} s)`;
    if (row.bytes === null) { f.push(`${name} gives no bytes (bytes: what the relay handed, as hex)`); continue; }
    const frame = frameOf(row.bytes);
    if (typeof frame === 'string') { f.push(`${name} isn't a relay frame of steps' entries: ${frame}`); continue; }
    if (frame.match !== id) f.push(`${name} names the match ${frame.match}, not ${id}`);
    if (frame.seat !== row.player - 1) f.push(`${name} names seat ${frame.seat}, not its player's (the relay counts seats from 0)`);
    if (frame.first !== row.first || frame.steps.length !== row.count) f.push(`${name} holds ${frame.steps.length} steps from ${frame.first}, where its row says ${row.count} from ${row.first}`);
    frame.steps.forEach((message, k) => {
      const step = frame.first + k;
      got.get(row.player)?.add(step);
      if (message.length > MESSAGE_MAX) { f.push(`${name} holds ${message.length} bytes for step ${step}, past ${MESSAGE_MAX}: more than a step's entries and hashes`); return; }
      let found: number | undefined;
      const hex = message.toString('hex');
      for (let at = 0; found === undefined && at + 8 <= message.length; at++) found = binary.get(hex.slice(2 * at, 2 * at + 16));
      for (const t of found === undefined ? message.toString('latin1').matchAll(/-?\d+\.\d+(?:e[-+]?\d+)?/g) : []) { found = text.get(t[0]); if (found !== undefined) break; }
      if (found !== undefined) f.push(`${name} holds the piece's state value ${found} in its bytes for step ${step}`);
    });
  }
  for (const p of ask.from) {
    const have = got.get(p)!;
    const lacks = Array.from({ length: ask.through + 1 }, (_, k) => k).find((k) => !have.has(k));
    if (lacks !== undefined) f.push(`${what}: the frames the relay handed copy ${ask.to} carry no message of player ${p}'s for step ${lacks}, so not every entry from step 0 through ${ask.through}`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The app's Start (README: The app's Start), as `scope` reports it beside #549's `state.join`.

/** `state.start` of a `scope` reply: the Start the app shows the first player. */
export interface StartShown { state: string; button: [number, number, number, number]; raw: JsonObject }
/** undefined when the scope's state has no `start` member; null when the app shows no Start. */
export function startOf(reply: JsonObject | undefined): StartShown | null | undefined {
  const state = reply?.['state'];
  if (!isObject(state) || !('start' in state)) return undefined;
  const s = state['start'];
  if (!isObject(s)) return null;
  const b = Array.isArray(s['button']) ? s['button'].map((x) => (typeof x === 'number' ? x : Number.NaN)) : [];
  return { state: String(s['state'] ?? ''), button: [b[0] ?? Number.NaN, b[1] ?? Number.NaN, b[2] ?? Number.NaN, b[3] ?? Number.NaN], raw: s };
}
/** The `lobby` call (README: `lobby`): this copy's Join, played out until `joined` copies have joined. */
export function lobbyCall(joined: number, linkTo?: string): JsonObject {
  return { call: 'lobby', panel: PANEL, until: { joined }, ...(linkTo ? { link_to: linkTo } : {}) };
}

// ---------------------------------------------------------------------------------------------------
// A live room (criteria 1 and 4): the shipped relay behind #549's door on 127.0.0.1 with signals dropped, so every
// relay message crosses the door; `copies` copies in the app, each a `deep-show run` whose person clicks the app's
// Join, the first opening the match and writing its link, the others joining through it, in order. Where the app
// draws Start is read first from a lobby of two copies that is then stopped, as #549's suite reads where the app drew
// Join from a first run.

export interface RoomAsk {
  builds: Builds; certs: () => Certs; temp: () => string; closing: (f: () => Promise<void> | void) => void;
  /** The piece, its net item's relay left for this helper to set to the door. */
  piece: (relay: string) => Piece;
  copies: number; what: string; planted?: Planted;
  /** The first player's calls once every copy has joined (after its `lobby` call), given the centre of Start. */
  first: (s: Script, start: [number, number]) => void;
  /** Each other copy's calls after its person's click on Join. */
  others: (s: Script, player: number) => void;
}
/** What a live room gave. A test's own file asserts, in this order: `outcome` is `presented`; `start` isn't null (the
 * app showed the first player a Start in the lobby of two); then `first` and `others` are the copies' runs. */
export interface Room { outcome: string; why: string; door: Door; piece: Piece; start: StartShown | null; first: Run | null; others: Run[] }
async function linkFrom(file: string, what: string, copy: Promise<Run>): Promise<string | Run> {
  const { existsSync, readFileSync, statSync } = await import('node:fs');
  let finished: Run | null = null;
  copy.then((r) => { finished = r; }, () => undefined);
  const until = Date.now() + LIVE_MS;
  for (;;) {
    if (existsSync(file) && statSync(file).size > 0) { const text = readFileSync(file, 'utf8').trim(); if (text.includes('#')) return text; }
    if (finished) return finished;
    if (Date.now() > until) return gaveUp(`${what}: the first player's copy wrote no link to ${file} within ${Math.round(LIVE_MS / 60_000)} minutes`);
    await sleep(100);
  }
}
/** Waits until `n` joins have reached the relay through the door, or one of the copies' runs has ended: a copy in a
 * lobby waits there, so a run that ends first never joined, and its own reply says why. */
async function joins(door: Door, n: number, what: string, watch: Promise<Run>[]): Promise<void> {
  let ended = false;
  for (const w of watch) w.then(() => { ended = true; }, () => { ended = true; });
  const until = Date.now() + LIVE_MS;
  while (joinedMatches(door).length < n && !ended) {
    if (Date.now() > until) gaveUp(`${what}: only ${joinedMatches(door).length} of ${n} joins reached the relay within ${LIVE_MS / 60_000} minutes`);
    await sleep(100);
  }
}
/** The relay DeepBuild ships behind #549's door, signals dropped, both closed after the test. */
export async function relayAndDoor(builds: Builds, certs: Certs, closing: (f: () => Promise<void> | void) => void): Promise<Door> {
  const relay = await startRelay(builds.relay(), certs);
  closing(() => relay.stop());
  const door = await startDoor(relay.host, certs, { signals: false });
  closing(() => door.close());
  return door;
}
/** Where the app draws Join for a piece: a first run's prompt (#549's way). `outcome` is `presented` when the piece
 * was; `at` the centre of the prompt's button. */
export async function joinAt(bin: string, evidence: string, piece: Piece, relayCa: string, what: string, planted?: Planted): Promise<{ outcome: string; why: string; at: [number, number] }> {
  putEvidence(evidence, piece.program.bytes);
  const doc = String(piece.doc['id']);
  const probe = new Script();
  probe.present(doc, piece.doc);
  const seen = probe.scope();
  const looked = await runShow(bin, world(evidence, doc, probe.calls, { relayCa, planted }), `${what}: the prompt`);
  if (!looked.ok) return { outcome: '', why: looked.why, at: [0, 0] };
  const shown = shownOf(looked.replies[0]);
  if (shown.outcome !== 'presented' || shown.errors.length) return { outcome: shown.errors.length ? 'refused' : shown.outcome, why: `${what}: deep show answered ${shown.outcome}: ${show(shown.errors, 1500)}`, at: [0, 0] };
  const prompt = promptOf(looked.replies[seen], `${what}: the scope`);
  expect(prompt, `${what}: a piece whose net item declares a relay shows the app's Join prompt (state.join)`).not.toBeNull();
  return { outcome: 'presented', why: '', at: centreOf(prompt!.button) };
}
/** One live copy in the app: the piece shown, the prompt read, a person's click on Join at `at`, then `calls`. */
export function appCopy(bin: string, evidence: string, piece: Piece, o: { at: [number, number]; relayCa: string; link?: string | undefined; planted?: Planted | undefined }, calls: (s: Script) => void, what: string): Promise<Run> {
  putEvidence(evidence, piece.program.bytes);
  const doc = String(piece.doc['id']);
  const s = new Script();
  s.present(doc, piece.doc);
  s.scope();
  s.click(o.at);
  calls(s);
  return runShow(bin, world(evidence, doc, s.calls, { relayCa: o.relayCa, planted: o.planted, link: o.link }), what);
}
export async function liveRoom(o: RoomAsk): Promise<Room> {
  const door = await relayAndDoor(o.builds, o.certs(), o.closing);
  const piece = o.piece(door.url);
  const bin = o.builds.show();
  const ca = o.certs().ca;
  const none = (outcome: string, why: string): Room => ({ outcome, why, door, piece, start: null, first: null, others: [] });
  const looked = await joinAt(bin, o.temp(), piece, ca, o.what, o.planted);
  if (looked.outcome !== 'presented') return none(looked.outcome, looked.why);
  const copyRun = (calls: (s: Script) => void, link: string | undefined, what: string): Promise<Run> => appCopy(bin, o.temp(), piece, { at: looked.at, relayCa: ca, link, planted: o.planted }, calls, what);
  // Where the app draws Start: a lobby of two, read by its first player's scope, then stopped.
  let before = joinedMatches(door).length;
  const linkA = join(o.temp(), 'link');
  let startSeen = -1;
  const lobbyOne = copyRun((s) => { s.add(lobbyCall(2, linkA)); startSeen = s.scope(); }, undefined, `${o.what}: the lobby of two, copy 1`);
  const gotA = await linkFrom(linkA, `${o.what}: the lobby of two`, lobbyOne);
  if (typeof gotA !== 'string') return none('presented', `${o.what}: the lobby of two's first copy finished without writing its link: ${gotA.why || show(gotA.replies.slice(4), 900)}`);
  await joins(door, before + 1, o.what, [lobbyOne]);
  const lobbyTwo = copyRun((s) => { s.playMatch(1); }, gotA, `${o.what}: the lobby of two, copy 2`);
  const one = await lobbyOne;
  stopChildren();
  await lobbyTwo.catch(() => undefined);
  const start = one.ok ? startOf(one.replies[startSeen]) : undefined;
  if (!start || start.button.some((x) => !Number.isFinite(x))) return none('presented', `${o.what}: with two copies joined the first player's scope shows no Start with a button (state.start): ${one.why || show(one.replies[startSeen], 900)}`);
  // The room.
  before = joinedMatches(door).length;
  const linkFile = join(o.temp(), 'link');
  const firstRun = copyRun((s) => { s.add(lobbyCall(o.copies, linkFile)); o.first(s, centreOf(start.button)); }, undefined, `${o.what}: the app's copy 1`);
  const link = await linkFrom(linkFile, `${o.what}: the app's copy 1`, firstRun);
  if (typeof link !== 'string') return { ...none('presented', `${o.what}: the first player's copy finished without writing its link: ${link.why || show(link.replies.slice(4), 900)}`), start, first: link };
  await joins(door, before + 1, o.what, [firstRun]);
  const others: Promise<Run>[] = [];
  for (let p = 2; p <= o.copies; p++) {
    others.push(copyRun((s) => o.others(s, p), link, `${o.what}: the app's copy ${p}`));
    await joins(door, before + p, o.what, [firstRun, ...others]);
  }
  return { outcome: 'presented', why: '', door, piece, start, first: await firstRun, others: await Promise.all(others) };
}

// ---------------------------------------------------------------------------------------------------
// The web player (criterion 1): the bundle's page as the room's first player, and its own Start.

/** The web export (#172's `export` with `video.codec: web`): what `deep show` and the export answered. */
export async function exportWeb(bin: string, evidence: string, piece: Piece, out: string, what: string): Promise<{ outcome: string; why: string }> {
  putEvidence(evidence, piece.program.bytes);
  const doc = String(piece.doc['id']);
  const s = new Script();
  s.present(doc, piece.doc);
  const e = s.add({ call: 'export', doc, out, video: { codec: 'web' } });
  const r = await runShow(bin, world(evidence, doc, s.calls), what);
  if (!r.ok) return { outcome: '', why: r.why };
  const shown = shownOf(r.replies[0]);
  if (shown.outcome !== 'presented' || shown.errors.length) return { outcome: shown.errors.length ? 'refused' : shown.outcome, why: `${what}: deep show answered ${shown.outcome}: ${show(shown.errors, 1500)}` };
  if (r.replies[e]!['outcome'] !== 'exported') return { outcome: 'not exported', why: `${what}: the web export answered ${show(r.replies[e], 1500)}` };
  return { outcome: 'presented', why: '' };
}
/** The page of a served bundle in a headless Chrome of its own, ready. */
export async function openPlayer(certs: Certs, out: string, closing: (f: () => Promise<void> | void) => void, what: string): Promise<Tab> {
  const served = await serve(out);
  closing(() => served.stop());
  const chrome = await Chrome.open([pinOf(certs.cert)]);
  closing(() => chrome.close());
  const tab = await chrome.open(`${served.origin}/index.html`);
  await tab.mustBeReady(what);
  return tab;
}
/** The web player's own Start (README: The web player's Start): the element marked `data-deep-start`, or null. */
export interface WebStart { state: string; button: { x: number; y: number; w: number; h: number } | null }
export function webStart(tab: Tab): Promise<WebStart | null> {
  return tab.evaluate<WebStart | null>(`(() => { const p = document.querySelector('[data-deep-start]'); if (!p) return null; const b = p.querySelector('button'); const r = b ? b.getBoundingClientRect() : null;
    return { state: p.getAttribute('data-deep-start') || '', button: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null }; })()`);
}
/** Every way a script in the page can make a click on Start: pointer, mouse and click events it dispatches,
 * `button.click()`, and Enter keys sent to it after `focus()` (as #549's suite clicks Join by script). */
export function syntheticStartClicks(tab: Tab): Promise<void> {
  return tab.evaluate<void>(`(() => { const b = document.querySelector('[data-deep-start] button'); const r = b.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2, button: 0 };
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) b.dispatchEvent(type.startsWith('pointer') ? new PointerEvent(type, at) : new MouseEvent(type, at));
    b.click(); b.focus(); for (const type of ['keydown', 'keypress', 'keyup']) b.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); })()`);
}
/** Polls `get` until `ok` takes its value or `ms` have passed, and gives the last value either way, so the test's own
 * file says what it expected. Never an assertion on speed: the wait only bounds a wrong program's run. */
export async function waitFor<T>(get: () => Promise<T>, ok: (v: T) => boolean, ms = 600_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await get();
    if (ok(v) || Date.now() > end) return v;
    await sleep(200);
  }
}

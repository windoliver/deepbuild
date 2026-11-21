// Test-side tools for the #550 acceptance tests (README: The surface under test). They reuse #549's suite for what it
// already drives (building `deep-show` per feature set and the shipped relay, `deep-show run` without blocking this
// process, the throwaway certificate, the door in front of the relay, two live copies joined by a person's click), and
// add what #550's criteria read: the copies' refusals, net.desync and net.fault reports, track hashes and the test
// relay's frames; deep_kinds, a claim's verdict (deep_run's check kinds, as #1939's suite reads them) and deep mcp's
// tool list; and the merge base, built apart, for the one size criterion. Nothing here stands in for the net module,
// a check, the relay or the piece: every hash, refusal, report and frame a test reads is the implementation's own, and
// every expected value comes from the issue, the design and fixtures.ts.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  FULL, REPO, Script, TIMEOUT, arr, blocked, copyOf, failsNaming, isObject, livePair, none, num, obj, playedOf, presented, putEvidence, runShow, show,
  startDoor, startRelay, str, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp,
  type Certs, type Copy,
} from '../549/helpers.ts';
import {
  CAUGHT_AT, DOC, HASH_EVERY, LAST_MATCH, LOGIC, PLANT_STEP, courtDoc, courtProgram,
  type JsonObject, type JsonValue, type Plant, type Planted, type Plays, type Program,
} from './fixtures.ts';

export { FULL, TIMEOUT, failsNaming, isObject, none, obj, show, useBuilds, useCertificate, useChildren, useCleanup, useClosers, useTemp };
export type { JsonObject };

/** The build without the net module (criterion 6): the core set, which holds neither logic nor net. */
export const CORE = 'core';

/** Each criterion's ID: `#550.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #550.92355c66',
  2: 'AC2 #550.ba2d6c1f',
  3: 'AC3 #550.b639481c',
  4: 'AC4 #550.64a33e1a',
  5: 'AC5 #550.608848dc',
  6: 'AC6 #550.8e0f54ea',
  7: 'AC7 #550.31a59430',
  8: 'AC8 #550.acebf9a7',
  9: 'AC9 #550.b37be976',
  10: 'AC10 #550.e9bf3c06',
} as const;

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: #549's scenario (you and one agent's session, #383's virtual clock), with this suite's planted names.

const AGENT = { id: 'sess-550', thread: 'thread-550', name: 'Test agent: shared play', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 },
];
export const SESSION = AGENT.id;
export function scenario(evidence: string, docs: string[], calls: JsonObject[], o: { planted?: Planted; claims?: JsonObject } = {}): JsonObject {
  const panels: JsonObject = {};
  const byId: JsonObject = {};
  docs.forEach((d, k) => {
    const panel = k === 0 ? 'main' : `side-${k}`;
    panels[panel] = { rect: k === 0 ? [0, 0, 640, 360] : [0, 720, 640, 360] };
    byId[d] = { panel };
  });
  if (!docs.length) panels['main'] = { rect: [0, 0, 640, 360] };
  return {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels, docs: byId, clock: { refresh_hz: 60, lead: 0, check: 0 },
    ...(o.planted ? { planted: o.planted } : {}), ...(o.claims ? { claims: o.claims } : {}), calls,
  };
}

/** README: `match`. The test relay's faults and modes on its own clock: `log` asks for every frame with its bytes;
 * `direct` turns direct paths on, so each copy's frames go to each other copy apart. */
export interface RelayAsk { seed: number; log?: boolean; direct?: boolean }
export interface MatchAsk { plays: Plays; relay?: RelayAsk; plant?: Plant }
export function matchCall(doc: string, steps: number, o: MatchAsk): JsonObject {
  return {
    call: 'match', doc, steps, plays: o.plays as unknown as JsonObject,
    ...(o.relay ? { relay: o.relay as unknown as JsonObject } : {}), ...(o.plant ? { plant: o.plant as unknown as JsonObject } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------
// A copy's report (README: A copy's report): #549's, with what #550 adds.

export interface Refusal { step: number; player: number; control: string; value: JsonValue; raw: JsonObject }
export interface Desync { cause: string | null; firstStep: number | null; step: number | null; player: number | null; module: string | null; field: string | null; raw: JsonObject }
export interface Fault { step: number | null; item: string | null; kind: string | null; raw: JsonObject }
export interface Row { step: number; hash: string | null; arrays: JsonObject }
export interface NetCopy extends Copy {
  /** The match ID, 32 hex digits. */
  match: string | null;
  /** The entries the module refused; null where the report has no `refused`. */
  refused: Refusal[] | null;
  /** null: no desync; undefined: the report has no `desync`. The same for `fault`. */
  desync: Desync | null | undefined;
  fault: Fault | null | undefined;
  /** The track hash each hash row carries, by step (16 hex digits), where it carries one. */
  tracks: Map<number, string>;
  rows: Row[];
}
const nullableNum = (v: JsonValue | undefined): number | null => (typeof v === 'number' ? v : null);
const nullableStr = (v: JsonValue | undefined): string | null => (typeof v === 'string' ? v : null);
export function netCopyOf(v: JsonValue | undefined, what: string): NetCopy {
  const c = copyOf(v, what);
  const raw = c.raw;
  const refused = Array.isArray(raw['refused']) ? raw['refused'].map((x, i) => {
    const r = obj(x, `${what}: refused[${i}]`);
    return { step: num(r['step'], `${what}: refused[${i}].step`), player: num(r['player'], `${what}: refused[${i}].player`), control: str(r['control'], `${what}: refused[${i}].control`), value: r['value'] ?? null, raw: r };
  }) : null;
  let desync: Desync | null | undefined;
  if (raw['desync'] === null) desync = null;
  else if (isObject(raw['desync'])) {
    const d = raw['desync'];
    desync = {
      cause: nullableStr(d['cause']), firstStep: nullableNum(d['first_step']), step: nullableNum(d['step']), player: nullableNum(d['player']),
      module: nullableStr(d['module']), field: nullableStr(d['field']), raw: d,
    };
  }
  let fault: Fault | null | undefined;
  if (raw['fault'] === null) fault = null;
  else if (isObject(raw['fault'])) fault = { step: nullableNum(raw['fault']['step']), item: nullableStr(raw['fault']['item']), kind: nullableStr(raw['fault']['kind']), raw: raw['fault'] };
  const tracks = new Map<number, string>();
  for (const [i, x] of arr(raw['hashes'], `${what}: hashes`).entries()) {
    const h = obj(x, `${what}: hashes[${i}]`);
    if (typeof h['track'] === 'string') tracks.set(num(h['step'], `${what}: hashes[${i}].step`), h['track']);
  }
  const rows = Array.isArray(raw['steps']) ? raw['steps'].filter(isObject).map((r) => {
    const hash = isObject(r['hash']) && typeof r['hash'][LOGIC] === 'string' ? r['hash'][LOGIC] : null;
    return { step: num(r['step'], `${what}: a step row's step`), hash, arrays: isObject(r['arrays']) ? r['arrays'] : {} };
  }) : [];
  return { ...c, match: nullableStr(raw['match']), refused, desync, fault, tracks, rows };
}
/** A `match` reply's copies, in player order; a refusal fails, naming it. */
export function netCopiesOf(reply: JsonObject | undefined, what: string): NetCopy[] {
  const m = obj(reply, what);
  expect(m['code'], `${what}: the match call answers, not refuses: ${show(m, 1500)}`).toBeUndefined();
  return arr(m['copies'], `${what}: copies`).map((c, i) => netCopyOf(c, `${what}: copies[${i}]`)).sort((a, b) => a.player - b.player);
}
/** A match's copies, one a player from 1 to `n`, in player order. */
export function players(copies: NetCopy[], n: number, what: string): [NetCopy, NetCopy, ...NetCopy[]] {
  expect(copies.map((c) => c.player), `${what}: the match has one copy a player, 1 to ${n}`).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  return copies as [NetCopy, NetCopy, ...NetCopy[]];
}
/** One of a copy's step rows. */
export function rowAt(copy: NetCopy, step: number): Row | undefined {
  return copy.rows.find((r) => r.step === step);
}
/** An array of a step row, as numbers. */
export function arrayAt(copy: NetCopy, step: number, name: string): number[] | null {
  const r = rowAt(copy, step);
  const a = r?.arrays[`${LOGIC}.${name}`];
  return Array.isArray(a) ? a.map((x) => (typeof x === 'number' ? x : Number.NaN)) : null;
}

// ---------------------------------------------------------------------------------------------------
// The test relay's log (README: The relay's log): each frame it carried, with its bytes, read in relay@1's layout
// (packages/contracts/slots/relay@1.json: match 16 B, player u8, confirmed u32, first u32, count u16, then each step as
// a u16 length and its bytes, little-endian).

export interface Carried { player: number; first: number; count: number; at: number; delivered: number | null; bytes: Buffer | null }
/** The relay's log in a `match` reply that asked for it; a row without its bytes keeps `bytes` null, which
 * wireFailures reports. */
export function relayLogOf(reply: JsonObject | undefined, what: string): Carried[] {
  const r = obj(obj(reply, what)['relay'], `${what}: relay (the test relay's report)`);
  return arr(r['log'], `${what}: relay.log`).map((x, i) => {
    const f = obj(x, `${what}: relay.log[${i}]`);
    const hex = f['bytes'];
    return {
      player: num(f['player'], `${what}: relay.log[${i}].player`), first: num(f['first'], `${what}: relay.log[${i}].first`), count: num(f['count'], `${what}: relay.log[${i}].count`),
      at: num(f['at'], `${what}: relay.log[${i}].at`), delivered: f['delivered'] === null ? null : num(f['delivered'], `${what}: relay.log[${i}].delivered`),
      bytes: typeof hex === 'string' && /^(?:[0-9a-f]{2})+$/.test(hex) ? Buffer.from(hex, 'hex') : null,
    };
  });
}
export interface Frame { match: string; seat: number; confirmed: number; first: number; steps: Buffer[] }
/** A relay@1 frame, or the reason its bytes aren't one. */
export function frameOf(bytes: Buffer): Frame | string {
  if (bytes.length < 27) return `${bytes.length} bytes, shorter than relay@1's 27-byte header`;
  const count = bytes.readUInt16LE(25);
  const steps: Buffer[] = [];
  let at = 27;
  for (let i = 0; i < count; i++) {
    if (at + 2 > bytes.length) return `its step ${i} of ${count} has no length`;
    const n = bytes.readUInt16LE(at);
    if (at + 2 + n > bytes.length) return `its step ${i} of ${count} runs past the frame`;
    steps.push(bytes.subarray(at + 2, at + 2 + n));
    at += 2 + n;
  }
  if (at !== bytes.length) return `${bytes.length - at} bytes follow its ${count} steps`;
  return { match: bytes.subarray(0, 16).toString('hex'), seat: bytes.readUInt8(16), confirmed: bytes.readUInt32LE(17), first: bytes.readUInt32LE(21), steps };
}
/** The forms a number takes in bytes: f64 either way round, and its shortest decimal text. */
function forms(v: number): Buffer[] {
  const le = Buffer.alloc(8); le.writeDoubleLE(v);
  const be = Buffer.alloc(8); be.writeDoubleBE(v);
  return [le, be, Buffer.from(String(v), 'latin1')];
}
/** A state value worth looking for on the wire: not whole, with at least five significant digits, and no entry's. */
const distinctive = (v: number, entries: Set<number>): boolean =>
  Number.isFinite(v) && !Number.isInteger(v) && Math.abs(v) >= 1e-3 && Number(v.toPrecision(6)) !== v && !entries.has(v);
/** Steps' messages larger than this would carry something besides a step's entries and the hashes (README). */
export const MESSAGE_MAX = 4096;
/**
 * "The relay's log shows no message holding anything but the player's entries, the match ID and hashes" (criteria 1
 * and 10; README: The relay's log): every frame is relay@1's, of this match, from the seat of the player that sent it;
 * no step's message is longer than MESSAGE_MAX; and no message holds a value of the ball's state that no entry
 * carries, as f64 bytes either way round or as its decimal text.
 */
export function wireFailures(log: readonly Carried[], copies: readonly NetCopy[], plays: Plays, what: string): string[] {
  const f: string[] = [];
  const ids = new Set(copies.map((c) => c.match));
  if (ids.size !== 1 || ![...ids][0] || !/^[0-9a-f]{32}$/.test([...ids][0]!)) f.push(`${what}: the copies report one match ID of 32 hex digits (match), got ${JSON.stringify([...ids])}`);
  const id = [...ids][0] ?? '';
  if (log.length === 0) f.push(`${what}: the relay's log holds no frame`);
  const entries = new Set(Object.values(plays).flat().map((e) => e.value));
  const values = new Set<number>();
  for (const c of copies) for (const r of c.rows) for (const name of ['ball_x', 'ball_y', 'ball_vx', 'ball_vy']) {
    const a = r.arrays[`${LOGIC}.${name}`];
    for (const v of Array.isArray(a) ? a : []) if (typeof v === 'number' && distinctive(v, entries)) values.add(v);
  }
  if (values.size < 50) f.push(`${what}: the copies' step rows show only ${values.size} distinct values of the ball's state to look for on the wire`);
  // Each value's f64 bytes, either way round, by their hex, and its shortest decimal text.
  const binary = new Map<string, number>();
  const text = new Map<string, number>();
  for (const v of values) { const [le, be, t] = forms(v); binary.set(le!.toString('hex'), v); binary.set(be!.toString('hex'), v); text.set(t!.toString('latin1'), v); }
  let held = 0;
  const seen = new Set<string>();
  const bare = log.filter((r) => r.bytes === null).length;
  if (bare) f.push(`${what}: ${bare} of the relay log's ${log.length} rows give no bytes (bytes: the frame as the relay carried it, as hex; README: The relay's log)`);
  for (const [i, row] of log.entries()) {
    if (row.bytes === null) continue;
    const frame = frameOf(row.bytes);
    if (typeof frame === 'string') { f.push(`${what}: frame ${i} (player ${row.player}) isn't a relay@1 frame: ${frame}`); continue; }
    if (frame.match !== id) f.push(`${what}: frame ${i} names the match ${frame.match}, not ${id}`);
    if (frame.seat !== row.player - 1) f.push(`${what}: frame ${i}, from player ${row.player}, names seat ${frame.seat} (relay@1 counts seats from 0)`);
    frame.steps.forEach((m, k) => {
      if (m.length > MESSAGE_MAX) f.push(`${what}: frame ${i}'s message for step ${frame.first + k} is ${m.length} bytes, past ${MESSAGE_MAX}`);
      const key = `${row.player}:${m.toString('hex')}`;
      if (seen.has(key)) return;
      seen.add(key);
      let found: number | undefined;
      for (let at = 0; found === undefined && at + 8 <= m.length; at++) found = binary.get(m.toString('hex', at, at + 8));
      for (const t of found === undefined ? m.toString('latin1').matchAll(/-?\d+\.\d+(?:e[-+]?\d+)?/g) : []) { found = text.get(t[0]); if (found !== undefined) break; }
      if (found !== undefined) { held += 1; if (held <= 5) f.push(`${what}: frame ${i}'s message for step ${frame.first + k} holds the ball's state value ${found}`); }
    });
  }
  if (held > 5) f.push(`${what}: ${held} messages in all hold a value of the ball's state`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The judges each criterion's tests share. Each failure names what it found.

/** Two copies' full-state hashes at every step both report: each failure names the first step that differs. */
export function hashFailures(a: NetCopy, b: NetCopy, what: string, atLeast: number): string[] {
  const f: string[] = [];
  const other = new Map(b.hashes.map((h) => [h.step, h.hash]));
  let shared = 0;
  for (const h of a.hashes) {
    const got = other.get(h.step);
    if (got === undefined) continue;
    shared += 1;
    if (got !== h.hash) { f.push(`${what}: the full-state hashes differ first at match step ${h.step}: ${h.hash} and ${got}`); break; }
  }
  if (shared < atLeast) f.push(`${what}: the two copies report only ${shared} full-state hashes at the same steps, fewer than ${atLeast}`);
  for (const c of [a, b]) c.hashes.forEach((h, i) => { if (i > 0 && h.step - c.hashes[i - 1]!.step !== HASH_EVERY) f.push(`${what}: copy ${c.player}'s hashes at ${c.hashes[i - 1]!.step} and ${h.step} aren't ${HASH_EVERY} match steps apart`); });
  return f;
}
/** A match that played on to its end: every copy ran `steps`, none ended, none reports a desync or a fault. */
export function playedOnFailures(copies: readonly NetCopy[], steps: number, what: string): string[] {
  const f: string[] = [];
  for (const c of copies) {
    if (c.ran !== steps) f.push(`${what}: copy ${c.player} ran ${c.ran} match steps, not ${steps}`);
    if (c.end !== null) f.push(`${what}: copy ${c.player}'s match ended ${c.end}`);
    if (c.desync) f.push(`${what}: copy ${c.player} reports net.desync ${show(c.desync.raw, 400)}`);
    if (c.fault) f.push(`${what}: copy ${c.player} reports net.fault ${show(c.fault.raw, 400)}`);
  }
  return f;
}
/**
 * "Caught at the hash for step 360, which stops the match on both copies" (criteria 1, 5, 7, 8): each copy's full-state
 * hashes agree with the other's at step 300 and differ at step 360, it reports no hash past 360 and ran no step at
 * 420, and it and its record end desync.
 */
export function caughtFailures(a: NetCopy, b: NetCopy, what: string, o: { trackOnly?: boolean } = {}): string[] {
  const f: string[] = [];
  const at = (c: NetCopy, step: number): string | undefined => c.hashes.find((h) => h.step === step)?.hash;
  if (at(a, LAST_MATCH) === undefined || at(a, LAST_MATCH) !== at(b, LAST_MATCH)) f.push(`${what}: copies ${a.player} and ${b.player} don't share the full-state hash at step ${LAST_MATCH}: ${String(at(a, LAST_MATCH))} and ${String(at(b, LAST_MATCH))}`);
  const [ha, hb] = [at(a, CAUGHT_AT), at(b, CAUGHT_AT)];
  const [ta, tb] = [a.tracks.get(CAUGHT_AT), b.tracks.get(CAUGHT_AT)];
  if (ha === undefined || hb === undefined) f.push(`${what}: a copy reports no full-state hash at step ${CAUGHT_AT}: ${String(ha)} and ${String(hb)}`);
  else if (o.trackOnly ? ta === tb : ha === hb) f.push(`${what}: copies ${a.player} and ${b.player} agree at the hash for step ${CAUGHT_AT} (${ha}${o.trackOnly ? `, track ${String(ta)}` : ''}): the change at step ${PLANT_STEP} isn't caught there`);
  for (const c of [a, b]) {
    const past = c.hashes.filter((h) => h.step > CAUGHT_AT).map((h) => h.step);
    if (past.length) f.push(`${what}: copy ${c.player} played on past the hash for step ${CAUGHT_AT}, hashing steps ${past.slice(0, 5).join(', ')}`);
    if (c.ran >= CAUGHT_AT + HASH_EVERY) f.push(`${what}: copy ${c.player} ran ${c.ran} match steps, past step ${CAUGHT_AT + HASH_EVERY}`);
    if (c.end !== 'desync') f.push(`${what}: copy ${c.player}'s match ended ${String(c.end)}, not desync`);
    if (c.record?.end !== 'desync') f.push(`${what}: copy ${c.player}'s record ends ${String(c.record?.end)}, not desync`);
  }
  return f;
}
/** net.desync on a copy names step `step` and a field of `module` matching `field` (README: net.desync). */
export function namedFailures(c: NetCopy, what: string, o: { step: number; module: string; field: RegExp; cause?: string }): string[] {
  const d = c.desync;
  if (d === undefined) return [`${what}: copy ${c.player}'s report has no desync (README: A copy's report): it holds ${Object.keys(c.raw).join(', ')}`];
  if (d === null) return [`${what}: copy ${c.player} reports no net.desync (its match ended ${String(c.end)})`];
  const f: string[] = [];
  const said = show(d.raw, 500);
  if (d.firstStep !== o.step) f.push(`${what}: copy ${c.player}'s net.desync names step ${String(d.firstStep)}, not ${o.step}: ${said}`);
  if (d.module !== o.module) f.push(`${what}: copy ${c.player}'s net.desync names the module ${String(d.module)}, not ${o.module}: ${said}`);
  if (d.field === null || !o.field.test(d.field)) f.push(`${what}: copy ${c.player}'s net.desync names the field ${String(d.field)}, not ${o.field}: ${said}`);
  if (o.cause !== undefined && d.cause !== o.cause) f.push(`${what}: copy ${c.player}'s net.desync names cause ${String(d.cause)}, not ${o.cause}: ${said}`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// One match of the paddle piece over the test relay, in one `deep-show run`.

export interface Played { copies: NetCopy[]; log: Carried[] | null; reply: JsonObject }
export interface PlayAsk extends MatchAsk { steps: number; program?: Program; players?: number; planted?: Planted }
/** Presents the paddle piece (or `program`'s) and plays its match with `match`, every copy in this process. */
export async function play(bin: string, evidence: string, what: string, ask: PlayAsk): Promise<Played> {
  const program = ask.program ?? courtProgram();
  putEvidence(evidence, program.bytes);
  const doc = ask.players === 3 ? DOC.trio : ask.program ? DOC.trap : DOC.court;
  const s = new Script();
  s.present(doc, courtDoc(program, { players: ask.players ?? 2 }, doc));
  const m = s.add(matchCall(doc, ask.steps, ask));
  const r = await runShow(bin, scenario(evidence, [doc], s.calls, ask.planted ? { planted: ask.planted } : {}), what);
  presented(r[0], `${what}: the paddle piece`);
  return { copies: netCopiesOf(r[m], what), log: ask.relay?.log ? relayLogOf(r[m], what) : null, reply: r[m]! };
}

// ---------------------------------------------------------------------------------------------------
// deep_kinds (#412) and a claim's verdict, deep_run's check kinds (#1939's suite: `{call: "verdict", claim}`).

/** Every entry of `registry` deep_kinds lists, paged through its cursors. */
export async function kindsEntries(bin: string, evidence: string, registry: string, what: string): Promise<JsonObject[]> {
  const out: JsonObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const s = new Script();
    const k = s.add({ call: 'deep_kinds', op: 'list', registry, ...(cursor ? { cursor } : {}) });
    const reply = obj((await runShow(bin, scenario(evidence, [], s.calls), `${what}: deep_kinds list, page ${page + 1}`))[k], `${what}: deep_kinds list`);
    expect(reply['error'], `${what}: deep_kinds list answers, not refuses: ${show(reply)}`).toBeUndefined();
    for (const r of arr(reply['registries'], `${what}: registries`).filter(isObject)) for (const e of Array.isArray(r['entries']) ? r['entries'].filter(isObject) : []) out.push(e);
    cursor = typeof reply['next'] === 'string' && reply['next'] !== '' ? reply['next'] : undefined;
    if (!cursor) return out;
  }
  throw Error(`${what}: deep_kinds list doesn't end within 200 pages`);
}
/** The gallery's examples, each read by its hash: its title and its document. */
export async function galleryDocs(bin: string, evidence: string, what: string): Promise<{ hash: string; title: string; doc: JsonObject | null }[]> {
  const s = new Script();
  const g = s.add({ call: 'deep_kinds', op: 'gallery' });
  const listed = obj((await runShow(bin, scenario(evidence, [], s.calls), `${what}: the gallery`))[g], `${what}: deep_kinds gallery`);
  const examples = arr(listed['examples'], `${what}: the gallery's examples`).filter(isObject);
  const read = new Script();
  const at = examples.map((e) => read.add({ call: 'deep_kinds', op: 'read', example: str(e['hash'], `${what}: an example's hash`) }));
  const replies = examples.length ? await runShow(bin, scenario(evidence, [], read.calls), `${what}: the gallery's examples, read`) : [];
  return examples.map((e, i) => {
    const text = replies[at[i]!]?.['text'];
    let doc: JsonObject | null = null;
    if (typeof text === 'string') { try { const v = JSON.parse(text) as JsonValue; doc = isObject(v) ? v : null; } catch { doc = null; } }
    return { hash: String(e['hash']), title: String(e['title'] ?? ''), doc };
  });
}
/** The programs the shipped gallery's logic examples run, put in the evidence store by their bytes' hash (as the
 * gallery's own test does: crates/deep-show/tests/gallery.rs). */
export function putGalleryPrograms(evidence: string): void {
  const dir = join(REPO, 'crates', 'deep-show', 'gallery');
  for (const f of readdirSync(dir)) if (f.endsWith('.wasm')) putEvidence(evidence, readFileSync(join(dir, f)));
}
/** One claim of the agent's on `doc`, its one requirement `check`, judged by `verdict` after the agent's deep_show. */
export async function verdictRow(bin: string, evidence: string, doc: string, document: JsonObject, check: JsonObject, what: string): Promise<JsonObject> {
  const claim = 'claim:01JB550C000000000000000001';
  const req = 'req:01JB550Q000000000000000001';
  const claims: JsonObject = { [claim]: { session: SESSION, deliverables: [doc], requirements: [{ id: req, check }] } };
  const s = new Script();
  const shown = s.add({ call: 'deep_show', session: SESSION, doc, document, include: ['issues'] });
  const v = s.add({ call: 'verdict', claim });
  const r = await runShow(bin, scenario(evidence, [doc], s.calls, { claims }), what);
  const issues = Array.isArray(r[shown]?.['issues']) ? (r[shown]!['issues'] as JsonValue[]).filter(isObject).filter((i) => i['severity'] === 'error') : [];
  expect(issues, `${what}: deep_show presents the gallery's two-player piece with no error: ${show(r[shown], 1500)}`).toEqual([]);
  const row = arr(obj(r[v], `${what}: the verdict`)['requirements'], `${what}: the verdict's requirements`).filter(isObject).find((x) => x['id'] === req);
  expect(row, `${what}: the verdict has a row for the requirement: ${show(r[v], 1500)}`).toBeDefined();
  return row!;
}

// ---------------------------------------------------------------------------------------------------
// `deep mcp` (#26): its tool list, as an agent's MCP client reads it (#412's suite reads it so).

export interface Tool { name: string; description: string; inputSchema: JsonObject }
export function toolList(home: string): Tool[] {
  const cli = join(REPO, 'packages/cli/dist/main.js');
  expect(existsSync(cli), `the CLI is built at ${cli} (npm run build --workspaces)`).toBe(true);
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'acceptance-550', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ];
  const r = spawnSync(process.execPath, [cli, 'mcp'], { cwd: home, env: { ...process.env, HOME: home }, input: `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  const replies = (r.stdout ?? '').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) as JsonObject; } catch { return {}; } });
  const listed = replies.find((m) => m['id'] === 2);
  const result = isObject(listed?.['result']) ? listed['result'] : {};
  return arr(result['tools'], `deep mcp tools/list's tools (stdout ${(r.stdout ?? '').slice(0, 800)}; stderr ${(r.stderr ?? '').slice(-800)})`).map((t, i) => {
    const o = obj(t, `tools[${i}]`);
    return { name: str(o['name'], `tools[${i}].name`), description: str(o['description'], `tools[${i}].description`), inputSchema: obj(o['inputSchema'], `tools[${i}].inputSchema`) };
  });
}
export function propertyNames(schema: JsonValue | undefined, into = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) for (const s of schema) propertyNames(s, into);
  else if (isObject(schema)) {
    if (isObject(schema['properties'])) for (const k of Object.keys(schema['properties'])) into.add(k);
    for (const v of Object.values(schema)) propertyNames(v, into);
  }
  return into;
}

// ---------------------------------------------------------------------------------------------------
// The merge base (criterion 10's reference: the hash message without the track hash), exported whole by `git archive`
// into the git-ignored target folder and built apart, as #412's suite builds it. git runs in this checkout with no
// GIT_* variable from the environment; nothing is copied but the archive's files, never `.git`.

const gitEnv = (): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
const git = (...args: string[]): string => execFileSync('git', args, { cwd: REPO, encoding: 'utf8', env: gitEnv() }).trim();
/** The commit whose build is the reference: the merge base with origin/main, or HEAD's first parent where HEAD is it
 * (on main, after this change lands). */
export function referenceCommit(): string {
  const base = git('merge-base', 'HEAD', 'origin/main');
  return base === git('rev-parse', 'HEAD') ? git('rev-parse', 'HEAD^1') : base;
}
const baseBins = new Map<string, string>();
export function baseBuild(): { sha: string; bin: string } {
  const sha = referenceCommit();
  const dir = join(REPO, 'target', 'acceptance-550-base', sha.slice(0, 12));
  const done = join(dir, '.exported');
  if (!existsSync(done)) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const tar = join(dir, '..', `${sha.slice(0, 12)}.tar`);
    git('archive', '--format=tar', '-o', tar, sha);
    execFileSync('tar', ['-xf', tar, '-C', dir]);
    rmSync(tar, { force: true });
    writeFileSync(done, sha);
  }
  const bin = join(dir, 'deep-show-full');
  if (!baseBins.has(sha)) {
    const r = spawnSync('cargo', ['build', '--locked', '--bin', 'deep-show', '--no-default-features', '--features', FULL], {
      cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024,
      env: { ...process.env, CARGO_TARGET_DIR: join(dir, 'target'), CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' },
    });
    if (r.error) blocked(`cargo could not run for the merge base: ${r.error.message}`);
    expect(r.status, `the reference ${sha.slice(0, 12)}'s full build compiles in ${dir}: ${(r.stderr ?? '').slice(-3000)}`).toBe(0);
    execFileSync('cp', [join(dir, 'target', 'debug', 'deep-show'), bin]);
    baseBins.set(sha, bin);
  }
  return { sha, bin };
}

// ---------------------------------------------------------------------------------------------------
// A live match of two app copies through the shipped relay behind the door (#549's suite), and each step's message as
// the door saw it.

export interface LiveRun { one: Copy & { match: string }; two: Copy & { match: string }; messages: Map<string, Buffer> }
/** Two app copies of `bin` play `steps` match steps of the paddle piece through the shipped relay behind a door that
 * drops the signaling a direct path needs, so every frame crosses it. `messages`: each `<player>:<step>` message, the
 * first time a frame carried it. */
export async function liveRun(o: { bin: string; relayBin: string; certs: Certs; temp: () => string; closing: (f: () => Promise<void> | void) => void; steps: number; plays: Plays; what: string }): Promise<LiveRun> {
  const relay = await startRelay(o.relayBin, o.certs);
  o.closing(() => relay.stop());
  const door = await startDoor(relay.host, o.certs, { signals: false });
  o.closing(() => door.close());
  const program = courtProgram();
  const document = courtDoc(program, { relay: door.url, timeout: 120 });
  const stores: [string, string] = [o.temp(), o.temp()];
  for (const s of stores) putEvidence(s, program.bytes);
  const pair = await livePair({ bins: [o.bin, o.bin], stores, linkFile: join(o.temp(), 'link'), document, steps: o.steps, plays: o.plays, relayCa: o.certs.ca }, o.what);
  const one = playedOf(pair.one.reply, `${o.what}: the first copy`);
  const two = playedOf(pair.two.reply, `${o.what}: the second copy`);
  const messages = new Map<string, Buffer>();
  for (const c of door.connections) for (const m of c.sent) {
    if (m.kind !== 'binary') continue;
    const frame = frameOf(m.bytes);
    if (typeof frame === 'string') continue;
    frame.steps.forEach((b, k) => { const key = `${frame.seat + 1}:${frame.first + k}`; if (!messages.has(key)) messages.set(key, Buffer.from(b)); });
  }
  return { one, two, messages };
}
/** The forms a u64 hash given as 16 hex digits takes in a message: its hex text, its 8 bytes either way round, and
 * their base64. */
export function hashForms(hex: string): Buffer[] {
  const be = Buffer.from(hex, 'hex');
  const le = Buffer.from(be).reverse();
  return [Buffer.from(hex, 'latin1'), le, be, ...[le, be].flatMap((b) => [b.toString('base64'), b.toString('base64url'), b.toString('base64').replace(/=+$/, '')].map((t) => Buffer.from(t, 'latin1')))];
}
/** The step whose message, of `player`'s, carries the full-state hash `hex`: the first such step. */
export function carrierOf(messages: Map<string, Buffer>, player: number, hex: string): { step: number; bytes: Buffer } | null {
  const ways = hashForms(hex);
  let best: { step: number; bytes: Buffer } | null = null;
  for (const [key, bytes] of messages) {
    const [p, s] = key.split(':').map(Number);
    if (p !== player || !ways.some((w) => bytes.includes(w))) continue;
    if (!best || s! < best.step) best = { step: s!, bytes };
  }
  return best;
}

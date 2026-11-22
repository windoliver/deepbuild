// Test-side tools for the #552 acceptance tests (README: The surface under test). They reuse #549's suite for building
// `deep-show` and driving `deep-show run` without blocking this process, and #550's for reading a `match` reply's copies
// and comparing their full-state hashes; they add what #552's criteria read: each copy's view (its frame, pick tests and
// accessibility tree), the relay's log read as messages, the dice piece's arrays, guesses and draws, each copy's bursts
// and voices, the app's still exports, `logic`'s replay of a record, `deep-show screen`'s window and `deep-drive`'s
// play mode (#184's replica). Nothing here stands in for the net module, the view, a reader, the replica or a check:
// every frame, hit, node, message, roll, hash and report a test reads is the implementation's own, and every expected
// value comes from the issue, the design and fixtures.ts.

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { decodePng, encodeRgbaPng, type Image } from '../467/helpers.ts';
import {
  FULL, REPO, Script, TIMEOUT, arr, blocked, failsNaming, isObject, none, num, obj, presented, promptOf, putEvidence, runShow, show, str,
  useBuilds, useChildren, useTemp,
} from '../549/helpers.ts';
import { hashFailures, netCopiesOf, playedOnFailures, players, type NetCopy } from '../550/helpers.ts';
import {
  BURST, DICE, ENEMIES, ENEMY_COUNT, FLICKS, FOG_SIZE, GRENADES, GRID, RATE, SEEN_STATE, SKY_PX, STEP, VOICE, cellPx, cellState, enemyPx, seenAt, sha256,
  type DrivePlant, type JsonObject, type JsonValue, type Planted, type Plays, type Size,
} from './fixtures.ts';

export {
  FULL, REPO, Script, TIMEOUT, arr, failsNaming, hashFailures, isObject, none, num, obj, playedOnFailures, players, presented, promptOf, putEvidence,
  show, str, useBuilds, useChildren, useTemp, type Image, type NetCopy,
};

/** A `deep show` reply refused at check, every error naming `item` in its `ids` or its `path` (criterion 1's planted
 * logic item: its one fault is the read of match.me). */
export function refusedNaming(reply: JsonObject | undefined, item: string, what: string): string[] {
  const r = obj(reply, what);
  if (r['outcome'] === 'presented') return [`${what} is presented, not refused at check`];
  const errors = (Array.isArray(r['issues']) ? r['issues'] : []).filter(isObject).filter((i) => i['severity'] === 'error');
  if (errors.length === 0) return [`${what}: the refusal holds no error issue: ${show(r, 1200)}`];
  const names = (i: JsonObject): boolean => (Array.isArray(i['ids']) && i['ids'].includes(item)) || (typeof i['path'] === 'string' && i['path'].split('/').includes(item));
  return errors.filter((i) => !names(i)).map((i) => `${what}: an error that doesn't name ${item}: ${show(i, 600)}`);
}

/** Each criterion's ID: `#552.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
export const AC = {
  1: 'AC1 #552.1b7a8fff',
  2: 'AC2 #552.1430609d',
  3: 'AC3 #552.18ec780d',
  4: 'AC4 #552.6bdf52ad',
  5: 'AC5 #552.eff354f2',
  6: 'AC6 #552.5d140522',
  7: 'AC7 #552.84746f1a',
} as const;

/** A reading that can't be made here: the test fails with this, never passes (invariant 2). */
export const inconclusive = (why: string): never => { throw Error(`INCONCLUSIVE: ${why}; this is not a pass`); };
/** The GPU and the replica draw and play on macOS only (the reference platform). */
export function macOnly(): void {
  if (process.platform !== 'darwin') inconclusive(`the frames and the replica draw and play on macOS only; this is ${process.platform}`);
}

// ---------------------------------------------------------------------------------------------------
// `deep-show run`: #549's world (you and one agent's session, #383's virtual clock), each document on a panel of its
// own size; `window` puts the first document's panel in the reference window, as #548's check run does.

const AGENT = { id: 'sess-552', thread: 'thread-552', name: 'Test agent: shared play', process: { pid: 4100, start: 1_000 } } as const;
const PROCESSES: JsonObject[] = [
  { pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 },
  { pid: 4100, ppid: 3001, start: 1_000 }, { pid: 4101, ppid: 4100, start: 1_100 },
];
/** The reference window (technical design: the reference window): 1,512 × 982 points, its pictures at 2×. */
export const WINDOW: Size = [1512, 982];
export interface Shown { id: string; size: Size }
export function scenario(evidence: string, docs: Shown[], calls: JsonObject[], o: { planted?: Planted; window?: boolean } = {}): JsonObject {
  const panels: JsonObject = {};
  const byId: JsonObject = {};
  docs.forEach((d, k) => {
    const panel = k === 0 ? 'main' : `side-${k}`;
    panels[panel] = { rect: k === 0 && o.window ? [0, 0, ...WINDOW] : [0, 1100 * k, ...d.size] };
    byId[d.id] = { panel };
  });
  return {
    evidence, sessions: { [AGENT.id]: { thread: AGENT.thread, name: AGENT.name, process: { ...AGENT.process } } }, processes: PROCESSES,
    panels, docs: byId, clock: { refresh_hz: 60, lead: 0, check: 0 }, ...(o.window ? { display: [1728, 1117], window: WINDOW } : {}),
    ...(o.planted ? { planted: o.planted } : {}), calls,
  };
}
/** `deep-show run` on a scenario; one reply per call. */
export const run = (bin: string, sc: JsonObject, what: string): Promise<JsonObject[]> => runShow(bin, sc, what);

/**
 * README: `match`. #549's call with #550's members and this job's: `secure.seed` replaces each copy's platform secure
 * random source with a seeded test source; `views` asks for each named copy's view after a match step; `on_panel`
 * puts that copy on the document's panel after the match (criterion 7's window).
 */
export interface View { player: number; step: number; probes?: [number, number][] }
export interface MatchAsk { plays?: Plays; relay?: { seed: number; log?: boolean }; secure?: number; views?: View[]; onPanel?: number }
export function matchCall(doc: string, steps: number, o: MatchAsk = {}): JsonObject {
  return {
    call: 'match', doc, steps, ...(o.plays ? { plays: o.plays as unknown as JsonObject } : {}), ...(o.relay ? { relay: o.relay as unknown as JsonObject } : {}),
    ...(o.secure !== undefined ? { secure: { seed: o.secure } } : {}), ...(o.views ? { views: o.views as unknown as JsonValue[] } : {}),
    ...(o.onPanel !== undefined ? { on_panel: o.onPanel } : {}),
  };
}
/** A `match` reply's two copies, in player order. */
export function pairOf(reply: JsonObject | undefined, what: string): [NetCopy, NetCopy] {
  const [one, two] = players(netCopiesOf(reply, what), 2, what);
  return [one, two];
}

// ---------------------------------------------------------------------------------------------------
// A copy's view (README: `match`'s views): its frame as a PNG in the evidence store, its pick tests and its
// accessibility tree, as that copy shows the piece after a match step, through its own `match.me`.

export interface CopyView { player: number; step: number; me: JsonValue | undefined; image: Image | null; hits: JsonValue[][] | null; tree: JsonObject[] | null; raw: JsonObject }
/** The PNG named by its SHA-256 in an evidence store, decoded; null where there is none. */
export function stored(evidence: string, sha: JsonValue | undefined): Image | null {
  if (typeof sha !== 'string' || !/^[0-9a-f]{64}$/.test(sha)) return null;
  const path = join(evidence, sha.slice(0, 2), sha.slice(2));
  return existsSync(path) ? decodePng(readFileSync(path)) : null;
}
export function viewsOf(reply: JsonObject | undefined, evidence: string, what: string): CopyView[] {
  return arr(obj(reply, what)['views'], `${what}: views (README: \`match\`'s views)`).map((x, i) => {
    const v = obj(x, `${what}: views[${i}]`);
    return {
      player: num(v['player'], `${what}: views[${i}].player`), step: num(v['step'], `${what}: views[${i}].step`), me: v['me'], image: stored(evidence, v['snapshot']),
      hits: Array.isArray(v['hits']) ? v['hits'].map((h) => (Array.isArray(h) ? h : [])) : null,
      tree: Array.isArray(v['tree']) ? v['tree'].filter(isObject) : null, raw: v,
    };
  });
}
/** The IDs a hit names: a render-back hit `{item, sub}` names its item and, with `sub`, the element `<item>#<sub>`. */
function hitIds(h: JsonValue): string[] {
  if (typeof h === 'string') return [h];
  if (!isObject(h) || typeof h['item'] !== 'string') return [];
  const item = h['item'];
  const sub = typeof h['sub'] === 'string' || typeof h['sub'] === 'number' ? String(h['sub']) : '';
  return sub ? [item, sub.startsWith('#') ? `${item}${sub}` : `${item}#${sub}`] : [item];
}
export const pixel = (im: Image, [x, y]: [number, number]): [number, number, number] => {
  const o = (Math.min(im.height - 1, Math.max(0, y)) * im.width + Math.min(im.width - 1, Math.max(0, x))) * 4;
  return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!];
};
/** The largest difference of one channel between two pixels. */
export const apart = (a: readonly number[], b: readonly number[]): number => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));
const element = (i: number): RegExp => new RegExp(`^${ENEMIES}#${i}(\\.\\d+)?$`);
/** Enemy i as a failure names it: its element ID, generation 1. */
export const enemyId = (i: number): string => `${ENEMIES}#${i}.1`;
/** The probes criterion 1 asks each view for: each enemy's centre, in panel px. */
export const ENEMY_PROBES: [number, number][] = Array.from({ length: ENEMY_COUNT }, (_, i) => enemyPx(i));

/**
 * The fog piece's frames (criteria 1 and 2): at each enemy's centre the frame shows the enemy where `sees(i)`, else
 * the sky beside it. Enemy 0 (which every side sees) gives the enemy's color as drawn; it must stand apart from the sky.
 */
export function frameFailures(im: Image | null, size: Size, sees: (i: number) => boolean, what: string): string[] {
  if (!im) return [`${what}: no frame (a PNG in the evidence store)`];
  if (im.width !== size[0] || im.height !== size[1]) return [`${what}: the frame is ${im.width} × ${im.height}, not ${size[0]} × ${size[1]}`];
  const sky = pixel(im, SKY_PX);
  const drawn = pixel(im, enemyPx(0, size));
  if (apart(drawn, sky) < 48) return [`${what}: the frame draws no enemy at ${enemyId(0)}, which every side sees (${drawn.join(',')} against the sky's ${sky.join(',')})`];
  const f: string[] = [];
  for (let i = 0; i < ENEMY_COUNT; i++) {
    const p = pixel(im, enemyPx(i, size));
    if (sees(i) && apart(p, drawn) > 12) f.push(`${what} hides ${enemyId(i)} in its frame (${p.join(',')} at its centre), though that side sees it`);
    if (!sees(i) && apart(p, sky) > 12) f.push(`${what} draws ${enemyId(i)} in its frame (${p.join(',')} at its centre), though that side doesn't see it`);
  }
  return f;
}
/**
 * Criterion 1's judge of each copy's view after match step `step`: its `me` is its player, and its frame, its pick test
 * at each enemy's centre and its accessibility tree show exactly the enemies `seenAt` gives its player's bit. Each
 * failure names the copy and the enemy.
 */
export function viewFailures(views: readonly CopyView[], asked: readonly View[], what: string): string[] {
  const f: string[] = [];
  for (const a of asked) {
    const v = views.find((x) => x.player === a.player && x.step === a.step);
    const tag = `${what}: copy ${a.player} at step ${a.step}`;
    if (!v) { f.push(`${tag}: no view in the reply`); continue; }
    if (v.me !== a.player) f.push(`${tag}: its view reads match.me as ${show(v.me)}, not ${a.player}`);
    const sees = (i: number): boolean => ((seenAt(i, a.step) >> (a.player - 1)) & 1) === 1;
    f.push(...frameFailures(v.image, FOG_SIZE, sees, `copy ${a.player} at step ${a.step}`).map((x) => `${what}: ${x}`));
    if (!v.hits || v.hits.length !== ENEMY_COUNT) f.push(`${tag}: its pick tests give ${show(v.hits, 300)}, not one list a probe`);
    if (!v.tree) f.push(`${tag}: its view holds no accessibility tree (tree)`);
    for (let i = 0; i < ENEMY_COUNT; i++) {
      const ids = (v.hits?.[i] ?? []).flatMap(hitIds);
      if (v.hits && sees(i) && !ids.some((id) => element(i).test(id))) f.push(`${tag}: its pick test at ${enemyId(i)}'s centre misses it (hits ${show(v.hits[i], 300)}), though player ${a.player} sees it`);
      if (v.hits && !sees(i) && ids.some((id) => id === ENEMIES || element(i).test(id))) f.push(`${tag}: its pick test picks ${enemyId(i)} (hits ${show(v.hits[i], 300)}), though player ${a.player} doesn't see it`);
      const nodes = (v.tree ?? []).filter((n) => typeof n['id'] === 'string' && element(i).test(n['id']));
      if (v.tree && sees(i) && nodes.length === 0) f.push(`${tag}: its accessibility tree omits ${enemyId(i)}, though player ${a.player} sees it`);
      if (v.tree && !sees(i) && nodes.length > 0) f.push(`${tag}: its accessibility tree announces ${enemyId(i)}, though player ${a.player} doesn't see it`);
    }
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The relay's log as messages (README: The relay's log): each frame's steps, each as the net module's own codec reads
// it back, its members by name. The design's message is `{match, player, step, entries}` and the hashes (Net `net@1`);
// #550 adds how the copy ended and its locator's parts.

/** A message's members the design and #550 give it: anything else is something a message never holds. */
const MESSAGE_MEMBER = /^(match|player|step|entries|confirmed|end|ended|fault|track|locate[a-z_]*|[a-z_]*hash[a-z_]*)$/;
export function messageFailures(reply: JsonObject | undefined, what: string): string[] {
  const relay = obj(obj(reply, what)['relay'], `${what}: relay (the test relay's report)`);
  const log = arr(relay['log'], `${what}: relay.log`);
  if (log.length === 0) return [`${what}: the relay's log holds no frame`];
  const f: string[] = [];
  const said = new Set<string>();
  let messages = 0;
  for (const [i, x] of log.entries()) {
    const row = obj(x, `${what}: relay.log[${i}]`);
    if (!Array.isArray(row['messages'])) { f.push(`${what}: relay.log[${i}] gives no messages (README: The relay's log)`); if (f.length > 3) break; continue; }
    for (const m of row['messages']) {
      messages += 1;
      if (!isObject(m)) { f.push(`${what}: relay.log[${i}] holds a message that isn't an object: ${show(m, 200)}`); continue; }
      for (const [k, v] of Object.entries(m)) {
        if (MESSAGE_MEMBER.test(k) || said.has(`${String(row['player'])}:${k}`)) continue;
        said.add(`${String(row['player'])}:${k}`);
        f.push(`${what}: copy ${String(row['player'])}'s message for step ${show(m['step'])} carries the field ${k} (${show(v, 100)}), which a message never holds`);
      }
    }
  }
  if (messages === 0) f.push(`${what}: the relay's log holds no message`);
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The dice piece's arrays, from a copy's or a replay's step rows (#540's rows: `arrays["<logic>.<name>"]`).

export interface Dice { count: number; roll: number[]; lo: number[]; hi: number[]; step: number[]; drawn: number[] }
const NAMES = ['count', 'drawn', 'hi', 'lo', 'roll', 'step'] as const;
export function diceOf(arrays: JsonValue | undefined, what: string): Dice {
  const a = obj(arrays, `${what}: the arrays`);
  const list = (n: string): number[] => arr(a[`${DICE}.${n}`], `${what}: ${DICE}.${n}`).map((v, i) => num(v, `${what}: ${DICE}.${n}[${i}]`));
  return { count: list('count')[0] ?? Number.NaN, roll: list('roll'), lo: list('lo'), hi: list('hi'), step: list('step'), drawn: list('drawn') };
}
/** The last step row's dice arrays of a copy. */
export function lastDice(c: NetCopy, what: string): Dice {
  const rows = arr(c.raw['steps'], `${what}: copy ${c.player}'s steps`);
  return diceOf(obj(rows[rows.length - 1], `${what}: copy ${c.player}'s last step row`)['arrays'], `${what}: copy ${c.player}`);
}
/** Each step row's dice arrays, by step. */
export function diceRows(rows: JsonValue | undefined, what: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const r of arr(rows, `${what}: steps`).filter(isObject)) {
    const a = isObject(r['arrays']) ? r['arrays'] : {};
    out.set(num(r['step'], `${what}: a step row's step`), JSON.stringify(NAMES.map((n) => a[`${DICE}.${n}`] ?? null)));
  }
  return out;
}
/** A copy's guesses (the planted guesser's report: README, Planted twins): each attack's step and the roll it guessed. */
export function guessesOf(c: NetCopy, what: string): Map<number, number> {
  const out = new Map<number, number>();
  for (const [i, x] of arr(c.raw['guesses'], `${what}: copy ${c.player}'s guesses`).entries()) {
    const g = obj(x, `${what}: guesses[${i}]`);
    out.set(num(g['step'], `${what}: guesses[${i}].step`), num(g['roll'], `${what}: guesses[${i}].roll`));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------
// Each copy's bursts and voices (README: A copy's report, `effects`).

export interface Effect { reader: string; made: string; step: number; kind: string; a: number; b: number }
export function effectsOf(c: NetCopy, what: string): Effect[] {
  return arr(c.raw['effects'], `${what}: copy ${c.player}'s effects (README: A copy's report)`).map((x, i) => {
    const e = obj(x, `${what}: effects[${i}]`);
    return { reader: str(e['reader'], `${what}: effects[${i}].reader`), made: str(e['made'], `${what}: effects[${i}].made`), step: num(e['step'], `${what}: effects[${i}].step`), kind: str(e['kind'], `${what}: effects[${i}].kind`), a: num(e['a'], `${what}: effects[${i}].a`), b: num(e['b'], `${what}: effects[${i}].b`) };
  });
}
/** Criterion 6's judge of the grenades: on each copy, each grenade draws a burst of `sparks` and starts a voice of
 * `boom` where its player sees the grenade's cell, and neither in its fog. Each failure names the copy, the occurrence
 * and the step. */
export function effectFailures(copies: readonly NetCopy[], what: string): string[] {
  const f: string[] = [];
  for (const c of copies) {
    const effects = effectsOf(c, what);
    for (const g of GRENADES) {
      const sees = cellState(c.player as 1 | 2, ...g.cell) === SEEN_STATE;
      const of = effects.filter((e) => e.kind === 'grenade' && e.a === g.a && e.b === 0 && e.step === g.step);
      const tag = `copy ${c.player}`;
      const occ = `the grenade occurrence (a ${g.a}, b 0) at step ${g.step}, at cell (${g.cell.join(', ')})`;
      for (const [reader, made] of [[BURST, 'burst'], [VOICE, 'voice']] as const) {
        const has = of.some((e) => e.reader === reader && e.made === made);
        if (sees && !has) f.push(`${what}: ${tag} makes no ${made} of ${reader} for ${occ}, which player ${c.player} sees`);
        if (!sees && has) f.push(`${what}: ${tag} makes a ${made} of ${reader} for ${occ}, in player ${c.player}'s fog`);
      }
    }
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The war piece's fog over its 128 × 128 grid (criterion 6), judged from each copy's frame: every fourth cell's centre
// shows the overlay of that copy's own player's state there. The three states' colors are read from rows every side
// shares (both see rows 0 to 15; both have radar on rows 104 to 111; neither sees rows 112 on), so the judge holds no
// color of its own; seen must stand apart from unseen.

export function fogFailures(im: Image | null, player: 1 | 2, what: string): string[] {
  if (!im) return [`${what}: copy ${player}'s view has no frame (a PNG in the evidence store)`];
  if (im.width !== 1024 || im.height !== 1024) return [`${what}: copy ${player}'s frame is ${im.width} × ${im.height}, not 1024 × 1024`];
  const cells: [number, number][] = [];
  for (let cz = 2; cz < GRID; cz += 4) for (let cx = 2; cx < GRID; cx += 4) cells.push([cx, cz]);
  const mean = (list: [number, number][]): number[] => [0, 1, 2].map((ch) => list.reduce((s, c) => s + pixel(im, cellPx(...c))[ch]!, 0) / list.length);
  const ref = {
    [SEEN_STATE]: mean(cells.filter(([, cz]) => cz < 16)),
    1: mean(cells.filter(([, cz]) => cz >= 104 && cz < 112)),
    0: mean(cells.filter(([, cz]) => cz >= 112)),
  } as Record<number, number[]>;
  if (apart(ref[SEEN_STATE]!, ref[0]!) < 24) return [`${what}: copy ${player}'s frame draws no fog: the rows every side sees (${ref[SEEN_STATE]!.map(Math.round).join(',')}) and the rows none sees (${ref[0]!.map(Math.round).join(',')}) look alike`];
  if (apart(ref[1]!, ref[SEEN_STATE]!) < 8 || apart(ref[1]!, ref[0]!) < 8) return [`${what}: copy ${player}'s frame draws radar (${ref[1]!.map(Math.round).join(',')}) like seen or unseen`];
  const f: string[] = [];
  for (const [cx, cz] of cells) {
    const want = cellState(player, cx, cz);
    const got = pixel(im, cellPx(cx, cz));
    if (apart(got, ref[want]!) > 8) {
      const near = [0, 1, SEEN_STATE].reduce((b, s) => (apart(got, ref[s]!) < apart(got, ref[b]!) ? s : b), want);
      f.push(`${what}: copy ${player} draws cell (${cx}, ${cz}) as ${['unseen', 'radar', 'seen'][near]} (${got.join(',')}), not as player ${player}'s ${['unseen', 'radar', 'seen'][want]}`);
      if (f.length >= 8) break;
    }
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The app's still export (#501's png_seq still, as #169's suite exports one), of the piece alone or of a recorded match
// (README: `export`'s `record` and `me`): the one PNG it writes in `out`.

export const STILL_T = '5s';
export function exportCall(doc: string, out: string, size: Size, o: { record?: JsonValue; me?: number | 'none' } = {}): JsonObject {
  return {
    call: 'export', doc, out, video: { codec: 'png_seq' }, size, frame_rate: [60, 1], range: { still: { t: STILL_T } },
    ...(o.record !== undefined ? { record: o.record } : {}), ...(o.me !== undefined ? { me: o.me } : {}),
  };
}
function pngsUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? pngsUnder(p) : n.endsWith('.png') ? [p] : []; });
}
export function stillOf(reply: JsonObject | undefined, out: string, what: string): Image {
  const r = obj(reply, what);
  expect(r['outcome'], `${what} is exported: ${show(r, 1500)}`).toBe('exported');
  const files = pngsUnder(out);
  expect(files.length, `${what}: the export writes one PNG in ${out}, found ${files.join(', ')}`).toBe(1);
  return decodePng(readFileSync(files[0]!));
}

// ---------------------------------------------------------------------------------------------------
// `logic` (#539's call, with #548's `track`): the document's logic items stepped on the given track, here a match's
// record; this job adds `hashes`, the full-state hash every `hash_every` steps of the piece's net item.

export const replayCall = (doc: string, steps: number, track: JsonValue): JsonObject => ({ call: 'logic', doc, steps, track });
export function replayHashes(reply: JsonObject | undefined, what: string): { step: number; hash: string }[] {
  return arr(obj(reply, what)['hashes'], `${what}: hashes (README: \`logic\`'s hashes)`).map((x, i) => {
    const h = obj(x, `${what}: hashes[${i}]`);
    return { step: num(h['step'], `${what}: hashes[${i}].step`), hash: str(h['hash'], `${what}: hashes[${i}].hash`) };
  });
}

// ---------------------------------------------------------------------------------------------------
// `deep-show screen` (#1162): the scenario's calls run, then the app's window drawn at `t` flicks at `scale`, written to
// `out` (#548's check run).

export function screen(bin: string, sc: JsonObject, out: string, t: number, scale: number, what: string): Image {
  const r = spawnSync(bin, ['screen'], { cwd: REPO, input: `${JSON.stringify({ ...sc, out, t, scale })}\n`, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 1_800_000, killSignal: 'SIGKILL' });
  const stdout = (r.stdout ?? '').trim();
  let reply: JsonValue;
  try { reply = JSON.parse(stdout.split('\n').pop() ?? '') as JsonValue; } catch { reply = stdout.slice(0, 600); }
  if (isObject(reply) && reply['code'] === 'unsupported_platform') inconclusive(`${what}: the app's window draws on macOS; this is ${process.platform}`);
  const o = obj(reply, `${what}: deep-show screen's answer (stderr ${(r.stderr ?? '').slice(-800)})`);
  expect(o['ok'], `${what}: deep-show screen draws the window: ${show(o)}`).toBe(true);
  expect(existsSync(out), `${what}: the window's PNG is written`).toBe(true);
  return decodePng(readFileSync(out));
}
/** A picture's bytes, re-encoded so the same pixels always give the same bytes. */
export const pngBytes = (im: Image): Buffer => encodeRgbaPng(im.width, im.height, (x, y) => { const o = (y * im.width + x) * 4; return [im.rgba[o]!, im.rgba[o + 1]!, im.rgba[o + 2]!, im.rgba[o + 3]!]; });
export { sha256 };

// ---------------------------------------------------------------------------------------------------
// The replica (#184's `deep-drive`): built once a file with `env-plants`, so DEEP_DRIVE_PLANT names a planted program;
// one process a play, its HOME and out folder fresh, stopped by its PID.

const TARGET = process.env['CARGO_TARGET_DIR'] ? resolve(REPO, process.env['CARGO_TARGET_DIR']) : join(REPO, 'target');
export function useDrive(): () => string {
  let dir = '';
  let error = '';
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'deep-552-drive-'));
    const args = ['build', '--locked', '-p', 'deep-replica', '--bin', 'deep-drive', '--features', 'env-plants'];
    const r = spawnSync('cargo', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, CARGO_INCREMENTAL: process.env['CARGO_INCREMENTAL'] ?? '0', CARGO_PROFILE_DEV_DEBUG: process.env['CARGO_PROFILE_DEV_DEBUG'] ?? '0' } });
    if (r.error) error = `cargo could not run: ${r.error.message}`;
    else if (r.status !== 0) error = `cargo ${args.join(' ')} failed:\n${(r.stderr ?? '').split('\n').filter((l) => /error/.test(l)).slice(0, 12).join('\n')}`;
    else copyFileSync(join(TARGET, 'debug', 'deep-drive'), join(dir, 'deep-drive'));
  }, TIMEOUT);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  return () => {
    if (/cargo could not run/.test(error)) blocked(`${error}: this machine lacks the Rust toolchain`);
    expect(error, 'deep-drive builds with env-plants').toBe('');
    return join(dir, 'deep-drive');
  };
}
const drives = new Set<ChildProcess>();
afterEach(() => { for (const c of drives) c.kill('SIGKILL'); drives.clear(); });
/** One `play` call in a fresh `deep-drive --out <dir>` (with DEEP_DRIVE_PLANT = `plant`), its one reply. */
export async function drivePlay(bin: string, call: JsonObject, what: string, plant?: DrivePlant): Promise<JsonObject> {
  macOnly();
  const dir = mkdtempSync(join(tmpdir(), 'deep-552-replica-'));
  mkdirSync(join(dir, 'out')); mkdirSync(join(dir, 'home'));
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(dir, 'home') };
  delete env['DEEP_DRIVE_PLANT'];
  if (plant) env['DEEP_DRIVE_PLANT'] = plant;
  const child = spawn(bin, ['--out', join(dir, 'out')], { cwd: REPO, env, stdio: ['pipe', 'pipe', 'pipe'] });
  drives.add(child);
  const lines: JsonObject[] = [];
  let buffer = '';
  let stderr = '';
  let wake: (() => void) | null = null;
  child.stdout!.setEncoding('utf8').on('data', (d: string) => {
    buffer += d;
    for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
      const text = buffer.slice(0, i); buffer = buffer.slice(i + 1);
      try { lines.push(JSON.parse(text) as JsonObject); } catch { lines.push({ unparsed: text.slice(0, 400) }); }
      wake?.();
    }
  });
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-4000); });
  let exited = false;
  child.on('exit', () => { exited = true; wake?.(); });
  const next = async (n: number, ms: number): Promise<JsonObject> => {
    const until = Date.now() + ms;
    while (lines.length < n && !exited && Date.now() < until) await new Promise<void>((done) => { wake = done; setTimeout(done, 1000); });
    const line = lines[n - 1];
    if (!line) throw Error(`${what}: deep-drive gave no line ${n}${plant ? ` (DEEP_DRIVE_PLANT=${plant})` : ''}: ${stderr.slice(-1500)}`);
    return line;
  };
  try {
    const ready = await next(1, 300_000);
    expect(ready['ready'], `${what}: deep-drive says {"ready": true}: ${show(ready, 400)}`).toBe(true);
    child.stdin!.write(`${JSON.stringify(call)}\n`);
    return await next(2, 1_800_000);
  } finally {
    child.kill('SIGKILL');
    drives.delete(child);
    rmSync(dir, { recursive: true, force: true });
  }
}
/** A replica play's per-step arrays (#184's `values`), as text per step, and its recorded entries. */
export function playedOf(reply: JsonObject, what: string): { steps: string[]; entries: JsonObject[]; last: Dice } {
  expect(reply['ok'], `${what}: the replica plays the dice piece: ${show(reply, 1500)}`).toBe(true);
  const values = obj(reply['values'], `${what}: values`);
  const per = NAMES.map((n) => arr(values[`${DICE}.${n}`], `${what}: values["${DICE}.${n}"]`));
  const steps = per[0]!.map((_, k) => JSON.stringify(per.map((p) => p[k] ?? null)));
  const lastArrays: JsonObject = Object.fromEntries(NAMES.map((n, i) => [`${DICE}.${n}`, per[i]![per[i]!.length - 1] ?? null]));
  return { steps, entries: arr(reply['entries'], `${what}: entries`).filter(isObject), last: diceOf(lastArrays, `${what}: the last step`) };
}

/** The entry kind of a track entry: `draw.commit` and `draw.reveal` are the core's (Input track), written by `net`. */
export const drawKind = (e: JsonObject): string | null => {
  const k = e['kind'] ?? e['control'];
  return k === 'draw.commit' || k === 'draw.reveal' ? k : null;
};
/** The step of an entry's stamp. */
export const stampOf = (e: JsonObject): number => Number(e['t']) / STEP;
export { FLICKS, RATE };

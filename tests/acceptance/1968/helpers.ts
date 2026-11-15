// Test-side tools for the #1968 acceptance tests (README: The surface under test). `deep-show` (the default, full build
// set) is built and driven through #535's helpers (one JSON scenario on stdin, an evidence store, the PNGs the canvas
// stores), and the budget record is read with scripts/benchmark.mjs's own validator and judged through #224's helpers.
// This file adds what the issue needs on top: the documents (code items, the moving diff's film, a test run's terminal
// recording on a board), the reader of the film block's `diffs` (the one answer this suite adds to the base), each
// criterion's judge, and the clean model of the fixture's diff that the planted wrong programs are made from. Nothing
// here stands in for the text diff, the code item or the cell grid: every value a test judges comes from deep-show, and
// every expected value from the issue's and the design's words.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';
import {
  FLICKS, REPO, arr, isObject, num, obj, presented, runShow, scenario, show, showCall, type JsonObject, type JsonValue,
} from '../535/helpers.ts';

export {
  FLICKS, REPO, binOf, decodePng, encodeApng, failsNaming, getEvidence, none, obj, prebuild, presented, putEvidence, runShow,
  scenario, sha256, show, showCall, snapshotOf, str, useTemp, type Image, type JsonObject, type JsonValue,
} from '../535/helpers.ts';
export { inconclusive, judgeTask, load, standing, type Task } from '../224/helpers.ts';

/** Each criterion's tag: `#1968.` and the first 8 hex digits of the SHA-256 of its text, white space collapsed
 * (scripts/proof-change.mjs). */
export const AC = { 1: 'AC1 #1968.4bf4e5fe', 2: 'AC2 #1968.161c44a9', 3: 'AC3 #1968.84837e9c' } as const;
/** The bare ID, `#1968.xxxxxxxx`, of a tag. */
export const idOf = (tag: string): string => tag.split(' ')[1]!;
/** Each test may build deep-show first on a shared machine. */
export const TIMEOUT = 3_600_000;
/** Document IDs the hub minted (26 Crockford characters). */
export const DOC = (n: number): string => `01JB1968D${String(n).padStart(17, '0')}`;

/** Seconds as whole flicks. */
export const fl = (s: number): number => Math.round(s * FLICKS);
/** A time in flicks, for messages. */
export const secs = (t: number): string => `${Number((t / FLICKS).toFixed(4))} s`;
/** The 60 fps frames of [0 s, 1 s], both ends included. */
export const FRAMES_60: number[] = Array.from({ length: 61 }, (_, k) => (k * FLICKS) / 60);

/** Runs `make` once per file, keeping its value or its error: a run that failed fails every test that reads it, and is
 * never run again. */
export function memo<T>(make: () => T): () => T {
  let done: { value: T } | { error: unknown } | null = null;
  return () => {
    if (!done) { try { done = { value: make() }; } catch (error) { done = { error }; } }
    if ('error' in done) throw done.error;
    return done.value;
  };
}

// ---------------------------------------------------------------------------------------------------
// Code (README: The documents). The fixtures' highlighter, the agent's own in the design's words: one token per word,
// operator, punctuation mark, string or comment, classed by these lists. The fixtures are ASCII and hold no digit, so a
// character's index is its byte offset into raw, and honest numbers finds nothing to count.

export interface Token { from: number; to: number; class: string }
const KEYWORDS = new Set(['def', 'return', 'for', 'in', 'if', 'assert']);
const TYPES = new Set(['list', 'bool', 'None']);
const FUNCTIONS = new Set(['greet', 'send', 'print', 'upper']);
export function tokensOf(raw: string): Token[] {
  return [...raw.matchAll(/#[^\n]*|"[^"\n]*"|[A-Za-z_]+|->|[=+]|[^\sA-Za-z_]/g)].map((m) => {
    const s = m[0];
    const cls = s.startsWith('#') ? 'comment' : s.startsWith('"') ? 'string' : KEYWORDS.has(s) ? 'keyword' : TYPES.has(s) ? 'type'
      : FUNCTIONS.has(s) ? 'function' : /^[A-Za-z_]/.test(s) ? 'variable' : /^(->|=|\+)$/.test(s) ? 'operator' : 'punctuation';
    return { from: m.index, to: m.index + s.length, class: cls };
  });
}

export interface CodeOptions { size: number; lineHeight?: number; numbers?: boolean; highlight?: [number, number]; tokens?: Token[] }
/** A code item: `text@1` in the look's mono role and ink paint, with `code` and `raw` (Text `text@1`: code). */
export function codeItem(id: string, raw: string, at: [number, number], o: CodeOptions): JsonObject {
  return {
    id, kind: 'text@1', name: `Code ${id}`, order: `c${id}`, at: { pos: [at[0], at[1], 0] },
    params: {
      font: 'mono', size: o.size, ...(o.lineHeight === undefined ? {} : { line_height: o.lineHeight }), paint: { fill: { role: 'ink' } },
      code: {
        language: 'python', tokens: (o.tokens ?? tokensOf(raw)) as unknown as JsonValue,
        ...(o.numbers === false ? { numbers: false } : {}), ...(o.highlight ? { highlight: [{ lines: o.highlight }] } : {}),
      },
      raw,
    },
  };
}

export const PAGE: [number, number] = [640, 360];
/** A film of `size` u with a still 2D camera `cam` over the page (y down), its items and its other fields. */
export function film(id: string, title: string, size: [number, number], items: JsonObject[], extra: JsonObject = {}, span = '2s'): JsonObject {
  const cam: JsonObject = { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0', params: { projection: 'orthographic', target: [size[0] / 2, size[1] / 2, 0], view_width: size[0] } };
  return {
    format: 1, id, profile: 'film', title, description: `${title}, a document of the moving-diff acceptance tests.`, size, camera: 'cam',
    transport: { span }, items: Object.fromEntries([cam, ...items].map((i) => [String(i['id']), i])), ...extra,
  };
}
/** A text_diff from one code item to another over the 1 s window [0 s, 1 s], linear (README: The moving diff). */
export const textDiff = (from: string, to: string): JsonObject => ({ from, to, kind: 'text_diff', at: '0.5s', span: '1s', progress: 'linear' });

// ---------------------------------------------------------------------------------------------------
// The moving diff (README: The moving diff): a 3-line function and the 4-line one with `assert ready` inserted above its
// last two lines, whose `send(user, out)` becomes `send(user, err)`, both at one place, 20 u lines.

export const BEFORE = 'def greet(user):\n    send(user, out)\n    return user\n';
export const AFTER = 'def greet(user):\n    assert ready\n    send(user, err)\n    return user\n';
export const ORIGIN: [number, number] = [60, 60];
/** One line height, u: the criterion's 20 u line. */
export const LINE = 20;
/** The size whose default line height, 1.3 × size rounded, is also 20 u. */
export const DIFF_SIZE = 15.5;
export const DIFF = 'td';
export const diffFilm = (): JsonObject => film('moving-diff', 'A function before and after', PAGE, [
  codeItem('before', BEFORE, ORIGIN, { size: DIFF_SIZE, lineHeight: LINE, numbers: false }),
  codeItem('after', AFTER, ORIGIN, { size: DIFF_SIZE, lineHeight: LINE, numbers: false }),
], { transitions: { [DIFF]: textDiff('before', 'after') } });

/** The tokens `tokensOf` gives each side, by index (each `#tok:k`): checked against the highlighter in the tests. */
export const BEFORE_TOKENS = ['def', 'greet', '(', 'user', ')', ':', 'send', '(', 'user', ',', 'out', ')', 'return', 'user'];
export const AFTER_TOKENS = ['def', 'greet', '(', 'user', ')', ':', 'assert', 'ready', 'send', '(', 'user', ',', 'err', ')', 'return', 'user'];
/** The alignment the issue's words fix: kept tokens as [before k, after k]; lines align by a longest common subsequence
 * (the first and last kept), then tokens inside the changed lines (`send(user, out)` against `assert ready` and
 * `send(user, err)`, whose only common tokens are the call's), with no tie anywhere. */
export const KEPT: [number, number][] = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 8], [7, 9], [8, 10], [9, 11], [11, 13], [12, 14], [13, 15]];
/** `before`'s kept tokens on its last two lines (which move down a line) and on its first (which stays). */
export const LAST_TWO = [6, 7, 8, 9, 11, 12, 13];
/** The changed argument: `out` going, `err` coming; and the inserted line's tokens, `assert` and `ready`. */
export const ARG_OUT = 10;
export const ARG_IN = 12;
export const INSERTED = [6, 7];

// ---------------------------------------------------------------------------------------------------
// `diffs` (README: The surface under test): `eval {t, film: true}`'s film block gains `diffs.<transition>`, `{progress,
// tokens: [{from, to, box, opacity}]}`, each token of either item once.

export type Box = [number, number, number, number];
export interface Piece { from: number | null; to: number | null; box: Box; opacity: number }
export interface Diff { progress: number; pieces: Piece[] }
/** `film.diffs.<transition>`, each piece's token on each side read as its index k in `<item>#tok:k`. */
export function diffOf(film: JsonObject, transition: string, from: string, to: string, what: string): Diff {
  const d = obj(obj(film['diffs'], `${what}: film.diffs, the text diffs the film draws at t`)[transition], `${what}: film.diffs.${transition}`);
  const side = (v: JsonValue | undefined, item: string, k: string, i: number): number | null => {
    if (v === null) return null;
    const m = typeof v === 'string' ? new RegExp(`^${item}#tok:(\\d+)$`).exec(v) : null;
    expect(m !== null, `${what}: tokens[${i}].${k} is null or "${item}#tok:<k>", got ${show(v)}`).toBe(true);
    return Number(m![1]);
  };
  const pieces = arr(d['tokens'], `${what}: film.diffs.${transition}.tokens`).map((x, i): Piece => {
    const p = obj(x, `${what}: tokens[${i}]`);
    const b = arr(p['box'], `${what}: tokens[${i}].box`);
    expect(b.length, `${what}: tokens[${i}].box is [x, y, w, h]`).toBe(4);
    return {
      from: side(p['from'], from, 'from', i), to: side(p['to'], to, 'to', i),
      box: b.map((v, j) => num(v, `${what}: tokens[${i}].box[${j}]`)) as Box, opacity: num(p['opacity'], `${what}: tokens[${i}].opacity`),
    };
  });
  return { progress: num(d['progress'], `${what}: film.diffs.${transition}.progress`), pieces };
}

/** `document` shown by the agent's session and read by `eval {t, film: true}` at each of `times` in that order, in one
 * session: each time's film block. */
export function filmsAt(bin: string, evidence: string, document: JsonObject, times: readonly number[], what: string): JsonObject[] {
  const doc = DOC(1);
  const replies = runShow(bin, scenario(evidence, [doc], [showCall(doc, document), ...times.map((t) => ({ call: 'eval', doc, t, film: true }))]), what);
  presented(replies[0]!, what);
  return times.map((t, i) => {
    const r = replies[1 + i]!;
    expect(r['outcome'], `${what} at ${secs(t)} is evaluated: ${show(r)}`).toBe('evaluated');
    return obj(r['film'], `${what} at ${secs(t)}: film`);
  });
}

// ---------------------------------------------------------------------------------------------------
// AC1's judges, each a list of failures (empty: the criterion holds on what was read).

export interface Timed { t: number; diff: Diff }
/** Exactly, to a thousandth of a unit: f32 layout passes, any eased, partial or sideways move fails. */
const TOL = 1e-3;
const fmt = (v: number): string => `${Number(v.toFixed(4))}`;
const kept = (d: Diff, o: number, n: number): Piece[] => d.pieces.filter((p) => p.from === o && p.to === n);

/** The kept tokens of `before`'s last two lines move down by one line height times the progress (linear: t in seconds,
 * so 10 u at 0.5 s and 20 u at 1 s), never sideways; its first line's kept tokens stay. */
export function motionFailures(play: readonly Timed[]): string[] {
  const start = play.find((x) => x.t === 0);
  if (!start) return ['the play has no frame at 0 s'];
  const f: string[] = [];
  for (const { t, diff } of play) {
    for (const [o, n] of KEPT) {
      const a = kept(start.diff, o, n); const b = kept(diff, o, n);
      if (a.length !== 1 || b.length !== 1) { f.push(`at ${secs(t)} the kept token before#tok:${o} → after#tok:${n} is ${b.length} pieces, not one`); continue; }
      const want = LAST_TWO.includes(o) ? (LINE * t) / FLICKS : 0;
      const dx = b[0]!.box[0] - a[0]!.box[0]; const dy = b[0]!.box[1] - a[0]!.box[1];
      if (Math.abs(dy - want) > TOL || Math.abs(dx) > TOL) {
        const line = LAST_TWO.includes(o) ? 'a kept token of the last two lines' : 'a kept token of the first line';
        f.push(`at ${secs(t)} before#tok:${o} (${BEFORE_TOKENS[o]}, ${line}) has moved (${fmt(dx)}, ${fmt(dy)}) u from its place at 0 s, not (0, ${fmt(want)})`);
      }
    }
  }
  return f;
}

/** Each side's tokens once each; the kept ones exactly KEPT; only the inserted line's tokens and the changed argument's
 * new token come in from nothing, and only its old token goes. */
function alignmentFailures(d: Diff, when: string): string[] {
  const f: string[] = [];
  const count = (k: number, side: 'from' | 'to'): number => d.pieces.filter((p) => p[side] === k).length;
  BEFORE_TOKENS.forEach((s, k) => { if (count(k, 'from') !== 1) f.push(`${when} before#tok:${k} (${s}) is in ${count(k, 'from')} pieces, not one`); });
  AFTER_TOKENS.forEach((s, k) => { if (count(k, 'to') !== 1) f.push(`${when} after#tok:${k} (${s}) is in ${count(k, 'to')} pieces, not one`); });
  if (d.pieces.some((p) => (p.from ?? 0) >= BEFORE_TOKENS.length || (p.to ?? 0) >= AFTER_TOKENS.length || (p.from === null && p.to === null))) {
    f.push(`${when} a piece names no token of either item, or one past their lists`);
  }
  const list = (xs: number[]): string => JSON.stringify([...xs].sort((a, b) => a - b));
  const pairs = d.pieces.filter((p) => p.from !== null && p.to !== null).map((p) => `${p.from}→${p.to}`).sort();
  const want = KEPT.map(([o, n]) => `${o}→${n}`).sort();
  if (JSON.stringify(pairs) !== JSON.stringify(want)) f.push(`${when} the kept tokens (before → after) are ${JSON.stringify(pairs)}, not ${JSON.stringify(want)}`);
  const incoming = d.pieces.filter((p) => p.from === null).map((p) => p.to!);
  if (list(incoming) !== list([...INSERTED, ARG_IN])) f.push(`${when} the tokens that come in from nothing are after#tok ${list(incoming)}, not only the inserted line's ${list(INSERTED)} and the changed argument's ${ARG_IN}`);
  const outgoing = d.pieces.filter((p) => p.to === null).map((p) => p.from!);
  if (list(outgoing) !== list([ARG_OUT])) f.push(`${when} the tokens that go are before#tok ${list(outgoing)}, not only the changed argument's ${ARG_OUT}`);
  return f;
}

/** At every time read (in time order, 0 s and 1 s among them): the alignment; the kept tokens drawn whole; each of the
 * inserted line's tokens fading in (0 at 0 s, 1 at 1 s, never falling, partly drawn at some time); and the changed
 * argument cross-fading: `out` 1 → 0 as `err` 0 → 1, never turning back, their opacities summing to 1 at every time and
 * both partly drawn at some time. When in the window a fade runs is left open. */
export function fadeFailures(play: readonly Timed[]): string[] {
  const f = play.flatMap(({ t, diff }) => alignmentFailures(diff, `at ${secs(t)}`));
  if (f.length) return f.slice(0, 20);
  const near = (v: number, w: number): boolean => Math.abs(v - w) <= 0.01;
  const between = (v: number): boolean => v > 0.01 && v < 0.99;
  const ends = (xs: number[]): string => `${fmt(xs[0]!)} at 0 s and ${fmt(xs[xs.length - 1]!)} at 1 s`;
  const opacities = (side: 'from' | 'to', k: number): number[] => play.map(({ diff }) => diff.pieces.find((p) => p[side] === k && (side === 'from' ? p.to === null : p.from === null))!.opacity);
  const rising = (xs: number[]): boolean => xs.every((v, i) => i === 0 || v >= xs[i - 1]! - 1e-9);
  if (play[0]?.t !== 0 || play[play.length - 1]?.t !== FLICKS) return ['the times read run from 0 s to 1 s'];
  for (const { t, diff } of play) {
    for (const [o, n] of KEPT) { const p = kept(diff, o, n)[0]!; if (!near(p.opacity, 1)) f.push(`at ${secs(t)} the kept token before#tok:${o} → after#tok:${n} is drawn at opacity ${fmt(p.opacity)}, not 1`); }
  }
  for (const k of INSERTED) {
    const xs = opacities('to', k);
    if (!near(xs[0]!, 0) || !near(xs[xs.length - 1]!, 1) || !rising(xs) || !xs.some(between)) {
      f.push(`the inserted line's after#tok:${k} (${AFTER_TOKENS[k]}) is at opacity ${ends(xs)}, ${rising(xs) ? 'rising' : 'not always rising'}, ${xs.some(between) ? '' : 'never '}partly drawn: it doesn't fade in`);
    }
  }
  const [out, inn] = [opacities('from', ARG_OUT), opacities('to', ARG_IN)];
  if (!near(out[0]!, 1) || !near(out[out.length - 1]!, 0) || !near(inn[0]!, 0) || !near(inn[inn.length - 1]!, 1) || !rising(inn) || !rising(out.map((v) => -v))) {
    f.push(`the changed argument's out is at ${ends(out)} and its err at ${ends(inn)}: not out falling 1 → 0 as err rises 0 → 1`);
  }
  const apart = play.filter((_, i) => !near(out[i]! + inn[i]!, 1)).map(({ t }) => secs(t));
  if (apart.length || !out.some((v, i) => between(v) && between(inn[i]!))) {
    f.push(`the changed argument is not a cross-fade: ${apart.length ? `its opacities don't sum to 1 at ${apart.slice(0, 5).join(', ')}` : 'out and err are never both partly drawn'}`);
  }
  return f;
}

/** Each time's `diffs` entry sought (read out of order) equals the one played (read in order), bit for bit. */
export function seekFailures(play: ReadonlyMap<number, string>, seek: ReadonlyMap<number, string>): string[] {
  const f: string[] = [];
  for (const [t, p] of play) {
    const s = seek.get(t);
    if (s !== p) f.push(`at ${secs(t)} the seek reads ${String(s).slice(0, 300)} but the play ${p.slice(0, 300)}`);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------
// The clean model of the fixture's diff (README: Wrong programs): boxes on a 9 u grid, kept tokens moving linearly to
// their new places, the inserted and the changed tokens fading. The judges must pass it; each plant changes one thing.

interface Place { row: number; col: number; len: number }
const placesOf = (raw: string): Place[] => tokensOf(raw).map((t) => {
  const start = raw.lastIndexOf('\n', t.from - 1) + 1;
  return { row: raw.slice(0, t.from).split('\n').length - 1, col: t.from - start, len: t.to - t.from };
});
const boxOf = (p: Place): Box => [ORIGIN[0] + p.col * 9, ORIGIN[1] + p.row * LINE, p.len * 9, LINE];
const lerp = (a: Box, b: Box, p: number): Box => a.map((v, i) => v + (b[i]! - v) * p) as Box;
export function modelAt(t: number): Diff {
  const p = Math.min(1, Math.max(0, t / FLICKS));
  const [b, a] = [placesOf(BEFORE), placesOf(AFTER)];
  return {
    progress: p,
    pieces: [
      ...KEPT.map(([o, n]): Piece => ({ from: o, to: n, box: lerp(boxOf(b[o]!), boxOf(a[n]!), p), opacity: 1 })),
      { from: ARG_OUT, to: null, box: boxOf(b[ARG_OUT]!), opacity: 1 - p },
      ...[...INSERTED, ARG_IN].map((n): Piece => ({ from: null, to: n, box: boxOf(a[n]!), opacity: p })),
    ],
  };
}
const easeInOutCubic = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
/** Planted wrong programs as answers at t, each from the clean model. */
export const PLANTS = {
  /** Kept tokens move on the look's default ease, not the linear progress. */
  eased: (t: number): Diff => {
    const m = modelAt(t); const [b, a] = [placesOf(BEFORE), placesOf(AFTER)];
    return { ...m, pieces: m.pieces.map((q) => (q.from !== null && q.to !== null ? { ...q, box: lerp(boxOf(b[q.from]!), boxOf(a[q.to]!), easeInOutCubic(m.progress)) } : q)) };
  },
  /** Every line slides down, the first one too. */
  allSlide: (t: number): Diff => {
    const m = modelAt(t);
    return { ...m, pieces: m.pieces.map((q) => (q.from !== null && q.to !== null && !LAST_TWO.includes(q.from) ? { ...q, box: [q.box[0], q.box[1] + LINE * m.progress, q.box[2], q.box[3]] as Box } : q)) };
  },
  /** The changed line's kept tokens go to the inserted line's row (the line pairs by position), so they don't move. */
  pairedByPosition: (t: number): Diff => {
    const m = modelAt(t);
    return { ...m, pieces: m.pieces.map((q) => (q.from !== null && q.to !== null && [6, 7, 8, 9, 11].includes(q.from) ? { ...q, box: boxOf(placesOf(BEFORE)[q.from]!) } : q)) };
  },
  /** Kept tokens jump to their new places halfway. */
  jump: (t: number): Diff => {
    const m = modelAt(t); const [b, a] = [placesOf(BEFORE), placesOf(AFTER)];
    return { ...m, pieces: m.pieces.map((q) => (q.from !== null && q.to !== null ? { ...q, box: m.progress < 0.5 ? boxOf(b[q.from]!) : boxOf(a[q.to]!) } : q)) };
  },
  /** No token is kept: the whole old item fades out as the new one fades in. */
  wholeCrossFade: (t: number): Diff => {
    const m = modelAt(t); const [b, a] = [placesOf(BEFORE), placesOf(AFTER)];
    return { ...m, pieces: [...b.map((x, k): Piece => ({ from: k, to: null, box: boxOf(x), opacity: 1 - m.progress })), ...a.map((x, k): Piece => ({ from: null, to: k, box: boxOf(x), opacity: m.progress }))] };
  },
  /** The inserted line shows whole from the start. */
  insertedAtOnce: (t: number): Diff => {
    const m = modelAt(t);
    return { ...m, pieces: m.pieces.map((q) => (q.from === null && q.to !== null && INSERTED.includes(q.to) ? { ...q, opacity: 1 } : q)) };
  },
  /** The inserted line appears only as the window ends. */
  insertedAtEnd: (t: number): Diff => {
    const m = modelAt(t);
    return { ...m, pieces: m.pieces.map((q) => (q.from === null && q.to !== null && INSERTED.includes(q.to) ? { ...q, opacity: m.progress >= 1 ? 1 : 0 } : q)) };
  },
  /** The changed argument swaps at the halfway point instead of cross-fading. */
  swappedAtHalf: (t: number): Diff => {
    const m = modelAt(t); const on = m.progress >= 0.5 ? 1 : 0;
    return { ...m, pieces: m.pieces.map((q) => (q.to === null ? { ...q, opacity: 1 - on } : q.from === null && q.to === ARG_IN ? { ...q, opacity: on } : q)) };
  },
  /** The changed argument dips: out fades over the first half, err in over the second, both gone halfway. */
  dips: (t: number): Diff => {
    const m = modelAt(t); const p = m.progress;
    return { ...m, pieces: m.pieces.map((q) => (q.to === null ? { ...q, opacity: Math.max(0, 1 - 2 * p) } : q.from === null && q.to === ARG_IN ? { ...q, opacity: Math.max(0, 2 * p - 1) } : q)) };
  },
  /** The changed argument is kept and moved, its bytes not compared. */
  argumentKept: (t: number): Diff => {
    const m = modelAt(t);
    return { ...m, pieces: [...m.pieces.filter((q) => q.to !== null && q.to !== ARG_IN), { from: ARG_OUT, to: ARG_IN, box: m.pieces.find((q) => q.from === ARG_OUT)!.box, opacity: 1 }] };
  },
} as const;

// ---------------------------------------------------------------------------------------------------
// AC2: the budget record (docs/parallel-proof.md §12a) and the still code item's per-frame cost as a count.

/** The task the budget window measures for criterion 2 (README: The budget record). */
export const CODE_FILM_TASK = {
  id: 'canvas-code-film', command: ['node', 'benchmarks/canvas.mjs', 'code-film'],
  targets: { tokens_2000_lines_ms: 5, diff_400_lines_ms: 20, seek_10_min_ms: 5, still_code_steps: 0 },
};
interface Bench { validateBudgets: (current: unknown, base: unknown) => void }
const bench = async (): Promise<Bench> => (await import(join(REPO, 'scripts', 'benchmark.mjs'))) as Bench;
/** The checkout's benchmarks/budgets.json, and its merge base's (`git merge-base HEAD origin/main`). */
export function budgetFiles(): { current: JsonObject; base: JsonObject } {
  const current = JSON.parse(readFileSync(join(REPO, 'benchmarks', 'budgets.json'), 'utf8')) as JsonObject;
  const mb = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: REPO, encoding: 'utf8' });
  expect(mb.status, `git merge-base HEAD origin/main: ${mb.stderr}`).toBe(0);
  const base = spawnSync('git', ['show', `${mb.stdout.trim()}:benchmarks/budgets.json`], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  expect(base.status, `the merge base's benchmarks/budgets.json: ${base.stderr}`).toBe(0);
  return { current, base: JSON.parse(base.stdout) as JsonObject };
}
/** What keeps `current` from recording `task` for `criterion` as the budget window reads it, against `base`. */
export async function recordFailures(current: JsonObject, base: JsonObject, task: typeof CODE_FILM_TASK, criterion: string): Promise<string[]> {
  const f: string[] = [];
  const entry = (Array.isArray(current['tasks']) ? current['tasks'] : []).filter(isObject).find((t) => t['id'] === task.id);
  if (!entry) return [`benchmarks/budgets.json has no task ${task.id}`];
  if (JSON.stringify(entry['command']) !== JSON.stringify(task.command)) f.push(`${task.id} runs ${show(entry['command'])}, not ${show(task.command)}`);
  const sorted = (o: JsonValue | undefined): string => JSON.stringify(isObject(o) ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : o);
  if (sorted(entry['targets']) !== sorted(task.targets)) f.push(`${task.id} holds the targets ${show(entry['targets'])}, not the issue's numbers ${show(task.targets)}`);
  if (entry['margin'] !== 0.5) f.push(`${task.id} compares with the merge base at margin ${show(entry['margin'])}, not the lane's 0.5`);
  if (!Array.isArray(entry['criteria']) || !entry['criteria'].includes(criterion)) f.push(`${task.id} doesn't name ${criterion} among its criteria, so the budget window never measures it`);
  if (!/#1968\b/.test(String(entry['initialReason'] ?? ''))) f.push(`${task.id}'s initialReason doesn't name #1968`);
  try { (await bench()).validateBudgets(current, base); } catch (e) { f.push(`the lane's validator refuses budgets.json against the merge base's: ${String(e)}`); }
  return f;
}

/** The steps a still code item costs after the first frame: each frame's `ran` with it less `ran` without it, frames 2
 * to 6 (the canvas-ground and game-state counts' reading). Frames must be six readings each. */
export function stillSteps(withCode: readonly number[], without: readonly number[]): { steps: number; failures: string[] } {
  if (withCode.length !== 6 || without.length !== 6 || [...withCode, ...without].some((v) => !Number.isInteger(v) || v < 0)) {
    return { steps: Number.NaN, failures: [`a count is six frames' ran a side, got ${JSON.stringify(withCode)} and ${JSON.stringify(without)}`] };
  }
  const steps = withCode.slice(1).reduce((n, r, k) => n + Math.max(0, r - without[k + 1]!), 0);
  return { steps, failures: steps === 0 ? [] : [`the still code item runs ${steps} steps over frames 2 to 6 (with it ${JSON.stringify(withCode)}, without it ${JSON.stringify(without)}), not none`] };
}

/** The still code item AC2 counts and AC3 photographs: a function with eight token roles and a highlight on lines 3 to
 * 5 (the default treatment, dim_others), its lines numbered. */
export const SHOWN = [
  'def greet(names: list, loud: bool) -> None:',
  '    # say hello to every name',
  '    for name in names:',
  '        line = "hello, " + name',
  '        if loud:',
  '            line = line.upper()',
  '        print(line)',
].join('\n') + '\n';
export const shownItem = (): JsonObject => codeItem('shown', SHOWN, [60, 60], { size: 18, highlight: [3, 5] });
/** A film with something moving every frame (a dot keyed across the page), with the still code item or without it. */
export function stillFilm(withCode: boolean): JsonObject {
  const dot: JsonObject = { id: 'dot', kind: 'rect@1', name: 'Dot', order: 'b0', params: { box: [0, 0, 12, 12], paint: { fill: { role: 'ink' } } }, at: { pos: [20, 330, 0] } };
  const key = (t: string, x: number): JsonObject => ({ t, value: [x, 330, 0], interp: 'linear' });
  return film(withCode ? 'still-code' : 'no-code', withCode ? 'A still function beside a moving dot' : 'A moving dot', PAGE, [dot, ...(withCode ? [shownItem()] : [])], {
    channels: { slide: { target: 'items/dot/at/pos', type: 'vec3', keys: { k0: key('0s', 20), k1: key('2s', 600) } } },
  });
}

// ---------------------------------------------------------------------------------------------------
// AC3: a test run's terminal recording (#1967's format: JSON lines, the size first, then `{at, text}` chunks in flicks)
// played by a board's cell grid, and the one taste call read from the file DEEPBUILD_TASTE_1968 names.

const TERMINAL_ROLES = [
  'term_black', 'term_red', 'term_green', 'term_yellow', 'term_blue', 'term_magenta', 'term_cyan', 'term_white',
  'term_bright_black', 'term_bright_red', 'term_bright_green', 'term_bright_yellow', 'term_bright_blue', 'term_bright_magenta', 'term_bright_cyan', 'term_bright_white',
];
const RUN: [number, string][] = [
  [0.2, '$ pytest tests/test_greet.py\r\n'],
  [0.6, 'test_says_hello \u001b[32mPASSED\u001b[0m\r\n'],
  [1.0, 'test_shouts_when_loud \u001b[32mPASSED\u001b[0m\r\n'],
  [1.4, '\u001b[1;32mall tests passed\u001b[0m\r\n'],
];
export const recordingBytes = (): Buffer =>
  Buffer.from(`${[JSON.stringify({ cols: 64, rows: 14 }), ...RUN.map(([s, text]) => JSON.stringify({ at: fl(s), text }))].join('\n')}\n`, 'utf8');
/** A board whose cell grid `run` plays the recording `sha` from 0 s at its own rate. */
export function terminalBoard(sha: string): JsonObject {
  return {
    format: 1, id: 'test-run', profile: 'board', title: 'A test run replayed', description: 'The change\'s test run, replayed from a terminal recording in a cell grid.',
    size: PAGE, transport: { span: '3s', frame_rate: [30, 1] }, requires: { modules: { cells: '^1' } },
    items: {
      run: {
        id: 'run', kind: 'cells@1', name: 'Test run', order: 'a1', at: { pos: [64, 68, 0] },
        params: {
          size: { cols: 64, rows: 14, cell: [8, 16] }, font: { family: 'mono', size: 13, fallback: [], ligatures: false },
          palette: { fg: 'ink', bg: 'ground', ansi: TERMINAL_ROLES, truecolor: true }, play: { asset: sha, start: '0s', in: 0, rate: [1, 1] },
        },
      },
    },
    assets: { rec: { sha256: sha, license: { id: 'CC0-1.0', terms: 'Public domain dedication.', shareable: true, credit: 'Test fixture made by the moving-diff acceptance tests.' } } },
  };
}
/** The still code item on a board of its own. */
export const codeBoard = (): JsonObject => ({
  format: 1, id: 'code-roles', profile: 'board', title: 'A function in its token roles', description: 'A code item with its token roles and a highlight on lines 3 to 5.',
  size: PAGE, items: { shown: shownItem() },
});

export interface TasteRecord { criterion?: string; by?: string; screenshots?: string[]; recordings?: string[]; call?: string }
/** The recorded call on exactly these files: PASS on `looks_right`, FAIL on `looks_wrong`, INCONCLUSIVE with none or
 * with one made on other files or by anyone but you. */
export function tasteVerdict(record: TasteRecord | null, screenshots: string[], recordings: string[]): { status: 'PASS' | 'FAIL' | 'INCONCLUSIVE'; reason: string } {
  const files = `screenshots ${screenshots.join(', ')}; recording ${recordings.join(', ')}`;
  if (!record) return { status: 'INCONCLUSIVE', reason: `no taste call is recorded on these files (${files}); record yours in a file named by DEEPBUILD_TASTE_1968` };
  const same = (a: string[] | undefined, b: string[]): boolean => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...b].sort());
  if (record.criterion !== idOf(AC[3]) || record.by !== 'you' || !same(record.screenshots, screenshots) || !same(record.recordings, recordings)) {
    return { status: 'INCONCLUSIVE', reason: `the recorded taste call isn't yours on these files (${files})` };
  }
  if (record.call === 'looks_right') return { status: 'PASS', reason: 'your taste call: looks right' };
  return { status: 'FAIL', reason: `your taste call is ${String(record.call)}, not looks_right` };
}

import { describe, expect, it } from 'vitest';
import { LOOK, RENDER_BIN, arr, batch, canonical, clone, fixture, num, obj, render, sec, useBinaries, type JsonObject, type JsonValue } from './helpers.ts';

useBinaries('deep-canvas-render');

const BOARD = fixture('parity/2d/patch-equals-rebuild.board');
const HANDLE = 'reading:01JB0000000000000000000000';
const FRAMES = 5;

interface State { doc: JsonObject; t: number; view: { zoom: number; theme: string }; readings: Record<string, number> }

/** One cache entry as the session reports it: which item or layer, its bucket (tessellation only), key, length and hash. */
interface Entry { id: string; bucket: number | null; key: string; len: number; sha256: string }
interface Dump { tessellation: Map<string, Entry>; text: Map<string, Entry>; layers: Map<string, Entry> }
type CacheName = keyof Dump;
const CACHES: CacheName[] = ['tessellation', 'text', 'layers'];

function entries(value: JsonValue | undefined, cache: CacheName, what: string): Map<string, Entry> {
  const map = new Map<string, Entry>();
  arr(value, `${what}.${cache}`).forEach((raw, i) => {
    const e = obj(raw, `${what}.${cache}[${i}]`);
    const id = cache === 'layers' ? e['layer'] : e['item'];
    expect(typeof id, `${what}.${cache}[${i}] names its ${cache === 'layers' ? 'layer' : 'item'}`).toBe('string');
    const bucket = cache === 'tessellation' ? num(e['bucket'], `${what}.${cache}[${i}].bucket`) : null;
    const key = e['key'];
    const sha = e['sha256'];
    expect(typeof key === 'string' && /^[0-9a-f]{32}$/.test(key), `${what}.${cache}[${i}].key is a 128-bit content key in hex, got ${JSON.stringify(key)}`).toBe(true);
    expect(typeof sha === 'string' && /^[0-9a-f]{64}$/.test(sha), `${what}.${cache}[${i}].sha256 is 64 hex digits, got ${JSON.stringify(sha)}`).toBe(true);
    const len = num(e['len'], `${what}.${cache}[${i}].len`);
    expect(len > 0, `${what}.${cache}[${i}] holds bytes`).toBe(true);
    const name = `${id as string}${bucket === null ? '' : `@${bucket}`}`;
    expect(map.has(name), `${what}.${cache} lists ${name} once`).toBe(false);
    map.set(name, { id: id as string, bucket, key: key as string, len, sha256: sha as string });
  });
  return map;
}

function dumpOf(step: JsonValue | undefined, what: string): Dump {
  const caches = obj(obj(step, what)['caches'], `${what}.caches`);
  return {
    tessellation: entries(caches['tessellation'], 'tessellation', what),
    text: entries(caches['text'], 'text', what),
    layers: entries(caches['layers'], 'layers', what),
  };
}

/** The first difference between a warm session's caches and a clean rebuild's, named by cache and entry. */
function difference(warm: Dump, clean: Dump): string | null {
  for (const cache of CACHES) {
    const names = [...new Set([...warm[cache].keys(), ...clean[cache].keys()])].sort();
    for (const name of names) {
      const w = warm[cache].get(name);
      const c = clean[cache].get(name);
      if (canonical(w as unknown as JsonValue) !== canonical(c as unknown as JsonValue)) {
        return `${cache} entry ${name}: the warm session has ${JSON.stringify(w ?? null)}, a clean rebuild has ${JSON.stringify(c ?? null)}`;
      }
    }
  }
  return null;
}

const item = (doc: JsonObject, id: string): JsonObject => obj(obj(doc['items'], 'items')[id], `items.${id}`);
const params = (doc: JsonObject, id: string): JsonObject => obj(item(doc, id)['params'], `items.${id}.params`);

/** The entries one cache holds for one item or layer (a tessellation may hold one per bucket). */
const of = (d: Dump, cache: CacheName, id: string): Entry[] => [...d[cache].values()].filter((e) => e.id === id);
const bytesOf = (d: Dump, cache: CacheName, id: string): string => canonical(of(d, cache, id).map((e) => [e.bucket, e.sha256]));

const changed = (cache: CacheName, id: string) => (before: Dump, after: Dump): string | null => {
  if (of(before, cache, id).length === 0 || of(after, cache, id).length === 0) {
    return `${cache} has no entry for ${id} ${of(before, cache, id).length === 0 ? 'before' : 'after'} the change`;
  }
  return bytesOf(before, cache, id) !== bytesOf(after, cache, id) ? null : `${cache} holds the same bytes for ${id} before and after the change`;
};
const gone = (cache: CacheName, id: string) => (before: Dump, after: Dump): string | null =>
  of(before, cache, id).length > 0 && of(after, cache, id).length === 0 ? null : `${cache} should hold ${id} before the change and not after it`;
const appeared = (cache: CacheName, id: string) => (before: Dump, after: Dump): string | null =>
  of(before, cache, id).length === 0 && of(after, cache, id).length > 0 ? null : `${cache} should hold ${id} after the change and not before it`;

interface Change { name: string; apply: (s: State) => void; affects: ((before: Dump, after: Dump) => string | null) | null }

// Each kind of change the 2D slice's dirty classes name (Dirty classes: transform, geometry, shading,
// presence, text, reading, time), plus the two view inputs its caches are keyed by: the zoom bucket a
// tessellation is cached at and the theme every cache key includes (Path; Paint).
const CHANGES: Change[] = [
  { name: 'time: only t moves on', apply: () => {}, affects: null },
  { name: 'transform: the card moves', apply: (s) => { item(s.doc, 'card')['at'] = { pos: [40, 0, 0] }; }, affects: changed('layers', 'board') },
  { name: 'geometry: the route is reshaped', apply: (s) => { params(s.doc, 'route')['d'] = 'M 32 160 C 100 60 220 240 300 150 L 440 210'; }, affects: changed('tessellation', 'route') },
  { name: 'shading: the badge takes another role', apply: (s) => { params(s.doc, 'badge')['paint'] = { fill: { role: 'accent' } }; }, affects: changed('layers', 'board') },
  { name: 'text: the title is rewritten', apply: (s) => { params(s.doc, 'title')['text'] = 'Blocked on review'; }, affects: changed('text', 'title') },
  { name: 'text: the title is resized', apply: (s) => { params(s.doc, 'title')['size'] = 20; }, affects: changed('text', 'title') },
  { name: 'reading: the bound count changes', apply: (s) => { s.readings[HANDLE] = 98765; }, affects: changed('text', 'count') },
  { name: 'presence: the arrow is hidden', apply: (s) => { item(s.doc, 'arrow')['visible'] = false; }, affects: gone('tessellation', 'arrow') },
  {
    name: 'presence: a pin is created',
    apply: (s) => {
      obj(s.doc['items'], 'items')['pin'] = {
        id: 'pin', kind: 'path@1', layer: 'board', name: 'Pin', order: 'a8',
        params: { d: 'M 380 120 L 392 140 L 368 140 Z', paint: { fill: { role: 'accent' } } },
      };
    },
    affects: appeared('tessellation', 'pin'),
  },
  { name: 'presence: the note is deleted', apply: (s) => { delete obj(s.doc['items'], 'items')['note']; }, affects: gone('text', 'note') },
  { name: 'view: zoom 1 to 2.5, across a bucket', apply: (s) => { s.view.zoom = 2.5; }, affects: changed('tessellation', 'route') },
  { name: 'view: the theme turns dark', apply: (s) => { s.view.theme = 'dark'; }, affects: changed('layers', 'board') },
];

/** Every state of the run: the opening state, then one per change, each 0.1 s (6 vsyncs) after the last. */
function states(): State[] {
  const list: State[] = [{ doc: clone(BOARD), t: sec(1), view: { zoom: 1, theme: 'light' }, readings: { [HANDLE]: 1234 } }];
  CHANGES.forEach((change, k) => {
    const prev = list[k]!;
    const next: State = { doc: clone(prev.doc), t: sec(1) + (k + 1) * sec(0.1), view: { ...prev.view }, readings: { ...prev.readings } };
    change.apply(next);
    list.push(next);
  });
  return list;
}

const stepOf = (s: State): JsonObject => ({ doc: s.doc, t: s.t, view: s.view, readings: s.readings, frames: FRAMES });

/**
 * A clean rebuild of each state, each in its own process, so no cache of the warm session or of another
 * rebuild exists (equal content keys share results across sessions of one process). Computed once.
 */
let rebuilt: Dump[] | null = null;
function cleanRebuilds(run: State[]): Dump[] {
  rebuilt ??= run.map((s, k) => {
    const out = render('session', { look: LOOK, steps: [stepOf(s)] });
    const steps = arr(out['steps'], `clean ${k}: steps`);
    expect(steps.length, `clean ${k}: one step`).toBe(1);
    return dumpOf(steps[0], `clean step ${k}`);
  });
  return rebuilt;
}

describe('AC2 parity/2d/patch-equals-rebuild.board: after each kind of change, the cached output equals a clean rebuild byte for byte', () => {
  it('AC2 tessellation, shaped text and writer-layer caches of one session through every change equal a clean rebuild in a fresh process', () => {
    const run = states();
    // One session takes every state in turn as whole revisions (R1: whole revisions through deep_show).
    const warmOut = render('session', { look: LOOK, steps: run.map(stepOf) });
    const warmSteps = arr(warmOut['steps'], 'session: steps');
    expect(warmSteps.length, 'session: one result per step').toBe(run.length);
    const warm = warmSteps.map((s, k) => dumpOf(s, `warm step ${k}`));

    const clean = cleanRebuilds(run);

    for (let k = 0; k < run.length; k++) {
      const label = k === 0 ? 'the opening state' : `after "${CHANGES[k - 1]!.name}"`;
      // Every cache this task ships is in the dump: the route's tessellation, the title's shaped run and
      // the board layer's cache (the board stays still for four of the five frames while the dot moves).
      expect(of(clean[k]!, 'tessellation', 'route').length > 0, `${label}: the route's tessellation is read`).toBe(true);
      expect(clean[k]!.text.has('title'), `${label}: the title's shaped run is read`).toBe(true);
      expect(clean[k]!.layers.has('board'), `${label}: the board layer is drawn from its writer-layer cache`).toBe(true);
      expect(difference(warm[k]!, clean[k]!), `${label}: the warm session's caches differ from a clean rebuild`).toBeNull();
    }
  }, 900_000);

  it('AC2 each change kind changes the clean rebuild\'s entry it touches, so a cache gone stale would differ from the rebuild', () => {
    // Without this, a board whose changes reach no cache would pass the comparison above trivially: here
    // each change must alter the entry it touches in a clean rebuild, so a cache that kept serving the
    // entry from before the change would show the old bytes and fail the comparison.
    const clean = cleanRebuilds(states());
    const misses = CHANGES.flatMap((change, k) => {
      if (!change.affects) return [];
      const why = change.affects(clean[k]!, clean[k + 1]!);
      return why === null ? [] : [`${change.name}: ${why}`];
    });
    expect(misses, 'every change kind reaches the cache entry it touches').toEqual([]);
    // Keys come from content, not from history: an entry the change didn't touch keeps its key.
    const titleKeys = clean.slice(0, 5).map((d) => d.text.get('title')?.key);
    expect(new Set(titleKeys).size, `the title's key is unchanged until its text changes: ${JSON.stringify(titleKeys)}`).toBe(1);
  }, 900_000);

  it('a deep-canvas-render line that is not JSON, or a session whose first step has no doc, is bad_input with no panic', () => {
    const outs = batch(RENDER_BIN, ['session'], ['{"look": ', { look: LOOK, steps: [{ t: 0 }] }]);
    expect(outs, 'both lines answered bad_input').toEqual([{ ok: false, code: 'bad_input' }, { ok: false, code: 'bad_input' }]);
  });
});

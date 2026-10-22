import { describe, expect, it } from 'vitest';
import { STATES, batch, clean, glyphs, isObject, obj, sharedGlyphLook, useRenderBinary, type JsonValue, type State } from './helpers.ts';

useRenderBinary();

/** The pair a status guard refusal names, sorted, or a message saying what came back instead. */
function refusedPair(out: JsonValue | undefined): string[] | string {
  if (!isObject(out) || out['ok'] !== false) return `not refused: ${JSON.stringify(out).slice(0, 600)}`;
  if (out['code'] !== 'status_glyph_shared') return `refused with ${String(out['code'])}, not status_glyph_shared: ${JSON.stringify(out).slice(0, 600)}`;
  const pair = out['pair'];
  if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((s) => typeof s === 'string')) return `no pair of two states: ${JSON.stringify(out)}`;
  return (pair as string[]).slice().sort();
}

describe('AC2 the clean pipeline look and the status guard', () => {
  it('AC2 the clean pipeline look maps all nine states to a color and gives each its own glyph, with an automatic legend', () => {
    const look = clean();
    expect(look['id'], 'the shipped look\'s id').toBe('clean');
    const status = obj(look['status'], 'look.status');
    for (const s of STATES) expect(status[s] !== undefined && status[s] !== null, `look.status names a color for ${s}`).toBe(true);
    const g = glyphs(look);
    for (const s of STATES) expect(g[s].length > 0, `the glyph for ${s} is not empty`).toBe(true);
    // One glyph per state, each different: the rule the status guard enforces, held by the shipped look.
    expect(new Set(STATES.map((s) => g[s])).size, `nine different glyphs: ${JSON.stringify(g)}`).toBe(9);
    expect(look['legend'], 'the legend is automatic').toBe('auto');
    const themes = obj(look['themes'], 'look.themes');
    expect(Object.keys(themes).sort(), 'the look has a light and a dark theme').toEqual(['dark', 'light']);
  }, 900_000);

  it('AC2 a planted look that gives pass and fail one glyph fails the status guard, naming the pair', () => {
    const [planted, shipped] = batch('look', [{ look: sharedGlyphLook('pass', 'fail') }, { look: clean() }]);
    // A guard that never compares glyphs passes the planted look and fails here.
    expect(refusedPair(planted), 'the planted look is refused, naming pass and fail').toEqual(['fail', 'pass']);
    // The look it was planted from passes the guard, so the refusal is the shared glyph's.
    expect(isObject(shipped) && shipped['ok'], `the clean look itself passes: ${JSON.stringify(shipped).slice(0, 600)}`).toBe(true);
  }, 900_000);

  it('AC2 the guard names exactly the pair for every two states that share a glyph, so it is not a pass-and-fail special case', () => {
    const pairs: [State, State][] = [];
    for (let i = 0; i < STATES.length; i++) for (let j = i + 1; j < STATES.length; j++) pairs.push([STATES[i]!, STATES[j]!]);
    const out = batch('look', pairs.map(([a, b]) => ({ look: sharedGlyphLook(a, b) })));
    const wrong = pairs.flatMap(([a, b], k) => {
      const got = refusedPair(out[k]);
      const want = [a, b].sort();
      return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${a} and ${b} sharing a glyph: ${JSON.stringify(got)}`];
    });
    expect(wrong, `36 planted looks, each refused naming its own pair; wrong at ${wrong.length}`).toEqual([]);
  }, 900_000);

  it('a look line that is not JSON, or names no look, is bad_input with no panic', () => {
    const out = batch('look', ['not json', {}]);
    for (const o of out) expect(isObject(o) ? [o['ok'], o['code']] : o, 'bad_input').toEqual([false, 'bad_input']);
  }, 900_000);
});

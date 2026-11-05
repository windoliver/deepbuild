// AC2: switching looks redraws only the look's passes: no node rebuilds unless its content key changed.
//
// `deep-canvas-render session` (macOS: GPUI's offscreen Metal renderer) opens fixtures/scene.json in the
// clean look, then switches the look at each later step, through every shipped look and back to clean, with
// the document unchanged. Each step answers its caches (#391: tessellation, text and layer entries with their
// content keys) and `built`, the entries the step made rather than reused. A node is rebuilt only when its
// content key changed: every entry a switch builds has a key the step before didn't hold for that item, some
// node keeps its cached result at every switch, and the look is in the scene's rebuild key: each step answers
// `rebuild_key`, which changes at every switch and is the opening one again back in clean (a layer picture
// the session cached, if any, is redrawn under a new key too).
// The wrong program: `planted: "look_switch_rebuilds"`, a switch that empties every node cache. At the base
// a step takes no `look` and answers no `built`.
import { describe, expect, it } from 'vitest';
import {
  RENDER_BIN, arr, fixture, num, obj, one, requireMac, sec, shippedIds, shown, str, useBinaries, type JsonObject, type JsonValue,
} from './helpers.ts';

useBinaries('deep-canvas-render');

type CacheName = 'tessellation' | 'text' | 'layers';
const NODE_CACHES: CacheName[] = ['tessellation', 'text'];
interface Entry { cache: CacheName; id: string; bucket: number | null; key: string }
const slot = (e: Entry): string => `${e.cache}:${e.id}@${e.bucket ?? '-'}`;
const full = (e: Entry): string => `${slot(e)}#${e.key}`;

function entries(value: JsonValue | undefined, cache: CacheName, what: string): Entry[] {
  return arr(value ?? [], `${what}.${cache}`).map((raw, i) => {
    const e = obj(raw, `${what}.${cache}[${i}]`);
    return {
      cache, id: str(cache === 'layers' ? e['layer'] : e['item'], `${what}.${cache}[${i}] id`),
      bucket: cache === 'tessellation' ? num(e['bucket'], `${what}.${cache}[${i}].bucket`) : null,
      key: str(e['key'], `${what}.${cache}[${i}].key`),
    };
  });
}
interface Step { held: Entry[]; built: Entry[]; rebuildKey: string }
function stepOf(value: JsonValue | undefined, what: string): Step {
  const s = obj(value, what);
  const caches = obj(s['caches'], `${what}.caches`);
  const built = obj(s['built'], `${what}.built (the entries this step made)`);
  return {
    held: (['tessellation', 'text', 'layers'] as CacheName[]).flatMap((c) => entries(caches[c], c, `${what}.caches`)),
    built: NODE_CACHES.flatMap((c) => entries(built[c], c, `${what}.built`)),
    rebuildKey: str(s['rebuild_key'], `${what}.rebuild_key (the scene's rebuild key)`),
  };
}

/** The session: the scene opened in clean, then a look switch per step through every shipped look and back. */
function run(planted?: string): { looks: string[]; steps: Step[] } {
  const ids = shippedIds();
  const looks = ['clean', ...ids.filter((id) => id !== 'clean'), 'clean'];
  const steps: JsonObject[] = looks.map((look, k) => (k === 0
    ? { doc: fixture('scene.json'), t: sec(1), frames: 3 }
    : { t: sec(1) + k * sec(0.1), look, frames: 3 }));
  const out = one(RENDER_BIN, ['session'], { look: 'clean', steps, ...(planted ? { planted } : {}) });
  expect(out['ok'], `the session runs: ${shown(out)}`).toBe(true);
  const answered = arr(out['steps'], 'session: steps');
  expect(answered.length, 'one answer per step').toBe(steps.length);
  return { looks, steps: answered.map((s, k) => stepOf(s, `step ${k} (${looks[k]})`)) };
}

/** Each way a switch broke the criterion, named by the switch, the cache and the item. */
function problems(looks: string[], steps: Step[]): string[] {
  const out: string[] = [];
  for (let k = 1; k < steps.length; k++) {
    const at = `switching ${looks[k - 1]} → ${looks[k]}`;
    const before = new Set(steps[k - 1]!.held.map(full));
    for (const e of steps[k]!.built) {
      if (before.has(full(e))) out.push(`${at}: ${slot(e)} was rebuilt though its content key ${e.key} didn't change`);
    }
    const kept = steps[k]!.held.filter((e) => e.cache !== 'layers' && before.has(full(e)) && !steps[k]!.built.some((b) => full(b) === full(e)));
    if (kept.length === 0) out.push(`${at}: no node kept its cached result`);
    if (steps[k]!.rebuildKey === steps[k - 1]!.rebuildKey) out.push(`${at}: the scene's rebuild key stayed ${steps[k]!.rebuildKey}, so the look isn't in it`);
    const layersBefore = new Map(steps[k - 1]!.held.filter((e) => e.cache === 'layers').map((e) => [e.id, e.key]));
    for (const e of steps[k]!.held.filter((x) => x.cache === 'layers')) {
      if (layersBefore.get(e.id) === e.key) out.push(`${at}: the layer ${e.id}'s picture kept its key ${e.key}, so the look isn't in the scene's rebuild key`);
    }
  }
  return out;
}

describe('#417 AC2 switching looks redraws only the look\'s passes: no node rebuilds unless its content key changed', () => {
  it('AC2 through every shipped look and back to clean, a switch rebuilds only nodes whose content key changed, keeps the others, and redraws the layer under a new key', () => {
    requireMac('the session');
    const { looks, steps } = run();
    expect(looks.length, 'the session switches through at least the four first looks').toBeGreaterThanOrEqual(5);
    // `built` is the step's own making: the first step builds every node it holds.
    const first = steps[0]!;
    const builtFirst = new Set(first.built.map(full));
    for (const e of first.held.filter((x) => x.cache !== 'layers')) expect(builtFirst.has(full(e)), `the opening step built ${full(e)}`).toBe(true);
    expect(problems(looks, steps)).toEqual([]);
    // The rebuild key is the scene's in its look: back in clean, it is the opening step's again.
    expect(steps.at(-1)!.rebuildKey, 'back in clean, the scene\'s rebuild key is the one it opened with').toBe(first.rebuildKey);
  }, 900_000);

  it('AC2 the check sees a rebuild: a switch that empties every node cache (planted look_switch_rebuilds) fails it, naming a node', () => {
    requireMac('the session');
    const { looks, steps } = run('look_switch_rebuilds');
    const found = problems(looks, steps);
    expect(found.some((p) => /was rebuilt though its content key/.test(p)), `the planted switch is caught: ${found.join(' | ')}`).toBe(true);
  }, 900_000);
});

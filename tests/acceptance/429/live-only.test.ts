// #429.02800e1a: a figure with a pass operator declared live_only (fallback look) that tints the frame red shows the
// tint in the live view, while its render-back snapshot and a headless canonical render at t = 1 s each have the
// pixel hash of the same figure without the operator; a material operator declared live_only with fallback none is
// refused with live_only_canonical, naming it; and a planted render-back that draws live-only passes shows the tint
// and fails, naming the pass.
//
// #379's `live` call runs two sessions of the moving figure, one with the tint (helpers.ts: tint, +0.6 red, declared
// live_only, fallback look) and one without, reporting each view's pixel hash; at frame 61 (t = 1 s at 60 fps) a
// `canonical` event takes each session's render-back of frame 61. A fresh process's `canonical` call (no live
// session: headless) renders frame 61 of each document for export. The material operator goes to `check_operator`.
// At the base no document item can be a GPU operator and the check has no live_only_canonical.
import { describe, expect, it } from 'vitest';
import {
  BRAVO, WRITER, asItem, canonicalCall, canonicalOf, checkCall, checked, errors, figure, liveCall, liveReply, payload, requireGpu, run, run1, shown,
  tint, useBins, useOut, viewAt, writeJson, type JsonObject, type Planted,
} from './helpers.ts';

const bins = useBins();
const out = useOut();
const SIZE: [number, number] = [128, 64];
const AT = 61;

function tintProblems(planted?: Planted): string[] {
  const docs = {
    tint: writeJson(out(), 'tint.json', payload(figure('live-only-429', { tint: asItem(tint('tint', { determinism: 'live_only', fallback: 'look' })) }, { moving: true }))),
    plain: writeJson(out(), 'plain.json', payload(figure('live-only-429', {}, { moving: true }))),
  };
  const live = liveReply(run1(bins.bin(), out(), liveCall({
    frames: AT, report: ['hashes'],
    sessions: [{ session: 's-tint', writer: WRITER, doc: docs.tint, size: SIZE }, { session: 's-plain', writer: BRAVO, doc: docs.plain, size: SIZE }],
    events: ['s-tint', 's-plain'].map((session) => ({ frame: AT, canonical: { session, purpose: 'render_back', frame: AT, size: SIZE } })),
  }), planted));
  const p: string[] = [];
  const liveTint = viewAt(live, AT, 's-tint').pixel_hash;
  const livePlain = viewAt(live, AT, 's-plain').pixel_hash;
  if (liveTint === null || livePlain === null) p.push(`the live views at frame ${AT} have no pixel hash (${liveTint}, ${livePlain})`);
  else if (liveTint === livePlain) p.push(`the live view with the live-only pass tint shows no tint at frame ${AT}`);
  const back = (s: string): string | null => live.canonicals.find((c) => c.session === s && c.purpose === 'render_back')?.pixel_hash ?? null;
  if (back('s-tint') === null || back('s-plain') === null) p.push(`a render-back at frame ${AT} is missing: ${shown(live.raw['canonicals'])}`);
  else if (back('s-tint') !== back('s-plain')) p.push(`the render-back of the figure with the live-only pass tint shows the tint: ${back('s-tint')} is not ${back('s-plain')}`);
  const [headTint, headPlain] = run(bins.bin(), out(), [canonicalCall(docs.tint, AT, 'export', SIZE), canonicalCall(docs.plain, AT, 'export', SIZE)], planted)
    .map((r, i) => canonicalOf(r, i ? 'the headless render without the pass' : 'the headless render with the pass tint'));
  if (headPlain!.pixel_hash === null) p.push('the headless render without the pass has no pixel hash');
  else if (headTint!.pixel_hash !== headPlain!.pixel_hash) p.push(`the headless canonical render with the live-only pass tint shows the tint: ${headTint!.pixel_hash} is not ${headPlain!.pixel_hash}`);
  return p;
}

const glow = (): JsonObject => ({
  id: 'glow', kind: 'material', origin: 'composed', about: 'A material that emits red, live only, with no fallback.', inputs: {},
  steps: { e: { op: 'const@1', args: { value: [1, 0, 0], type: 'vec3' } } },
  outputs: { emission: 'e' }, determinism: 'live_only', fallback: 'none', cost: { ns_per_px: 50 },
});

describe('#429.02800e1a a live-only pass shows only in the live view; canonical renders draw its fallback', () => {
  it('#429.02800e1a the tint shows in the live view at t = 1 s, while its render-back and a headless canonical render equal the figure without it', () => {
    requireGpu();
    expect(tintProblems()).toEqual([]);
  }, 1_800_000);

  it('#429.02800e1a a material operator declared live_only with fallback none is refused with live_only_canonical, naming it', () => {
    requireGpu();
    const c = checked(run1(bins.bin(), out(), checkCall(glow())), 'the live-only material glow');
    expect(c.outcome, shown(c.raw)).toBe('refused');
    expect(errors(c, 'live_only_canonical').filter((e) => e['item'] === 'glow').length, `live_only_canonical names glow (its item field): ${shown(c.issues)}`).toBeGreaterThan(0);
  }, 1_800_000);

  it('#429.02800e1a a planted render-back that draws live-only passes (--planted render_back_draws_live_only) shows the tint and fails, naming the pass', () => {
    requireGpu();
    expect(tintProblems('render_back_draws_live_only').join('\n')).toMatch(/render-back of the figure with the live-only pass tint shows the tint/);
  }, 1_800_000);
});

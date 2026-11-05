// #429.fd8c9ee7: a pass operator whose pipeline creation a test hook makes fail raises operator_compile naming the
// operator and the item, its writer gets the issue, the live view draws the operator's fallback with the frame
// reporting settling, a deep_show snapshot at that time returns not presented with the reason, and a check that
// needs that frame is BLOCKED; a planted core that marks the frame settled with the fallback drawn fails, naming
// the operator.
//
// #379's `live` call on the `test-meter` build with the test hook `fail_pipelines: [operator item ID]` (README):
// the device rejects that operator's pipeline after it passes the check. Alpha's moving figure has the pass `tint`
// (fallback look). At frame 20 two `canonical` events ask for frame 20: a `render_back` (the deep_show snapshot)
// and a `pixel_check` (a check that needs the frame). At the base the live call draws no operator item and has no
// such hook.
import { describe, expect, it } from 'vitest';
import { WRITER, asItem, figure, liveCall, liveReply, payload, requireGpu, run1, sessionRow, shown, tint, useBins, useOut, writeJson, type Planted } from './helpers.ts';

const bins = useBins(['test-meter']);
const out = useOut();
const SIZE: [number, number] = [128, 64];
const AT = 20;

function compileProblems(planted?: Planted): string[] {
  const doc = writeJson(out(), 'alpha.json', payload(figure('compile-429', { tint: asItem(tint('tint')) }, { moving: true })));
  const live = liveReply(run1(bins.bin('test-meter'), out(), liveCall({
    frames: 30, fail_pipelines: ['tint'],
    sessions: [{ session: 's-alpha', writer: WRITER, doc, size: SIZE }],
    events: ['render_back', 'pixel_check'].map((purpose) => ({ frame: AT, canonical: { session: 's-alpha', purpose, frame: AT, size: SIZE } })),
  }), planted));
  const p: string[] = [];
  const issues = (sessionRow(live, 's-alpha')['issues'] as { [k: string]: unknown }[] | undefined) ?? [];
  const compile = issues.find((i) => i['code'] === 'operator_compile' && i['operator'] === 'tint');
  if (!compile) p.push(`alpha's session has no operator_compile issue naming operator tint: ${shown(sessionRow(live, 's-alpha'))}`);
  else for (const k of ['module', 'item', 'evidence']) if (typeof compile[k] !== 'string' || compile[k] === '') p.push(`tint's operator_compile names no ${k}: ${JSON.stringify(compile)}`);
  for (const f of live.frames) {
    const v = f.views.find((x) => x.session === 's-alpha');
    const row = v?.operators.find((o) => o.operator === 'tint');
    if (!v || !row) { p.push(`frame ${f.frame}: the view lists no operator tint`); continue; }
    if (row.drew !== 'fallback') p.push(`frame ${f.frame}: tint drew ${row.drew}, not its fallback`);
    if (v.settled !== false) p.push(`frame ${f.frame}: the frame with tint's fallback drawn reports settled ${v.settled}, not settling`);
  }
  const back = live.canonicals.find((c) => c.purpose === 'render_back');
  if (!back) p.push('no render-back was answered');
  else if (back.presented !== false || !back.reason) p.push(`the deep_show snapshot of frame ${AT} with tint's fallback drawn was presented ${back.presented} (reason ${back.reason})`);
  const check = live.canonicals.find((c) => c.purpose === 'pixel_check');
  if (!check) p.push('no pixel check was answered');
  else if (check.verdict !== 'BLOCKED') p.push(`the check that needs frame ${AT} (tint's fallback drawn) read ${check.verdict}, not BLOCKED`);
  return p;
}

describe('#429.fd8c9ee7 an operator whose pipeline the device rejects draws its fallback, and nothing reads the frame as settled', () => {
  it('#429.fd8c9ee7 operator_compile names tint, its module and item with the backend\'s message; the view draws the fallback while settling; the snapshot is not presented; the check is BLOCKED', () => {
    requireGpu();
    expect(compileProblems()).toEqual([]);
  }, 1_800_000);

  it('#429.fd8c9ee7 a planted core that marks the frame settled with the fallback drawn (--planted settles_with_fallback) fails, naming the operator', () => {
    requireGpu();
    expect(compileProblems('settles_with_fallback').join('\n')).toMatch(/the frame with tint's fallback drawn reports settled true/);
  }, 1_800_000);
});

// AC4: a figure of the failing cart test (a 480 × 160 core view): a label, a status mark whose fill is bound to the run
// (`run-state`, source `run:<id>`) and the text item `expected-total`. Typed as "18.01", the check refuses the figure
// with `number_unsourced` naming `expected-total`; with the text empty and a bound value on `run:<id>#cart total`,
// `select: expected`, the same figure passes. The check is `deep-canvas-render check` (#392's and #406's surface,
// unchanged). At the base the typed figure is refused, but the bound one is refused too, `bad_handle`: the base's handle
// grammar takes no assertion name such as `cart total` as a fragment.
import { describe, expect, it } from 'vitest';
import { ASSERTION, VITEST_RUN, checkedOf, lines, shownErrors, useBuilds, type JsonObject } from './helpers.ts';

const build = useBuilds(['deep-canvas-render']);

/** The figure: the typed text, or the same text bound to the run's expected value. */
function figure(bound: boolean): JsonObject {
  return {
    format: 1, id: 'cart-total-figure', profile: 'board', title: 'Cart total', description: 'The failing cart test, drawn by an agent.',
    size: [480, 160], budget: { class: 'core view' },
    layers: { main: { writer: 'agent-a', title: 'Main', order: 'a0' } },
    items: {
      label: { id: 'label', kind: 'text@1', layer: 'main', name: 'Label', order: 'a0', params: { text: 'Cart total, expected', font: 'body', size: 13, box: { w: 240, h: 20 } }, at: { pos: [16, 16, 0] } },
      'expected-total': {
        id: 'expected-total', kind: 'text@1', layer: 'main', name: 'Expected total', order: 'a1',
        params: { text: bound ? '' : '18.01', font: 'body', size: 13, box: { w: 240, h: 24 }, ...(bound ? { numerals: 'tabular', widest: '999,999.99' } : {}) },
        at: { pos: [16, 48, 0] },
      },
      gate: { id: 'gate', kind: 'rect@1', layer: 'main', name: 'Cart run', order: 'a2', params: { box: [16, 96, 96, 24] } },
    },
    status_bindings: { 'run-state': { target: 'items/gate/params/paint/fill', source: VITEST_RUN } },
    ...(bound ? { bound_values: { expected: { target: 'items/expected-total/params/text', source: `${VITEST_RUN}#${ASSERTION}`, select: 'expected' } } } : {}),
  };
}

describe('AC4 a typed total beside a status binding to the same run is refused by honest numbers; the bound value passes', () => {
  it('AC4 the figure typing 18.01 is refused number_unsourced naming expected-total, and the same figure with the bound value on run:<id>#cart total, select expected, passes (fails on a check that skips texts beside a run\'s status, or one that refuses a run assertion\'s bound value)', () => {
    const [typed, bound] = lines(build('deep-canvas-render'), ['check'], [{ doc: figure(false), look: 'clean' }, { doc: figure(true), look: 'clean' }]).map((o, i) => checkedOf(o, `check of the ${i ? 'bound' : 'typed'} figure`));
    expect(typed!.ok, `the typed figure is refused: ${shownErrors(typed!)}`).toBe(false);
    expect(typed!.errors.some((e) => e.code === 'number_unsourced' && e.ids.includes('expected-total')), `an error number_unsourced names expected-total: ${shownErrors(typed!)}`).toBe(true);
    expect(bound!.errors, `the bound figure raises no error: ${shownErrors(bound!)}`).toEqual([]);
    expect(bound!.ok, 'the bound figure passes').toBe(true);
  });
});

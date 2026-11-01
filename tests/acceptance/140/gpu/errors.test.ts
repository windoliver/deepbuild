// AC22: the device's uncaptured-error callback is a channel every check that renders reads. The test fixture
// `raises_validation_error` (test-seam) renders pixels that match its golden while raising a wgpu validation error
// through the device's uncaptured-error callback; `clean_render` raises none. A check that didn't declare the error
// fails naming it; the same check declaring it passes (the twin that shows the channel, not the fixture, decides).
// `--planted reads_pixels_only` is a runner that reads only the pixels: it passes the check, and this test fails it.
// At the base there is no test-seam build and no `check_render` call.
import { describe, expect, it } from 'vitest';
import { arr, bool, obj, requireMac, run1, shown, str, useBuilds, useOut, type JsonObject, type Planted } from './helpers.ts';

const bins = useBuilds(['test-seam']);
const out = useOut();

interface Checked { raw: JsonObject; result: string; golden: string; errors: { kind: string; error: string; declared: boolean }[] }
function check(fixture: string, declares?: { kind: string; contains: string }[], planted?: Planted): Checked {
  const r = run1(bins.bin('test-seam'), out(), { call: 'check_render', fixture, ...(declares ? { declares: declares as unknown as JsonObject[] } : {}) }, planted ? { planted } : {});
  expect(r['fixture'], 'the reply is the fixture\'s').toBe(fixture);
  return {
    raw: r, result: str(r['result'], 'check_render: result'), golden: str(r['golden'], 'check_render: golden'),
    errors: arr(r['errors'], 'check_render: errors').map((v, i) => {
      const e = obj(v, `check_render: errors[${i}]`);
      return { kind: str(e['kind'], `errors[${i}].kind`), error: str(e['error'], `errors[${i}].error`), declared: bool(e['declared'], `errors[${i}].declared`) };
    }),
  };
}

/** The check: a render check passes only when its pixels match and every error on the channel was declared. */
function verdictProblems(c: Checked, raised: string): string[] {
  if (c.result === 'PASS') return [`the check passed while its render raised the undeclared error "${raised}" through the uncaptured-error callback`];
  return [];
}

describe('AC22 a check whose render raises an undeclared validation error through the device\'s uncaptured-error callback fails, naming it, while its pixels match the golden', () => {
  it('AC22 the undeclared error fails the check, naming it, with its pixels matching the golden; declared, the same check passes; a render with no error passes', () => {
    requireMac();
    const none = check('clean_render');
    expect(none.result, `a render with no error passes: ${shown(none.raw)}`).toBe('PASS');
    expect(none.errors, 'the channel stayed empty').toEqual([]);
    const raised = check('raises_validation_error');
    expect(raised.golden, 'its pixels match the golden').toBe('PASS');
    expect(raised.errors.length, `the channel carried the error: ${shown(raised.raw)}`).toBeGreaterThan(0);
    const e = raised.errors[0]!;
    expect(e.kind, 'a validation error').toBe('validation');
    expect(e.declared, 'which the check didn\'t declare').toBe(false);
    expect(e.error.length, 'the error is named by its text').toBeGreaterThan(0);
    expect(raised.result, `the undeclared error fails the check: ${shown(raised.raw)}`).toBe('FAIL');
    expect(verdictProblems(raised, e.error), 'the check').toEqual([]);
    const declared = check('raises_validation_error', [{ kind: 'validation', contains: e.error.slice(0, 40) }]);
    expect(declared.errors.map((x) => x.declared), 'declared, the error reads declared').toEqual(declared.errors.map(() => true));
    expect(declared.result, `a declared error doesn't fail the check: ${shown(declared.raw)}`).toBe('PASS');
  }, 1_800_000);

  it('AC22 a planted runner that reads only the pixels passes the check and fails this test', () => {
    requireMac();
    const raised = check('raises_validation_error');
    expect(raised.errors.length, 'the clean runner sees the error').toBeGreaterThan(0);
    const planted = check('raises_validation_error', undefined, 'reads_pixels_only');
    expect(planted.golden, 'the planted runner reads the matching pixels').toBe('PASS');
    expect(planted.result, 'the planted runner passes the check').toBe('PASS');
    const f = verdictProblems(planted, raised.errors[0]!.error);
    expect(f.length, 'this test fails the planted runner').toBeGreaterThan(0);
    expect(f[0], 'naming the error').toContain(raised.errors[0]!.error);
  }, 1_800_000);
});

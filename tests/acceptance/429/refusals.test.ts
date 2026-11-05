// #429.0e8f9a1a: a graph with shader text, a callback, an unbounded loop or a status-color write is refused
// before it runs, naming the step.
// #429.c05896b0: an operator whose estimated cost exceeds its declaration by more than 25% is refused with
// cost_understated.
// #429.8c4a173e: a compute graph that writes storage at any index but its own element index, such as
// write(out, hash(i) % n, v), is refused with operator_kind_rule naming the step, while the same value added by
// an atomic_add statement checks; a planted check that trusts the index lets it through and fails.
//
// All through #380's `check_operator` (the core's check, then naga, a pipeline and one run only if it passes;
// `reached` says how far an operator got), with `estimate_ns` added to its reply (README). The control is a
// composed pass that scales the frame by the luminance of the look role `accent` (role@1 is one of the public
// steps this issue adds); each defect changes one step of it. At the base check_operator has no role@1 step,
// no `estimate_ns` and no kind rule on a write's index.
import { describe, expect, it } from 'vitest';
import { FRAME_COLOR, checkCall, checked, errors, isObject, pass, requireGpu, run, shown, tint, useBins, useOut, type Checked, type JsonObject, type Planted } from './helpers.ts';

const bins = useBins();
const out = useOut();

const lit = (role: string): JsonObject => ({
  uv: { op: 'screen_uv@1', args: {} },
  c: { op: 'sample@1', args: { tex: 'src', uv: 'uv', lod: 0 } },
  r: { op: 'role@1', args: { name: role } },
  lum: { op: 'luminance@1', args: { rgb: 'r' } },
});
const CONTROL = pass('lit', { ...lit('accent'), out: { op: 'mul@1', args: { a: 'c', b: 'lum' } } });
interface Defect { name: string; step: string; op: JsonObject; notUnknown?: boolean }
const DEFECTS: Defect[] = [
  { name: 'shader text', step: 'raw', op: pass('lit', { ...lit('accent'), raw: { op: 'mul@1', args: { a: 'c', b: 'lum' }, wgsl: 'return c * lum;' } }, { outputs: { color: 'raw' } }) },
  { name: 'a callback', step: 'cb', op: pass('lit', { ...lit('accent'), cb: { op: 'mul@1', args: { a: 'c', b: { callback: '(v) => v * 2' } } } }, { outputs: { color: 'cb' } }) },
  {
    name: 'an unbounded loop', step: 'sum',
    op: pass('lit', {
      ...lit('accent'),
      sum: { op: 'repeat@1', args: { count: 'n', accumulate: { acc: [0, 0, 0, 0] }, body: { acc: { op: 'add@1', args: { a: 'acc', b: 'c' } } } } },
    }, { inputs: { src: FRAME_COLOR, n: { type: 'u32', from: { param: 'params/n' } } }, outputs: { color: 'sum.acc' } }),
  },
  // The role step itself must exist (it is a public step), so the refusal is the status rule, not an unknown op.
  { name: 'a status-color write', step: 'r', notUnknown: true, op: pass('lit', { ...lit('fail'), out: { op: 'mul@1', args: { a: 'c', b: 'lum' } } }) },
];

function reached(c: Checked): string[] {
  const r = isObject(c.raw['reached']) ? c.raw['reached'] : {};
  return ['naga', 'pipeline', 'gpu'].filter((k) => r[k] === true);
}

describe('#429.0e8f9a1a shader text, a callback, an unbounded loop or a status-color write is refused before it runs, naming the step', () => {
  it('#429.0e8f9a1a the control checks and runs; each defect is refused with an error naming its step, reaching neither a pipeline nor the GPU', () => {
    requireGpu();
    const replies = run(bins.bin(), out(), [checkCall(CONTROL), ...DEFECTS.map((d) => checkCall(d.op))]);
    const control = checked(replies[0]!, 'the control');
    expect(control.outcome, `the control (role accent) passes the check: ${shown(control.raw)}`).toBe('accepted');
    expect(reached(control), 'and reaches naga, a pipeline and the GPU').toEqual(['naga', 'pipeline', 'gpu']);
    const problems: string[] = [];
    DEFECTS.forEach((d, i) => {
      const c = checked(replies[i + 1]!, d.name);
      if (c.outcome !== 'refused') problems.push(`${d.name} was ${c.outcome}`);
      const naming = errors(c).filter((e) => e['step'] === d.step && (!d.notUnknown || e['code'] !== 'operator_unknown_op'));
      if (naming.length === 0) problems.push(`${d.name}: no error names step ${d.step}${d.notUnknown ? ' (other than operator_unknown_op)' : ''}: ${shown(c.issues)}`);
      const r = reached(c).filter((k) => k !== 'naga');
      if (r.length) problems.push(`${d.name} reached ${r.join(' and ')} before it was refused`);
    });
    expect(problems, 'each defect').toEqual([]);
  }, 1_800_000);
});

describe('#429.c05896b0 an operator whose estimate exceeds its declaration by more than 25% is refused with cost_understated', () => {
  it('#429.c05896b0 declared at estimate ÷ 1.2 the tint checks; declared at estimate ÷ 1.3 it is refused with cost_understated', () => {
    requireGpu();
    const first = checked(run(bins.bin(), out(), [checkCall(tint('tint', { cost: { ns_per_px: 1000 } }))])[0]!, 'the tint declared at 1,000 ns a pixel');
    expect(first.outcome, `the generously declared tint checks: ${shown(first.raw)}`).toBe('accepted');
    expect(first.estimate, 'its reply gives the check\'s estimate, estimate_ns').not.toBeNull();
    const e = first.estimate!;
    expect(e, 'the estimate is above 0').toBeGreaterThan(0);
    const [within, over] = run(bins.bin(), out(), [checkCall(tint('tint', { cost: { ns_per_px: e / 1.2 } })), checkCall(tint('tint', { cost: { ns_per_px: e / 1.3 } }))]).map((r, i) => checked(r, i ? 'declared at e ÷ 1.3' : 'declared at e ÷ 1.2'));
    expect(errors(within!, 'cost_understated'), `20% over its declaration is within 25%: ${shown(within!.raw)}`).toEqual([]);
    expect(within!.outcome).toBe('accepted');
    expect(over!.outcome, `30% over its declaration: ${shown(over!.raw)}`).toBe('refused');
    expect(errors(over!, 'cost_understated').length, 'refused with cost_understated').toBeGreaterThan(0);
  }, 1_800_000);
});

// write(out, hash(i) % 64, 1) against atomic_add(out, hash(i) % 64, 1), over 64 elements.
const scatter = (statement: 'write@1' | 'atomic_add@1'): JsonObject => ({
  id: 'scatter', kind: 'compute', origin: 'composed', about: `Adds 1 at hash(i) % 64 by ${statement}.`, inputs: {},
  steps: {
    e: { op: 'element@1', args: {} },
    n: { op: 'const@1', args: { value: 64, type: 'u32' } },
    one: { op: 'const@1', args: { value: 1, type: 'u32' } },
    h: { op: 'hash@1', args: { a: 'e' } },
    i: { op: 'rem@1', args: { a: 'h', b: 'n' } },
    w: { op: statement, args: { buf: 'out', i: 'i', v: 'one' } },
  },
  outputs: { out: { storage: { type: 'u32', count: 64 } } }, elements: 64, workgroup: 64, cost: { ns_per_element: 1000 },
});
function scatterProblems(planted?: Planted): string[] {
  const [write, atomic] = run(bins.bin(), out(), [checkCall(scatter('write@1')), checkCall(scatter('atomic_add@1'))], planted).map((r, i) => checked(r, i ? 'atomic_add' : 'write'));
  const problems: string[] = [];
  if (write!.outcome !== 'refused') problems.push(`write(out, hash(i) % n, v) at step w was ${write!.outcome}: ${shown(write!.raw)}`);
  else if (!errors(write!, 'operator_kind_rule').some((e) => e['step'] === 'w')) problems.push(`write at step w was refused, but no operator_kind_rule names step w: ${shown(write!.issues)}`);
  if (atomic!.outcome !== 'accepted') problems.push(`atomic_add(out, hash(i) % n, v) at step w was ${atomic!.outcome}: ${shown(atomic!.issues)}`);
  return problems;
}

describe('#429.8c4a173e a compute write at any index but its own is refused with operator_kind_rule, while atomic_add checks', () => {
  it('#429.8c4a173e write(out, hash(i) % n, v) is refused naming step w; atomic_add at the same index checks', () => {
    requireGpu();
    expect(scatterProblems()).toEqual([]);
  }, 1_800_000);
  it('#429.8c4a173e a planted check that trusts the index (--planted trusts_write_index) lets the write through and fails', () => {
    requireGpu();
    const problems = scatterProblems('trusts_write_index');
    expect(problems.join('\n'), 'the check names the write it let through').toMatch(/write\(out, hash\(i\) % n, v\) at step w was accepted/);
  }, 1_800_000);
});

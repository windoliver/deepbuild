// #380.e70d1419: a shipped operator with a loop whose count isn't fixed, an index past a declared length,
// or shader text is refused before it reaches the GPU.
// fixtures/operators: a control the check accepts (a pass that averages four reads with a repeat fixed at
// 4), and six shipped operators, each with one of the criterion's defects: a repeat whose count is an input
// with no maximum, and one whose maximum is past 64 (Step and the closed step list: "repeat … count: const
// | input with max ≤ 64"); a compute write at element 20 of a 16-element storage output; WGSL text in a
// field of the operator; a step carrying WGSL text; and a WGSL-subset source whose `loop` has no fixed count
// (Compile, validate and cache: the WGSL subset refuses `loop`). The `check_operator` call runs the core's
// check and, only if it passes, compiles and runs the operator; its `reached` says how far the operator got
// (naga, a pipeline, the GPU). Each defect must be refused with an error issue naming its step (or its field,
// or its source's line and construct) and reach none of them; the control must reach all three, so the
// counts can see a run. The wrong program: `--planted skips_operator_check` (operators go to naga and the
// GPU without the check). At the base `deep-gpu` has no check_operator call.
import { describe, expect, it } from 'vitest';
import { arr, bool, fixture, fixturePath, isObject, obj, requireGpu, run, shown, str, useBin, useOut, type JsonObject, type Startup } from './helpers.ts';

const bins = useBin();
const out = useOut();

interface Defect { file: string; codes: string[]; names: (issue: JsonObject) => boolean; what: string }
const DEFECTS: Defect[] = [
  { file: 'repeat-unbounded', codes: ['operator_unbounded'], names: (i) => i['step'] === 'sum', what: 'a loop whose count is an input with no maximum' },
  { file: 'repeat-over-max', codes: ['operator_unbounded'], names: (i) => i['step'] === 'sum', what: 'a loop whose count can reach 1,000' },
  { file: 'index-past-length', codes: ['operator_limit', 'operator_type'], names: (i) => i['step'] === 'pick', what: 'a write past its storage\'s declared length' },
  { file: 'shader-field', codes: [], names: (i) => typeof i['path'] === 'string' && /(^|\/)wgsl$/.test(i['path']), what: 'shader text in a field' },
  { file: 'shader-step', codes: ['operator_unknown_op'], names: (i) => i['step'] === 'raw', what: 'shader text as a step' },
  { file: 'source-loop', codes: ['operator_source'], names: (i) => i['construct'] === 'loop' && i['line'] === 4, what: 'a WGSL-subset source with a loop of no fixed count' },
];
const call = (file: string): JsonObject => ({
  call: 'check_operator', operator: fixture('operators', `${file}.json`),
  ...(file === 'source-loop' ? { assets: { 'glow-loop-src': fixturePath('operators', 'source-loop.wgsl') } } : {}),
});

interface Checked { outcome: string; issues: JsonObject[]; reached: { naga: boolean; pipeline: boolean; gpu: boolean }; raw: JsonObject }
function checked(reply: JsonObject, what: string): Checked {
  expect(reply['code'], `${what} was answered: ${shown(reply)}`).toBeUndefined();
  const r = obj(reply['reached'], `${what}: reached`);
  return {
    outcome: str(reply['outcome'], `${what}: outcome`), issues: arr(reply['issues'] ?? [], `${what}: issues`).filter(isObject),
    reached: { naga: bool(r['naga'], `${what}: reached.naga`), pipeline: bool(r['pipeline'], `${what}: reached.pipeline`), gpu: bool(r['gpu'], `${what}: reached.gpu`) }, raw: reply,
  };
}
/** A defective operator must be refused by the check with an error naming the defect, and reach nothing; each problem names the case. */
function refusalProblems(d: Defect, c: Checked): string[] {
  const problems: string[] = [];
  if (c.outcome !== 'refused') problems.push(`${d.file} (${d.what}) was ${c.outcome}, not refused`);
  const errors = c.issues.filter((i) => i['severity'] === 'error');
  const naming = errors.filter((i) => (d.codes.length === 0 || d.codes.includes(String(i['code']))) && d.names(i));
  if (naming.length === 0) problems.push(`${d.file} (${d.what}): no error issue ${d.codes.length ? `with code ${d.codes.join(' or ')} ` : ''}names the defect: ${shown(c.issues)}`);
  for (const k of ['naga', 'pipeline', 'gpu'] as const) if (c.reached[k]) problems.push(`${d.file} (${d.what}) reached ${k === 'gpu' ? 'the GPU' : k === 'naga' ? 'naga' : 'a pipeline'} before it was refused`);
  return problems;
}
function checkAll(startup: Startup = {}): { control: Checked; problems: string[] } {
  const replies = run(bins.bin(), out(), [call('control'), ...DEFECTS.map((d) => call(d.file))], startup);
  const control = checked(replies[0]!, 'the control');
  return { control, problems: DEFECTS.flatMap((d, i) => refusalProblems(d, checked(replies[i + 1]!, d.file))) };
}

describe('#380.e70d1419 a shipped operator with a loop whose count isn\'t fixed, an index past a declared length, or shader text is refused before it reaches the GPU', () => {
  it('#380.e70d1419 the check accepts the control, which compiles and runs on the GPU, and refuses each defective shipped operator with an error naming its defect before naga, a pipeline or the GPU sees it', () => {
    requireGpu();
    const { control, problems } = checkAll();
    expect(control.outcome, `the control passes the check: ${shown(control.raw)}`).toBe('accepted');
    expect(control.issues.filter((i) => i['severity'] === 'error'), 'with no error issue').toEqual([]);
    expect(control.reached, 'and reaches naga, a pipeline and the GPU, so the counts see a run').toEqual({ naga: true, pipeline: true, gpu: true });
    expect(problems, 'the six defective shipped operators').toEqual([]);
  }, 1_800_000);

  it('#380.e70d1419 a planted core that compiles operators without the check (--planted skips_operator_check) lets a defect reach the GPU and fails, naming it', () => {
    requireGpu();
    const { problems } = checkAll({ planted: 'skips_operator_check' });
    expect(problems.length, 'the planted program lets at least one defective operator through, and the check names it').toBeGreaterThan(0);
    expect(problems.join('\n'), 'each failure names its case').toMatch(/(repeat-unbounded|repeat-over-max|index-past-length|shader-field|shader-step|source-loop) \(/);
  }, 1_800_000);
});

// AC21: the validation lane. `deep-gpu run --validation` runs GPU fixtures with Metal's API and shader validation on
// and the shader translator's own bounds checks off, so an out-of-bounds access reaches the validation instead of
// being clamped, and reads every float target and storage buffer a fixture writes back for non-finite values. Three
// test fixtures (test-seam): `storage_read`, an operator reading a storage buffer, whose planted twin
// (`--planted reads_past_buffer`) reads one element past its end with its wrong pixels inside the share its golden
// allows; `float_target`, a pass writing an rgba16float target, whose planted twin (`--planted writes_nan`) writes NaN
// into one texel; and `uncovered_kind`, whose shader kind the validation can't instrument. The lane itself is a
// release lane named `gpu validation` in scripts/lanes.mjs. At the base there is no test-seam build, no --validation
// and no such lane.
import { describe, expect, it } from 'vitest';
import { arr, bool, num, obj, requireMac, run1, shown, str, strs, useBuilds, useOut, type JsonObject, type Planted } from './helpers.ts';

interface Lane { name: string; commands: string[][] }
const { releaseLanes } = (await import('../../../../scripts/lanes.mjs')) as unknown as { releaseLanes: Lane[] };

const bins = useBuilds(['test-seam']);
const out = useOut();

interface Fixture { raw: JsonObject; fixture: string; kind: string; result: string; golden: string | null; hash: string | null; pipelines: string[]; passes: string[]; findings: JsonObject[]; reason: string | null }
interface Validated { lane: { api: boolean; shader: boolean; bounds: boolean }; uncovered: string[]; fixtures: Map<string, Fixture> }

function validate(names: string[], planted?: Planted): Validated {
  const r = run1(bins.bin('test-seam'), out(), { call: 'validate', fixtures: names }, { validation: true, ...(planted ? { planted } : {}) });
  const lane = obj(r['lane'], 'validate: lane');
  const fixtures = new Map(arr(r['fixtures'], 'validate: fixtures').map((v, i) => {
    const f = obj(v, `validate: fixtures[${i}]`);
    const w = `validate: fixtures[${i}]`;
    const fx: Fixture = {
      raw: f, fixture: str(f['fixture'], `${w}.fixture`), kind: str(f['kind'], `${w}.kind`), result: str(f['result'], `${w}.result`),
      golden: typeof f['golden'] === 'string' ? f['golden'] : null, hash: typeof f['pixel_hash'] === 'string' ? f['pixel_hash'] : null,
      pipelines: strs(f['pipelines'], `${w}.pipelines`), passes: strs(f['passes'], `${w}.passes`),
      findings: arr(f['findings'], `${w}.findings`).map((x, j) => obj(x, `${w}.findings[${j}]`)), reason: typeof f['reason'] === 'string' ? f['reason'] : null,
    };
    return [fx.fixture, fx] as const;
  }));
  for (const n of names) expect(fixtures.has(n), `validate ran ${n}: ${shown(r['fixtures'])}`).toBe(true);
  return { lane: { api: bool(lane['api_validation'], 'lane.api_validation'), shader: bool(lane['shader_validation'], 'lane.shader_validation'), bounds: bool(lane['bounds_checks'], 'lane.bounds_checks') }, uncovered: strs(r['uncovered'], 'validate: uncovered'), fixtures };
}

describe('AC21 in the validation lane an out-of-bounds read and a NaN texel fail by name, their clean twins pass, and an uninstrumentable shader kind is BLOCKED, never PASS', () => {
  it('AC21 the lane is a release lane named gpu validation, and runs with Metal\'s API and shader validation on and the translator\'s bounds checks off', () => {
    requireMac();
    expect(releaseLanes.find((l) => l.name === 'gpu validation'), 'scripts/lanes.mjs has a release lane named gpu validation').toBeDefined();
    const v = validate(['storage_read']);
    expect(v.lane, 'the lane\'s validation is on and the translator\'s bounds checks are off').toEqual({ api: true, shader: true, bounds: false });
  }, 1_800_000);

  it('AC21 a planted operator reading one element past its storage buffer, its wrong pixels inside its golden\'s share, fails naming the pipeline and the binding; its clean twin passes', () => {
    requireMac();
    const clean = validate(['storage_read']).fixtures.get('storage_read')!;
    expect(clean.result, `the clean twin passes: ${shown(clean.raw)}`).toBe('PASS');
    expect(clean.findings, 'the clean twin has no finding').toEqual([]);
    expect(clean.golden, 'the clean twin matches its golden').toBe('PASS');
    expect(clean.pipelines.length, 'the fixture names its pipelines').toBeGreaterThan(0);
    const planted = validate(['storage_read'], 'reads_past_buffer').fixtures.get('storage_read')!;
    expect(planted.hash, 'the planted read changes pixels').not.toBe(clean.hash);
    expect(planted.golden, 'its wrong pixels stay inside the share its golden allows').toBe('PASS');
    expect(planted.result, `the lane fails it all the same: ${shown(planted.raw)}`).toBe('FAIL');
    const oob = planted.findings.find((x) => x['finding'] === 'out_of_bounds');
    expect(oob, `a finding names the out-of-bounds access: ${shown(planted.raw['findings'])}`).toBeDefined();
    expect(clean.pipelines, 'the finding names the fixture\'s pipeline').toContain(str(oob!['pipeline'], 'finding.pipeline'));
    const binding = obj(oob!['binding'], 'finding.binding');
    num(binding['group'], 'finding.binding.group'); num(binding['binding'], 'finding.binding.binding');
  }, 1_800_000);

  it('AC21 a planted pass writing NaN into one texel of an rgba16float target fails naming the pass and the texel; its clean twin passes', () => {
    requireMac();
    const clean = validate(['float_target']).fixtures.get('float_target')!;
    expect(clean.result, `the clean twin passes: ${shown(clean.raw)}`).toBe('PASS');
    expect(clean.findings, 'the clean twin has no finding').toEqual([]);
    expect(clean.passes.length, 'the fixture names its passes').toBeGreaterThan(0);
    const planted = validate(['float_target'], 'writes_nan').fixtures.get('float_target')!;
    expect(planted.result, `the NaN texel fails the fixture: ${shown(planted.raw)}`).toBe('FAIL');
    const nan = planted.findings.find((x) => x['finding'] === 'non_finite');
    expect(nan, `a finding names the non-finite value: ${shown(planted.raw['findings'])}`).toBeDefined();
    expect(clean.passes, 'the finding names the fixture\'s pass').toContain(str(nan!['pass'], 'finding.pass'));
    expect(obj(nan!['target'], 'finding.target')['format'], 'in its rgba16float target').toBe('rgba16float');
    const texel = arr(nan!['texel'], 'finding.texel').map((x, i) => num(x, `finding.texel[${i}]`));
    expect(texel.length === 2 && texel.every((x) => Number.isInteger(x) && x >= 0), `the finding names one texel as [x, y]: ${shown(nan!['texel'])}`).toBe(true);
    expect(nan!['value'], 'and the first value it read there').toBe('NaN');
  }, 1_800_000);

  it('AC21 a fixture whose shader kind the validation can\'t instrument is BLOCKED naming the kind, listed as uncovered, never PASS', () => {
    requireMac();
    const v = validate(['uncovered_kind', 'storage_read']);
    const f = v.fixtures.get('uncovered_kind')!;
    expect(f.result, `BLOCKED, never PASS: ${shown(f.raw)}`).toBe('BLOCKED');
    expect(f.kind.length, 'the fixture names its shader kind').toBeGreaterThan(0);
    expect(v.uncovered, `the lane lists ${f.kind} as uncovered`).toContain(f.kind);
    expect(f.reason ?? '', 'the reason names the kind').toContain(f.kind);
    expect(v.uncovered, 'a kind the lane instruments isn\'t listed as uncovered').not.toContain(v.fixtures.get('storage_read')!.kind);
  }, 1_800_000);
});

// AC1 (its first half) and AC11: the GPU seam's feature table, checked at startup, and every gated path run with its
// feature granted and with it withheld at device creation on the same adapter. The table comes from this Mac's
// adapter through the `adapter` call; a test adapter (`test-seam`, `--adapters`) stands in for an adapter that lacks
// a required feature, since this Mac has one GPU. The refusal test is the Oracle page's port of wgpu's
// request_device_error_message (tests/tests/wgpu-gpu/device.rs at eddf0b4c8f): an adapter asked for features it
// lacks must refuse, run here against our seam's startup check rather than wgpu's request_device. At the base
// `deep-gpu` has no `--features test-seam`, its `adapter` reply has no table and it has no `gated` call.
import { describe, expect, it } from 'vitest';
import {
  ADAPTER, BAD_INPUT_EXIT, REFUSED_EXIT, adapterReply, adaptersFile, gatedCall, gatedReply, isObject, obj, requireMac, run, shown, start, startArgs,
  strs, useBuilds, useOut, type AdapterReply, type TestAdapter,
} from './helpers.ts';

const bins = useBuilds(['default', 'test-seam']);
const out = useOut();

function table(): AdapterReply {
  return adapterReply(run(bins.bin(), out(), [ADAPTER])[0]!, 'the adapter call on this Mac');
}

/** A test adapter standing on this Mac's GPU that reports exactly `features` of the tier. */
const testAdapter = (features: string[]): TestAdapter => ({ name: 'test adapter', type: 'integrated_gpu', vendor: 4203, device: 140, driver: '1.0', memory: 8 * 2 ** 30, features });

/** A startup the seam refuses: exactly one line, the refusal, exit 1, no reply to the scenario. */
function refusal(args: string[], what: string): { line: Record<string, unknown>; text: string; missing: string[] } {
  const s = start(bins.bin('test-seam'), args, [{ out: out(), calls: [ADAPTER] }], 300_000);
  expect(s.signal, `${what}: no crash (signal ${s.signal}); stderr: ${s.stderr.slice(-2000)}`).toBe(null);
  expect(s.lines.length, `${what}: exactly one line, the refusal, before any reply: ${s.stdout.slice(0, 1500)}`).toBe(1);
  const line = obj(s.lines[0], `${what}: the line`);
  expect(line['ok'], `${what}: the startup is refused, not answered: ${shown(line)}`).toBe(false);
  expect(line['code'], `${what}: refused as missing_feature: ${shown(line)}`).toBe('missing_feature');
  expect(s.status, `${what}: exits ${REFUSED_EXIT}`).toBe(REFUSED_EXIT);
  return { line, text: JSON.stringify(line), missing: strs(line['missing'], `${what}: missing`) };
}

describe('AC1 the GPU feature table is checked at startup, and an adapter missing a required feature is refused with its name', () => {
  it('AC1 on this Mac\'s adapter the tier\'s table holds pass timestamps and depth-clip control each with its fallback, at least one required feature, and every required feature granted', () => {
    requireMac();
    const a = table();
    expect(a.adapter.test, 'the adapter is this Mac\'s, not a test adapter').toBe(false);
    expect(a.seam.name.length > 0 && a.seam.version.length > 0, `the GPU seam names its backend and version: ${shown(a.raw['seam'])}`).toBe(true);
    expect(a.tier.length, 'the adapter\'s tier is named').toBeGreaterThan(0);
    const names = a.table.map((r) => r.feature);
    expect(new Set(names).size, `each feature is one row: ${names.join(', ')}`).toBe(names.length);
    const f: string[] = [];
    for (const r of a.table) {
      if (r.wgpu.length === 0) f.push(`${r.feature} maps to no wgpu feature`);
      if (r.required && r.fallback !== null) f.push(`${r.feature} is required yet names the fallback ${r.fallback}`);
      if (!r.required && !r.fallback) f.push(`${r.feature} is optional but names no fallback`);
      if (r.required && !(a.reported.includes(r.feature) && a.granted.includes(r.feature))) f.push(`${r.feature} is required but this Mac's device wasn't granted it`);
      if (!r.required && r.fixtures.length === 0) f.push(`${r.feature} gates a path but lists no fixture`);
    }
    for (const [flag, what] of [['TIMESTAMP_QUERY', 'pass timestamps (or the CPU fallback)'], ['DEPTH_CLIP_CONTROL', 'depth-clip control (or a pancaked near plane)']] as const) {
      const row = a.table.find((r) => r.wgpu.includes(flag));
      if (!row) f.push(`the table has no row for ${what} (wgpu ${flag})`);
      else if (row.required || !row.fallback) f.push(`${what} is a gated feature with a fallback, but its row is ${JSON.stringify(row)}`);
    }
    if (!a.table.some((r) => r.required)) f.push('the table names no required feature, so an adapter can never be refused');
    for (const g of a.granted) if (!a.reported.includes(g)) f.push(`${g} is granted but the adapter doesn't report it`);
    expect(f, 'the feature table this Mac\'s device opened with').toEqual([]);
  }, 1_800_000);

  it('AC1 a test adapter missing one required feature is refused at startup, naming that feature; the same adapter with it starts', () => {
    requireMac();
    const a = table();
    const all = a.table.map((r) => r.feature);
    for (const r of a.table.filter((x) => x.required)) {
      const dir = out();
      const lacking = adaptersFile(dir, `lacks-${r.feature}.json`, [testAdapter(all.filter((x) => x !== r.feature))]);
      const refused = refusal(startArgs({ adapters: lacking }), `an adapter without ${r.feature}`);
      expect(refused.missing, `the refusal names exactly the missing feature ${r.feature}`).toEqual([r.feature]);
      expect(refused.text, 'the refusal names the adapter').toContain('test adapter');
      const whole = adaptersFile(dir, 'whole.json', [testAdapter(all)]);
      const started = adapterReply(run(bins.bin('test-seam'), dir, [ADAPTER], { adapters: whole })[0]!, 'the adapter call on the whole test adapter');
      expect(started.adapter.name, 'the seam opened the test adapter').toBe('test adapter');
      expect(started.adapter.test, 'the adapter reads as a test adapter').toBe(true);
      expect(started.granted, `the whole test adapter is granted ${r.feature}`).toContain(r.feature);
    }
  }, 1_800_000);

  it('AC1 ported from wgpu\'s request_device_error_message: an adapter reporting no feature at all is refused at startup, naming every required feature', () => {
    requireMac();
    const required = table().table.filter((r) => r.required).map((r) => r.feature).sort();
    expect(required.length, 'the table has a required feature to miss').toBeGreaterThan(0);
    const bare = adaptersFile(out(), 'bare.json', [testAdapter([])]);
    const refused = refusal(startArgs({ adapters: bare }), 'an adapter reporting no feature');
    expect([...refused.missing].sort(), 'the refusal names every required feature, and nothing else').toEqual(required);
    for (const f of required) expect(refused.text, `the refusal's text names ${f}`).toContain(f);
  }, 1_800_000);
});

describe('AC11 each feature in the macOS tier\'s table runs its fixtures granted and withheld at device creation on the same adapter, the absent run taking the table\'s fallback', () => {
  it('AC11 every gated feature: its fixtures pass with the feature granted on its own path, and with it withheld at device creation on the same adapter through the fallback the table names; none crashes or skips', () => {
    requireMac();
    const a = table();
    const gated = a.table.filter((r) => !r.required);
    expect(gated.length, 'the table has gated features').toBeGreaterThan(0);
    const f: string[] = [];
    for (const row of gated) {
      const [ga, gg] = run(bins.bin(), out(), [ADAPTER, gatedCall(row.feature)]);
      const granted = adapterReply(ga!, `${row.feature} granted: the adapter call`);
      const on = gatedReply(gg!, `${row.feature} granted: the gated call`);
      const [wa, wg] = run(bins.bin(), out(), [ADAPTER, gatedCall(row.feature)], { withhold: [row.feature] });
      const withheld = adapterReply(wa!, `${row.feature} withheld: the adapter call`);
      const off = gatedReply(wg!, `${row.feature} withheld: the gated call`);
      const same = (x: AdapterReply): string => `${x.adapter.name}/${x.adapter.vendor}/${x.adapter.device}/${x.adapter.driver}`;
      if (same(granted) !== same(withheld)) f.push(`${row.feature}: the withheld run opened another adapter (${same(withheld)}, not ${same(granted)})`);
      if (!granted.granted.includes(row.feature) || on.granted !== true) f.push(`${row.feature}: this Mac's device wasn't granted it, so its granted run can't run (granted ${granted.granted.join(', ')})`);
      if (withheld.granted.includes(row.feature) || !withheld.withheld.includes(row.feature) || off.granted !== false) f.push(`${row.feature}: --withhold didn't create the device without it (granted ${withheld.granted.join(', ')}; withheld ${withheld.withheld.join(', ')})`);
      if (on.feature !== row.feature || off.feature !== row.feature) f.push(`${row.feature}: the gated replies name ${on.feature} and ${off.feature}`);
      if (on.took !== row.feature) f.push(`${row.feature}: granted, it took ${on.took}, not its own path`);
      if (off.took !== row.fallback) f.push(`${row.feature}: withheld, it took ${off.took}, not the table's fallback ${row.fallback}`);
      for (const [name, g, path] of [['granted', on, row.feature], ['withheld', off, row.fallback]] as const) {
        const ran = g.fixtures.map((x) => x.fixture).sort();
        if (JSON.stringify(ran) !== JSON.stringify([...row.fixtures].sort())) f.push(`${row.feature} ${name}: ran ${ran.join(', ') || 'nothing'}, not its fixtures ${row.fixtures.join(', ')}`);
        for (const x of g.fixtures) {
          if (x.result !== 'PASS') f.push(`${row.feature} ${name}: ${x.fixture} is ${x.result}${x.reason ? ` (${x.reason})` : ''}`);
          if (x.took !== path) f.push(`${row.feature} ${name}: ${x.fixture} took ${x.took}, not ${path}`);
        }
      }
    }
    expect(f, 'each gated feature, granted and withheld').toEqual([]);
  }, 3_600_000);

  it('AC11 a required feature withheld at device creation ends the startup with a refusal naming it, never a crash', () => {
    requireMac();
    for (const row of table().table.filter((r) => r.required)) {
      const s = start(bins.bin(), startArgs({ withhold: [row.feature] }), [{ out: out(), calls: [ADAPTER] }], 300_000);
      expect(s.signal, `${row.feature} withheld: no crash`).toBe(null);
      expect(s.lines.length, `${row.feature} withheld: one line`).toBe(1);
      const line = obj(s.lines[0], `${row.feature} withheld: the line`);
      expect(line['ok'] === false && line['code'] === 'missing_feature', `${row.feature} withheld: refused as missing_feature: ${shown(line)}`).toBe(true);
      expect(JSON.stringify(line), `${row.feature} withheld: the refusal names it`).toContain(row.feature);
      expect(s.status, `${row.feature} withheld: exits ${REFUSED_EXIT}`).toBe(REFUSED_EXIT);
    }
  }, 1_800_000);
});

describe('the surface\'s fences: the test adapters and quirk table are test-seam\'s alone, and input outside the table is refused', () => {
  it('AC1 AC16 AC17 the shipped build refuses --adapters and --quirks, and every build refuses a withheld or gated feature the table doesn\'t hold, with bad_input', () => {
    requireMac();
    const a = table();
    const dir = out();
    const file = adaptersFile(dir, 'a.json', [testAdapter(a.table.map((r) => r.feature))]);
    // The same file the test-seam build takes is refused by the shipped one.
    const taken = adapterReply(run(bins.bin('test-seam'), dir, [ADAPTER], { adapters: file })[0]!, 'the test-seam build on a test adapter');
    expect(taken.adapter.test, 'the test-seam build opened the test adapter').toBe(true);
    for (const args of [['run', '--adapters', file], ['run', '--quirks', file], ['run', '--withhold', 'no_such_feature']]) {
      const s = start(bins.bin(), args, [{ out: dir, calls: [ADAPTER] }], 300_000);
      expect(s.lines.length === 1 && isObject(s.lines[0] ?? null) && (s.lines[0] as Record<string, unknown>)['code'] === 'bad_input', `${args.join(' ')} on the shipped build answers one bad_input line: ${s.stdout.slice(0, 500)}`).toBe(true);
      expect(s.status, `${args.join(' ')} exits ${BAD_INPUT_EXIT}`).toBe(BAD_INPUT_EXIT);
    }
    const s = start(bins.bin(), ['run'], [{ out: dir, calls: [gatedCall('no_such_feature')] }], 300_000);
    const reply = isObject(s.lines[0] ?? null) ? ((s.lines[0] as Record<string, unknown>)['replies'] as unknown[] | undefined)?.[0] : undefined;
    expect((reply as Record<string, unknown> | undefined)?.['code'], `gated on a feature outside the table is refused bad_input: ${s.stdout.slice(0, 500)}`).toBe('bad_input');
  }, 1_800_000);
});

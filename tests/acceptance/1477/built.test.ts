// The "If built" criteria (#1477.97f5d7c9, #1477.4e971aa0, #1477.fd384f01, #1477.035131da, #1477.1899ebe0) and their
// planted twins. Each reads the committed record's decision first (helpers.ts, builtOrProvenStop): under build it
// runs; under stop it passes only once a fresh blank, kit and panel run on this machine, counted by the lane's rule,
// proves both table arms within 4 ms at p99, so the condition is false by a measurement and not by the record's word
// (README: Under a stop decision). Timings count only on a reference Mac by the lane's rule; off macOS every test fails
// with a message starting `INCONCLUSIVE:`.
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BACK_ROWS, COLUMNS, EQUAL_ROWS, NET_ALLOCATIONS, ROW_PX, SORT_MS, SORT_ROWS, UPDATE_MS, Session, allocationProblems,
  arm, armShapeProblems, arr, builtOrProvenStop, inconclusive, judge, mulberry32, netOf, num, obj, offsetProblems,
  oneLine, orderProblems, plainOrder, readingOf, SUITE, soakEvents, soakProblems, twinBench, useBench, useDir,
  type Column, type Filter, type JsonObject, type NumberValue,
} from './helpers.ts';

const bench = useBench();
const dir = useDir();
/** Runs `body` only when our element was built; under a proven stop the criterion's condition is false. */
async function ifBuilt(body: () => Promise<void> | void): Promise<void> {
  if ((await builtOrProvenStop(bench)) === 'build') await body();
}
/** One blank arm and one `ours` arm of `bin`, and ours net of that blank. */
function oursNet(bin: string, what: string): { net: ReturnType<typeof netOf>; load: { start: number; end: number } } {
  const blank = arm(bin, 'blank');
  const ours = arm(bin, 'ours');
  for (const [name, r] of [['blank', blank], ['ours', ours]] as const) {
    expect(r.arm['status'], `${what}: ${name} is measured: ${JSON.stringify(r.arm).slice(0, 600)}`).toBe('measured');
    expect(armShapeProblems(name, r.arm), `${what}: ${name}`).toEqual([]);
  }
  return { net: netOf(readingOf(ours.arm, `${what}: ours`), readingOf(blank.arm, `${what}: blank`)), load: { start: blank.load.start, end: ours.load.end } };
}

describe('#1477.97f5d7c9 if built: at 100,000 × 8 for 8 s, update p99 is at most 4 ms and allocations per frame net of the blank arm at most 200. A planted twin that builds an element per cell fails, naming the count', () => {
  it('#1477.97f5d7c9 five paired runs of the blank arm and ours at 100,000 × 8 for 8 s: update p99 within 4 ms and allocations per frame within 200, net of the blank arm, judged by the lane', async () => {
    await ifBuilt(async () => {
      const p99: number[] = [];
      const allocations: number[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let i = 0; i < 5; i++) {
        const r = oursNet(bench(), `run ${i + 1}`);
        p99.push(r.net.p99_ms);
        allocations.push(r.net.allocations_per_frame);
        loads.push(r.load);
      }
      await judge('ours update p99 net of the blank arm (ms)', UPDATE_MS, p99, loads);
      await judge('ours allocations per frame net of the blank arm', NET_ALLOCATIONS, allocations, loads);
    });
  });

  it('#1477.97f5d7c9 planted: an element per cell (plant-element-per-cell) fails the allocation check, naming its count', async () => {
    await ifBuilt(() => {
      const twin = oursNet(twinBench('plant-element-per-cell'), 'the twin');
      const problems = allocationProblems(twin.net.allocations_per_frame);
      expect(problems, `the allocation check fails the twin (${twin.net.allocations_per_frame.toFixed(1)} allocations per frame net)`).toHaveLength(1);
      const named = Number(/makes (\d+) allocations per frame/.exec(problems[0]!)?.[1]);
      expect(named > NET_ALLOCATIONS, `its failure names a count over ${NET_ALLOCATIONS}: ${problems[0]}`).toBe(true);
    });
  });
});

describe('#1477.4e971aa0 if built: at 1,000,000 rows scrolled to the last row, every row\'s top sits within 0.5 px of its exact position. A planted f32 offset fails, naming the row', () => {
  it('#1477.4e971aa0 at 1,000,000 rows, after End and a 0.75 px scroll back up, every visible row\'s top is within 0.5 px of its exact position', async () => {
    await ifBuilt(() => { expect(offsetProblems(oneLine(bench(), ['offsets'])), 'row tops at 1,000,000 rows').toEqual([]); });
  });

  it('#1477.4e971aa0 planted: offsets kept in f32 (plant-f32-offset) fail, naming a row', async () => {
    await ifBuilt(() => {
      const problems = offsetProblems(oneLine(twinBench('plant-f32-offset'), ['offsets']));
      expect(problems.length, 'the offset check fails the twin').toBeGreaterThan(0);
      expect(problems[0], 'its failure names a row').toMatch(/^row \d+'s top is at /);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Sorting

const SORTS: { by: string; filter: Filter | null }[] = [
  { by: 'a', filter: null }, { by: 'b', filter: null }, { by: 's', filter: null }, { by: 't', filter: null },
  { by: 's', filter: { column: 'b', at_least: 0 } }, { by: 'a', filter: { column: 'b', at_least: 0 } },
];
/** Random columns over one row past 2^18: numbers with NaN, infinities and ties; text with shared 8-byte prefixes, ties and multi-byte characters. */
function equivalenceData(seed: number): Column[] {
  const rand = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const a: NumberValue[] = []; const b: NumberValue[] = []; const s: string[] = []; const t: string[] = [];
  const PREFIXES = ['', 'zz', 'shared-p', 'shared-prefix', 'shared-prefix-and-more'];
  const CHARS = ['', 'a', 'b', 'A', ' ', '~', 'é', '日'];
  for (let i = 0; i < EQUAL_ROWS; i++) {
    const r = rand();
    a.push(r < 0.05 ? 'NaN' : r < 0.07 ? 'Infinity' : r < 0.09 ? '-Infinity' : r < 0.5 ? Math.floor(rand() * 50) - 25 : Math.round((rand() * 2 - 1) * 2 ** 26) / 64);
    b.push(rand() < 0.03 ? 'NaN' : Math.round((rand() * 2 - 1) * 2 ** 20) / 64);
    s.push(pick(PREFIXES) + pick(CHARS) + pick(CHARS));
    t.push(pick(CHARS) + pick(CHARS) + pick(CHARS));
  }
  return [{ name: 'a', type: 'number', values: a }, { name: 'b', type: 'number', values: b }, { name: 's', type: 'text', values: s }, { name: 't', type: 'text', values: t }];
}
function writeData(name: string, columns: Column[]): string {
  const path = join(dir(), `${name}.json`);
  writeFileSync(path, JSON.stringify({ columns }));
  return path;
}
/** One `sort` session: each sort's order, and the time from sending it to its `sorted` answer. */
async function sorted(bin: string, data: string, sorts: { by: string; filter: Filter | null }[]): Promise<{ ms: number; count: number; order: unknown }[]> {
  const s = new Session(bin, ['sort', '--data', data]);
  try {
    const ready = await s.next('ready', 300_000);
    expect(ready['ready'], 'sort is ready').toBe(true);
    const out: { ms: number; count: number; order: unknown }[] = [];
    for (const sort of sorts) {
      const t0 = performance.now();
      s.send({ sort });
      const done = await s.next(`sorted by ${sort.by}`);
      const ms = performance.now() - t0;
      out.push({ ms, count: num(done['sorted'], 'sorted'), order: (await s.next(`the order by ${sort.by}`))['order'] });
    }
    expect((await s.close()).code, 'sort exits 0').toBe(0);
    return out;
  } finally { s.kill(); }
}
function equivalence(bin: string): Promise<string[]> {
  const columns = equivalenceData(1477);
  const data = writeData('equivalence', columns);
  return sorted(bin, data, SORTS).then((runs) => runs.flatMap((r, i) => {
    const { by, filter } = SORTS[i]!;
    const want = plainOrder(columns, by, filter);
    const what = `by ${by}${filter ? ` where ${filter.column} ≥ ${filter.at_least}` : ''}`;
    return r.count === want.length ? orderProblems(what, r.order as never, want) : [`${what}: ${r.count} rows sorted, not ${want.length}`];
  }));
}

describe('#1477.fd384f01 if built: sorting 1,000,000 shuffled rows by a number takes at most 40 ms from cold, and the typed path equals a plain comparator on random columns with NaN, infinities, ties and a filter. A planted unstable text sort fails, naming the row', () => {
  it('#1477.fd384f01 five cold sorts of 1,000,000 shuffled numbers within 40 ms, judged by the lane, each in order; and on 2^18 + 1 rows every sort equals the plain comparator', async () => {
    await ifBuilt(async () => {
      expect(await equivalence(bench()), 'the typed path against the plain comparator').toEqual([]);
      const rand = mulberry32(41);
      const values = Array.from({ length: SORT_ROWS }, (_, i) => i);
      for (let i = values.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [values[i], values[j]] = [values[j]!, values[i]!]; }
      const want = new Array<number>(SORT_ROWS);
      values.forEach((v, row) => { want[v] = row; });
      const data = writeData('shuffled', [{ name: 'n', type: 'number', values }]);
      const ms: number[] = [];
      const loads: { start: number; end: number }[] = [];
      for (let i = 0; i < 5; i++) {
        const start = loadavg()[0]!;
        const [r] = await sorted(bench(), data, [{ by: 'n', filter: null }]);
        expect(orderProblems(`cold run ${i + 1}`, r!.order as never, want), `cold run ${i + 1} is in order`).toEqual([]);
        ms.push(r!.ms);
        loads.push({ start, end: loadavg()[0]! });
      }
      await judge('a cold sort of 1,000,000 shuffled numbers (ms)', SORT_MS, ms, loads);
    });
  });

  it('#1477.fd384f01 planted: an unstable text sort (plant-unstable-text-sort) differs from the plain comparator, naming the row', async () => {
    await ifBuilt(async () => {
      const problems = await equivalence(twinBench('plant-unstable-text-sort'));
      expect(problems.length, 'the equivalence check fails the twin').toBeGreaterThan(0);
      expect(problems.join('\n'), 'its failure names a row').toMatch(/holds row \d+, where the plain comparator puts row \d+/);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// Accessibility

function probe(): string {
  const out = join(dir(), 'probe');
  const c = spawnSync('swiftc', ['-O', '-module-cache-path', join(dir(), 'swift-cache'), join(SUITE, 'probe.swift'), '-o', out], { encoding: 'utf8' });
  expect(c.status, `swiftc compiles probe.swift: ${c.stderr}`).toBe(0);
  return out;
}
const probeJson = (bin: string, args: string[]): JsonObject => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 60_000 });
  expect(r.status, `probe ${args.join(' ')}: ${r.stderr}`).toBe(0);
  return obj(JSON.parse(r.stdout) as never, `probe ${args.join(' ')}`);
};
interface AxRow { index: number; cells: string[] }
async function axRows(p: string, pid: number, want: number): Promise<AxRow[]> {
  let rows: AxRow[] = [];
  for (let i = 0; i < 20 && rows.length < want; i++) {
    rows = arr(probeJson(p, ['rows', String(pid)])['rows'], 'probe rows').map((r, k) => {
      const o = obj(r, `row node ${k}`);
      return { index: num(o['index'], `row node ${k}: AXIndex`), cells: arr(o['cells'], `row node ${k}: cells`).map(String) };
    });
    if (rows.length < want) await new Promise((r) => setTimeout(r, 250));
  }
  return rows.sort((x, y) => x.index - y.index);
}
const pair = (v: unknown, what: string): [number, number] => {
  const a = arr(v as never, what);
  return [num(a[0], `${what}[0]`), num(a[1], `${what}[1]`)];
};

describe('#1477.035131da if built: with VoiceOver active, the tree holds a row node for each visible row, and arrows, Shift ranges, Enter and ⌘C as TSV work. With no assistive tech running it costs 0 extra allocations', () => {
  it('#1477.035131da read through the Accessibility API, the tree holds one row node with 8 cells for each visible row; Down, Up, Shift-Down, ⌘C (TSV of the cells read) and Enter work; and an ours arm with no assistive tech allocates nothing for accessibility', async () => {
    await ifBuilt(async () => {
      const p = probe();
      if (probeJson(p, ['access'])['ax'] !== true) expect.fail('BLOCKED: the process running these tests needs the Accessibility permission (System Settings, Privacy & Security) to read the tree as VoiceOver does');
      const saved = spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout;
      const s = new Session(bench(), ['access']);
      try {
        const ready = await s.next('ready', 300_000);
        expect(ready['ready'], 'access is ready').toBe(true);
        const [first, last] = pair(ready['visible'], 'ready.visible');
        expect(pair(ready['selected'], 'ready.selected'), 'row 0 is selected at the start').toEqual([0, 0]);
        const rows = await axRows(p, num(ready['pid'], 'ready.pid'), last - first + 1);
        expect(rows.map((r) => r.index), `one row node for each visible row, ${first}–${last}, and no other`).toEqual(Array.from({ length: last - first + 1 }, (_, i) => first + i));
        for (const r of rows) expect(r.cells, `row ${r.index}'s node holds ${COLUMNS} cells`).toHaveLength(COLUMNS);
        const press = async (key: string): Promise<JsonObject> => { s.send({ key }); return s.next(`the key ${key}`); };
        expect(pair((await press('down'))['selected'], 'selected'), 'Down selects row 1').toEqual([1, 1]);
        expect(pair((await press('down'))['selected'], 'selected'), 'Down again selects row 2').toEqual([2, 2]);
        expect(pair((await press('up'))['selected'], 'selected'), 'Up selects row 1').toEqual([1, 1]);
        await press('shift-down');
        expect(pair((await press('shift-down'))['selected'], 'selected'), 'Shift-Down twice selects rows 1–3').toEqual([1, 3]);
        await press('cmd-c');
        const tsv = spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout.replace(/\n$/, '');
        expect(tsv, '⌘C copies rows 1–3 as TSV of the cells the tree holds').toBe(rows.filter((r) => r.index >= 1 && r.index <= 3).map((r) => r.cells.join('\t')).join('\n'));
        const activated = num((await press('enter'))['activated'], 'Enter activates a row');
        expect(activated >= 1 && activated <= 3, `Enter activates a selected row, got ${activated}`).toBe(true);
        expect((await s.close()).code, 'access exits 0').toBe(0);
      } finally {
        s.kill();
        spawnSync('pbcopy', [], { input: saved });
      }
      const withTree = oneLine(bench(), ['arm', 'ours']);
      if (withTree['assistive'] !== false) inconclusive(`assistive tech is running on this machine, so the no-assistive-tech reading can't be taken: ${JSON.stringify(withTree['assistive'])}`);
      expect(withTree['access_allocations'], 'with no assistive tech running, accessibility allocates nothing over the ours arm').toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------------
// The soak

describe('#1477.1899ebe0 if built: a soak of random events with hostile sizes (usize::MAX ÷ 4 rows, NaN and infinite scrolls, zero sizes) keeps every invariant, and scrolling down 1,000 rows and back shapes 0 strings on the way back', () => {
  it('#1477.1899ebe0 2,000 seeded events with hostile sizes keep every invariant after each one; down 1,000 rows of 100,000 × 8 and back shapes strings down and 0 back', async () => {
    await ifBuilt(async () => {
      const events = soakEvents(1477);
      const s = new Session(bench(), ['soak']);
      const states: JsonObject[] = [];
      try {
        const ready = await s.next('ready', 300_000);
        expect(ready['ready'], 'soak is ready').toBe(true);
        expect([ready['rows'], ready['viewport']], 'the soak starts at 100,000 rows in a 1,200 × 700 viewport').toEqual(['100000', [1200, 700]]);
        for (const e of events) s.send(e);
        for (let i = 0; i < events.length; i++) states.push(await s.next(`event ${i} ${JSON.stringify(events[i])}`));
        expect((await s.close()).code, 'the soak exits 0, without a panic').toBe(0);
      } finally { s.kill(); }
      expect(soakProblems(events, states, { rows: '100000', viewport: [1200, 700] }), 'the invariants').toEqual([]);
      const back = oneLine(bench(), ['back']);
      expect([back['rows'], back['down_rows']], `down ${BACK_ROWS} rows of 100,000 at ${ROW_PX} px`).toEqual([100_000, BACK_ROWS]);
      expect(num(back['shaped_down'], 'shaped_down') > 0, `strings are shaped on the way down (${String(back['shaped_down'])}), so the count reads something`).toBe(true);
      expect(back['shaped_back'], 'strings shaped on the way back').toBe(0);
    });
  });
});

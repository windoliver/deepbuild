// The criteria that hold whatever the decision: the record (#1477.e66d9bdb), the 100,000-row variable-height list's
// budget (#1477.46aa3ab4), a remeasure above the viewport (#1477.466ab542), the strings shaped on a return
// (#1477.af9cb943) and the #1433 citation (#1477.55753e50). One full `measure` runs once for the file, on this
// machine, and its record is judged beside the committed one: the committed record counts only when a fresh
// measurement here decides the same. Timings count only on a reference Mac by the lane's rule (scripts/benchmark.mjs),
// and anywhere else read INCONCLUSIVE; off macOS every test fails with a message starting `INCONCLUSIVE:`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIST_ARMS, LIST_BYTES, ROW_PX, UPDATE_MS, WINDOW, arm, armShapeProblems, citationProblems, committed, expectJudged,
  inconclusive, judge, judgeRecord, measure, netOf, num, obj, oneLine, readingOf, requireMac, shapedProblems, str,
  useBench, useDir, type JsonObject,
} from './helpers.ts';

const bench = useBench();
const dir = useDir();
let freshRecord: JsonObject | undefined;
/** This run's full record, measured once for the file. */
const fresh = (): JsonObject => (freshRecord ??= measure(bench(), join(dir(), 'record.json')));

describe('#1477.e66d9bdb the record gives all arms with their fingerprint, and an unrun arm reads INCONCLUSIVE. It ends in one line: stop, or build', () => {
  it('#1477.e66d9bdb an arm left out reads INCONCLUSIVE and so does the decision; a full run and the committed record give every arm measured with its fingerprint on a quiet reference Mac, net of the blank arm, and end in the same stop or build', async () => {
    requireMac();
    const record = measure(bench(), join(dir(), 'partial.json'), ['blank', 'list-10k']);
    const partial = { ...(await judgeRecord(record, 'a record of blank and list-10k only')), record };
    expect(partial.problems, 'the partial record').toEqual([]);
    expect(Object.keys(partial.arms).sort(), 'the partial record measured blank and list-10k').toEqual(['blank', 'list-10k']);
    const left = ['kit', 'list-100k', 'panel', ...('ours' in obj(partial.record['arms'], 'the partial arms') ? ['ours'] : [])];
    expect(partial.unrun.map((u) => u.split(':')[0]).sort(), 'the arms it didn\'t run read INCONCLUSIVE, each with its reason').toEqual(left.sort());
    expect(partial.word, `with kit and panel unrun, the decision is INCONCLUSIVE, not stop or build: ${partial.line}`).toBe('INCONCLUSIVE');

    const now = await judgeRecord(fresh(), 'this run\'s record');
    expectJudged(now, 'this run\'s record');
    const kept = await judgeRecord(committed(), 'docs/spikes/1477/record.json');
    expectJudged(kept, 'docs/spikes/1477/record.json');
    if (kept.word !== now.word) inconclusive(`the committed record decides ${kept.line}, but this run decides ${now.line}`);
    console.log(`decision: ${kept.line}`);
  });
});

describe('#1477.46aa3ab4 a variable-height list of 100,000 rows has update p99 under 4 ms and working set above data under 64 MB, net of the blank arm, or the record names what was built instead', () => {
  it('#1477.46aa3ab4 five paired runs of the blank arm and list-100k: update p99 within 4 ms and working set above data within 64,000,000 bytes, net of the blank arm, judged by the lane, on the list the record names', async () => {
    const b = bench();
    const kept = obj(obj(committed()['arms'], 'the committed arms')['list-100k'], 'the committed list-100k arm');
    const named = str(kept['list'], 'the committed list-100k arm: list');
    const p99: number[] = [];
    const bytes: number[] = [];
    const loads: { start: number; end: number }[] = [];
    for (let i = 0; i < 5; i++) {
      const blank = arm(b, 'blank');
      const list = arm(b, 'list-100k');
      for (const [name, r] of [['blank', blank], ['list-100k', list]] as const) {
        expect(r.arm['status'], `run ${i + 1}: ${name} is measured: ${JSON.stringify(r.arm).slice(0, 600)}`).toBe('measured');
        expect(armShapeProblems(name, r.arm), `run ${i + 1}: ${name}`).toEqual([]);
      }
      expect(list.arm['list'], `run ${i + 1} measured the list the record names`).toBe(named);
      const net = netOf(readingOf(list.arm, `run ${i + 1}: list-100k`), readingOf(blank.arm, `run ${i + 1}: blank`));
      p99.push(net.p99_ms);
      bytes.push(net.working_set_above_data_bytes);
      loads.push({ start: blank.load.start, end: list.load.end });
    }
    console.log(`list-100k measured ${named}`);
    await judge('list-100k update p99 net of the blank arm (ms)', UPDATE_MS, p99, loads);
    await judge('list-100k working set above data net of the blank arm (bytes)', LIST_BYTES, bytes, loads);
  });
});

describe('#1477.466ab542 remeasuring a row above the viewport moves the row under the pointer by 0 px', () => {
  it('#1477.466ab542 in the 100,000-row variable-height list, a row above the viewport changes height and is remeasured; the row under the pointer stays the same row at the same top', () => {
    const r = oneLine(bench(), ['remeasure']);
    expect(r['rows'], 'remeasure runs the 100,000-row list').toBe(100_000);
    const pointer = r['pointer'];
    expect(pointer, 'the pointer sits at the window\'s middle').toEqual([WINDOW[0] / 2, WINDOW[1] / 2]);
    const before = obj(r['before'], 'remeasure: before');
    const after = obj(r['after'], 'remeasure: after');
    const changed = obj(r['changed'], 'remeasure: changed');
    const first = num(r['first_visible'], 'remeasure: first_visible');
    const row = num(changed['row'], 'remeasure: changed.row');
    expect(row < first, `the row remeasured, ${row}, is above the viewport, whose first row is ${first}`).toBe(true);
    const grew = Math.abs(num(changed['height_after'], 'changed.height_after') - num(changed['height_before'], 'changed.height_before'));
    expect(grew >= ROW_PX, `the remeasured row's height changed by at least a row (${grew} px)`).toBe(true);
    expect(after['row'], `the row under the pointer is still row ${JSON.stringify(before['row'])}`).toBe(num(before['row'], 'before.row'));
    const moved = num(after['top'], 'after.top') - num(before['top'], 'before.top');
    expect(Math.abs(moved), `the row under the pointer moved ${moved} px`).toBeLessThan(0.01);
  });
});

describe('#1477.af9cb943 the variable-height arm reports strings shaped per frame on a return over rows shown in the last 240 frames. An unrun reading is INCONCLUSIVE', () => {
  it('#1477.af9cb943 each list arm of this run\'s record reports strings shaped per frame 120 frames down and 120 back', async () => {
    requireMac();
    const arms = obj(fresh()['arms'], 'this run\'s arms');
    for (const name of LIST_ARMS) {
      const a = obj(arms[name], `this run's ${name} arm`);
      if (a['status'] === 'INCONCLUSIVE') inconclusive(`${name} didn't run: ${String(a['reason'])}`);
      expect(shapedProblems(name, a), `${name}'s shaped reading`).toEqual([]);
      const s = obj(a['shaped'], `${name}: shaped`);
      console.log(`${name}: ${String(s['down'])} strings shaped per frame down, ${String(s['back'])} back`);
    }
  });
});

describe('#1477.55753e50 the stop-or-build line cites #1433\'s gpui-fast list reading when it exists, so we don\'t build what the backend gives', () => {
  it('#1477.55753e50 this run\'s record and the committed one cite #1433\'s gpui-fast list reading, by pointer and value, when docs/spikes/1433/record.json exists, and cite none when it doesn\'t', () => {
    requireMac();
    expect(citationProblems(committed(), 'docs/spikes/1477/record.json'), 'the committed record').toEqual([]);
    expect(citationProblems(fresh(), 'this run\'s record'), 'this run\'s record').toEqual([]);
  });
});

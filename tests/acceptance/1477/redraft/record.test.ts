// #1477.e66d9bdb as amended on 2026-11-09: the record gives all arms with their fingerprint, an unrun arm reads
// INCONCLUSIVE, a table arm that can't show its rows reads missed with the reason and counts as a miss, and the record
// ends in one line: stop, or build. Replaces the first draft's #1477.e66d9bdb test in ../record.test.ts; every other
// test there and in ../built.test.ts stands (README). Off macOS it fails with a message starting `INCONCLUSIVE:`.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { committed, expectJudged, inconclusive, measure, obj, requireMac, useBench, useDir } from '../helpers.ts';
import { judgeRecord } from './helpers.ts';

const bench = useBench();
const dir = useDir();

describe('#1477.e66d9bdb the record gives all arms with their fingerprint, and an unrun arm reads INCONCLUSIVE; a table arm that can\'t show its rows reads missed, with the reason, and counts as a miss. It ends in one line: stop, or build', () => {
  it('#1477.e66d9bdb an arm left out reads INCONCLUSIVE and so does the decision; a full run and the committed record give every arm with its fingerprint, measured on a quiet reference Mac or, for a table that can\'t show its rows, missed with the reason, and end in the same stop or build, a missed table counting as a miss', async () => {
    requireMac();
    const partialRecord = measure(bench(), join(dir(), 'partial.json'), ['blank', 'list-10k']);
    const partial = await judgeRecord(partialRecord, 'a record of blank and list-10k only');
    expect(partial.problems, 'the partial record').toEqual([]);
    expect(Object.keys(partial.arms).sort(), 'the partial record measured blank and list-10k').toEqual(['blank', 'list-10k']);
    const left = ['kit', 'list-100k', 'panel', ...('ours' in obj(partialRecord['arms'], 'the partial arms') ? ['ours'] : [])];
    expect(partial.unrun.map((u) => u.split(':')[0]).sort(), 'the arms it didn\'t run read INCONCLUSIVE, each with its reason, none missed').toEqual(left.sort());
    expect(partial.word, `with kit and panel unrun, the decision is INCONCLUSIVE, not stop or build: ${partial.line}`).toBe('INCONCLUSIVE');

    const now = await judgeRecord(measure(bench(), join(dir(), 'record.json')), 'this run\'s record');
    expectJudged(now, 'this run\'s record');
    const kept = await judgeRecord(committed(), 'docs/spikes/1477/record.json');
    expectJudged(kept, 'docs/spikes/1477/record.json');
    if (kept.word !== now.word) inconclusive(`the committed record decides ${kept.line}, but this run decides ${now.line}`);
    console.log(`missed: ${kept.missed.join('; ') || 'none'}`);
    console.log(`decision: ${kept.line}`);
  });
});

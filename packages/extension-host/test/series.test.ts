// #262's scope beyond its checkbox criteria: "for each minute and hour that closes, the hub writes one evidence file
// of the source's rollups". A hub that restarts mid-window still writes that window's rollup over every value it
// landed, before and after the restart, and closes a window whose source is never called again.
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord, type Connection } from '@deepbuild/record';
import { SeriesStore, type Rollup } from '../src/series.js';

const dirs: string[] = [];
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const CORE: Connection = { writer: 'core', actor: 'you', scope: 'you' };
const SOURCE = { name: 'ext.shop.metrics', timeout: 5_000 };
const at = (hms: string) => Date.parse(`2026-11-02T${hms}Z`);

describe('#262 rollups across a hub restart', () => {
  it('each window open at a restart gets one rollup over the values landed before and after it', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-series-test-')));
    dirs.push(dir);
    let now = at('10:00:10');
    const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: () => now });
    const record = await openRecord({ path: join(dir, 'ledger.db'), now: () => now, evidence });
    const open = () => new SeriesStore({ record, evidence, now: () => now, connection: CORE, timeoutOf: (s) => (s === SOURCE.name ? SOURCE.timeout : undefined) });
    const land = async (store: SeriesStore, hms: string, v: number) => { now = at(hms); await store.land(SOURCE, now, new Map([['checkout', v]])); };

    const before = open();
    await land(before, '10:00:10', 1);
    await land(before, '10:00:20', 2);
    // The hub restarts: a new store on the same record and evidence.
    const after = open();
    await land(after, '10:00:30', 6);
    now = at('10:01:05');
    await after.tick();
    expect((await after.rollup(SOURCE.name, 'minute', at('10:00:00')) as Record<string, Rollup> | null)?.checkout, 'the 10:00 minute').toEqual({ min: 1, max: 6, mean: 3, last: 6, count: 3 });

    // Values land in 10:01, the hub restarts, and the source is never called again: the minute still closes.
    await land(after, '10:01:10', 4);
    await land(after, '10:01:20', 8);
    const idle = open();
    now = at('10:02:05');
    await idle.tick();
    expect((await idle.rollup(SOURCE.name, 'minute', at('10:01:00')) as Record<string, Rollup> | null)?.checkout, 'the 10:01 minute').toEqual({ min: 4, max: 8, mean: 6, last: 8, count: 2 });
    now = at('11:00:05');
    await idle.tick();
    expect((await idle.rollup(SOURCE.name, 'hour', at('10:00:00')) as Record<string, Rollup> | null)?.checkout, 'the 10:00 hour').toEqual({ min: 1, max: 8, mean: 4.2, last: 8, count: 5 });
    const rows = (await record.raw("SELECT span, start FROM rollups WHERE source = ? ORDER BY start, span", [SOURCE.name])) as { span: string; start: number }[];
    expect(rows.map((r) => `${r.span} ${new Date(Number(r.start)).toISOString().slice(11, 16)}`), 'one rollup a window').toEqual(['hour 10:00', 'minute 10:00', 'minute 10:01']);
    await record.close();
  });
});

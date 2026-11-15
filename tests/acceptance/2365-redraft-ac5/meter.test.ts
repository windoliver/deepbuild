// #2365 AC5's read meter (meter.ts) sees each way of reading a file that it wraps, through named imports as an
// archive would write them, and counts nothing for a stat or for reading another file. Without this, "reads none of
// it" could pass for a meter that sees nothing.
import { createReadStream, openSync, readFileSync, readSync, closeSync, statSync, writeFileSync } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { removeTemps, tempDir } from '../20/helpers.ts';
import { meterReads } from './meter.ts';
import { AC5 } from './scenarios.ts';

afterAll(removeTemps);

describe(`AC5 ${AC5} the read meter`, () => {
  it('AC5 the meter counts the bytes each way of reading a watched file reads, and nothing for a stat or another file', async () => {
    const dir = tempDir('meter');
    const watched = join(dir, 'watched.jsonl');
    const other = join(dir, 'other.jsonl');
    const body = Buffer.from('{"a":1}\n{"b":2}\n{"c":3}\n');
    writeFileSync(watched, body);
    writeFileSync(other, body);
    const ways: [string, () => Promise<unknown>][] = [
      ['fs/promises readFile', () => readFile(watched)],
      ['fs readFileSync', async () => readFileSync(watched)],
      ['fs createReadStream', () => new Promise((done, fail) => { const s = createReadStream(watched); s.on('data', () => undefined).on('end', done).on('error', fail); })],
      ['fs/promises open + FileHandle.read', async () => { const h = await open(watched, 'r'); try { await h.read(Buffer.alloc(body.length), 0, body.length, 0); } finally { await h.close(); } }],
      ['fs/promises open + FileHandle.readLines', async () => { const h = await open(watched, 'r'); for await (const line of h.readLines()) void line; }],
      ['fs openSync + readSync', async () => { const fd = openSync(watched, 'r'); try { readSync(fd, Buffer.alloc(body.length), 0, body.length, 0); } finally { closeSync(fd); } }],
    ];
    for (const [name, read] of ways) {
      const meter = await meterReads([watched]);
      try { await read(); } finally { meter.stop(); }
      expect(meter.bytes.get(watched), `the meter sees ${name}`).toBeGreaterThanOrEqual(body.length);
    }
    const meter = await meterReads([watched]);
    try {
      await stat(watched);
      statSync(watched);
      await readFile(other);
      readFileSync(other);
    } finally {
      meter.stop();
    }
    expect([meter.bytes.get(watched), meter.whole], 'a stat of the watched file and reads of another file count nothing').toEqual([0, []]);
  }, 60_000);
});

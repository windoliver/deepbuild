// The store's records (#1866) read as a Map of them would, whatever is put, taken away, placed, synced and reopened:
// hashes that begin alike, places freed and used again, and a journal another process made shorter.
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { Stored } from '../src/index.js';
import { Records } from '../src/records.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

const random = (seed: number) => (): number => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};
const field = (r: Stored) => ({ size: r.size, kind: r.kind, storedAt: r.storedAt, origin: r.origin, redaction: r.redaction, parts: r.parts !== undefined, sealed: r.sealed === true });

it.each([1, 2, 3, 4, 5, 6])('reads as a Map of its records does, run %i', (seed) => {
  const next = random(seed);
  const pick = (n: number): number => Math.floor(next() * n);
  const dir = mkdtempSync(join(tmpdir(), 'dh1866-records-'));
  dirs.push(dir);
  const journal = join(dir, 'records.jsonl');
  writeFileSync(journal, '');
  let records = new Records(journal);
  const model = new Map<string, Stored>();
  const stamps = new Map<string, { ino: bigint; ctimeNs: bigint }>();
  // 400 hashes over four beginnings, so most share a place in the table with a hundred others.
  const hashes = Array.from({ length: 400 }, (_, n) => `${['00000000', 'ffffffff', '0000ff00', '01020304'][n % 4]!}${n.toString(16).padStart(56, '0')}`);
  const made = (sha256: string): Stored => ({
    sha256, size: pick(2 ** 40), kind: `kind-${pick(9)}`, storedAt: 1.7e12 + pick(1e9),
    origin: (['deepbuild', 'you', 'agent'] as const)[pick(3)]!, redaction: (['complete', 'incomplete', 'unknown'] as const)[pick(3)]!,
    ...(pick(4) ? {} : { sealed: true }), ...(pick(4) ? {} : { parts: ['a', 'b'] }), note: 'é'.repeat(pick(40)),
  } as unknown as Stored);
  const pending: Stored[] = [];
  const write = (record: Stored): void => {
    const line = Buffer.from(JSON.stringify(record));
    const at = readFileSync(journal).length;
    appendFileSync(journal, Buffer.concat([line, Buffer.from('\n')]));
    records.placed(record, at, line.length);
  };
  for (let step = 0; step < 3000; step++) {
    const sha = hashes[pick(hashes.length)]!;
    const what = pick(100);
    if (what < 45) {
      const record = made(sha);
      records.set(record);
      model.set(sha, record);
      pending.push(record);
    } else if (what < 70) {
      const record = pending.shift();
      if (record) write(record);
    } else if (what < 90) {
      for (const r of pending.splice(0)) write(r);
      records.delete(sha);
      appendFileSync(journal, `${JSON.stringify({ removed: sha })}\n`);
      model.delete(sha);
      stamps.delete(sha);
    } else if (what < 98) {
      const stamp = { ino: BigInt(pick(2 ** 31)), ctimeNs: 1n + BigInt(pick(2 ** 31)) * 1_000_000_007n };
      if (records.sync(sha, stamp)) stamps.set(sha, stamp);
    } else {
      for (const r of pending.splice(0)) write(r);
      if (pick(2)) {
        // Another process removes some and compacts: every line moves, and the first read finds each again.
        for (const of of [...model.keys()]) if (pick(8) === 0) model.delete(of);
        writeFileSync(journal, [JSON.stringify({ approved: 'x'.repeat(1 + pick(400)), reasons: [] }), ...[...model.values()].map((r) => JSON.stringify(r)), ''].join('\n'));
        for (const of of hashes) if (records.has(of)) records.get(of);
      } else {
        records = new Records(journal);
        records.take(readFileSync(journal), () => undefined);
      }
      stamps.clear();
    }
    for (const of of step % 25 ? [sha] : hashes) expect(records.synced(of), of).toEqual(stamps.get(of));
    expect(records.has(sha)).toBe(model.has(sha));
    expect(records.get(sha)).toEqual(model.get(sha));
    if (model.has(sha)) expect(records.field(sha)).toMatchObject(field(model.get(sha)!));
    else expect(records.field(sha)).toBeUndefined();
    expect(records.size).toBe(model.size);
  }
  for (const r of pending.splice(0)) write(r);
  expect(new Map(records.each())).toEqual(new Map([...model].map(([sha, r]) => [sha, field(r)])));
  for (const sha of hashes) expect(records.get(sha), sha).toEqual(model.get(sha));
  const reopened = new Records(journal);
  reopened.take(readFileSync(journal), () => undefined);
  expect(new Map(reopened.each())).toEqual(new Map(records.each()));
  for (const sha of hashes) expect(records.synced(sha), sha).toEqual(stamps.get(sha));
});

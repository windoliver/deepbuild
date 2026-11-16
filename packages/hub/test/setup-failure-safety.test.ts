// #2074: failure evidence is bounded/scrubbed and cannot be closed by an older claim's late result.
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { world } from './setup-failure-world.ts';

it('scrubs a setup error before recording its verdict, open item or session reading', async () => {
  const held = randomBytes(24).toString('hex');
  const token = `ghp_${randomBytes(20).toString('hex')}`;
  const w = await world([held]);
  try {
    w.ports.checkouts.snapshot = async () => { throw Error(`setup refused ${held} ${token}`); };
    const { claim, lane } = await w.claim();
    expect(lane.status, `${claim}: its failure was recorded`).toBe('fulfilled');
    const rows = await w.ports.record.raw("SELECT kind, data FROM events WHERE kind IN ('verdict.made', 'open_item.opened', 'session.reading')") as { kind: string; data: string }[];
    expect(rows.map((r) => r.kind)).toEqual(expect.arrayContaining(['verdict.made', 'open_item.opened', 'session.reading']));
    // Boolean assertions keep runtime-generated canaries out of failing output too.
    expect(rows.every((r) => !r.data.includes(held) && !r.data.includes(token)), `${claim}: no credential persisted`).toBe(true);
  } finally { await w.close(); }
});

it('a long setup error keeps owner and remedy, and the lane resolves with a recorded reading', async () => {
  const w = await world();
  try {
    w.ports.checkouts.snapshot = async () => { throw Error(`index unreadable: ${'x'.repeat(20_000)}`); };
    const { claim, lane } = await w.claim();
    expect.soft(lane.status, `${claim}: publishing the failure does not fail its schema`).toBe('fulfilled');
    const rows = await w.ports.record.raw("SELECT kind, data FROM events WHERE kind IN ('verdict.made', 'open_item.opened', 'session.reading')") as { kind: string; data: string }[];
    const verdict = rows.find((r) => r.kind === 'verdict.made');
    expect.soft(verdict && JSON.parse(verdict.data).outcome, claim).toBe('BLOCKED');
    expect.soft(Boolean(verdict?.data.includes('owner: you')), `${claim}: owner survived the bound`).toBe(true);
    expect.soft(rows.some((r) => r.kind === 'open_item.opened' && /resolve|rerun|run.*again/i.test(r.data)), `${claim}: remedy survived the bound`).toBe(true);
    expect.soft(rows.some((r) => r.kind === 'session.reading' && r.data.includes('BLOCKED')), `${claim}: reading was recorded`).toBe(true);
  } finally { await w.close(); }
});

it('an older slow check ending cannot close a newer claim\'s setup failure item', async () => {
  const w = await world();
  try {
    const older = await w.claim(true);
    w.ports.checkouts.snapshot = async () => { throw Error('index held by another process'); };
    const newer = await w.claim();
    const open = () => w.ports.record.raw('SELECT text FROM open_items WHERE task_ref = ? AND closed IS NULL', [w.task]) as Promise<{ text: string }[]>;
    expect((await open()).some((r) => r.text.includes('index held')), `${newer.claim}: failure item opened`).toBe(true);
    await w.ports.gate.turnEnded(older.claim);
    for (const end = Date.now() + 15_000; w.ports.gate.verdictOf(older.claim)?.outcome === 'pending' && Date.now() < end;) await new Promise((done) => setTimeout(done, 20));
    expect(w.ports.gate.verdictOf(older.claim)?.outcome, `${older.claim}: older check really ended`).toBe('FAIL');
    await w.ports.judging.judged(older.claim);
    expect((await open()).some((r) => r.text.includes('index held')), `${newer.claim}: only qualifying recovery may close its item`).toBe(true);
  } finally { await w.close(); }
}, 30_000);

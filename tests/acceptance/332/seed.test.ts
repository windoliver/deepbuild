// #332 AC4 and AC8: seed records. A journey is a check that needs the app running, started through the hub's
// `run.start` with `environment: true` in a plain folder standing for its temporary checkout (#331's surface); its
// stack comes up from that folder. The environment names a seed step and the variable that hands it the template
// and each run its own clone (`seed: { run, database: DATABASE }`, README). The seed step (fixtures/seed.mjs)
// writes a file database at $DATABASE and, unless told not to, its completion record {source, copied_at,
// migration} at $DEEP_SEED_RECORD. The app (fixtures/server.mjs) serves its $DATABASE's content at /db; the journey
// (fixtures/journey.mjs) asks it and passes only on a seeded database.
//
// AC4: a seed step that leaves no completion record makes the journey's run `missing` (BLOCKED), its findings
// naming the missing seed record, and the journey's own process never runs.
// AC8: the run's database is a clone of the template, not the template, and the run's record carries the
// template's seed record (source, copied_at, migration) with the template's digest (SHA-256 of the template's
// bytes as the seed step left them) and the time it was cloned (within the run); a run on a template kept without
// its record is BLOCKED naming it; and the planted cloner that copies the database without its record
// (DEEP_HUB_PLANT=env-clone-without-record) fails the first reading.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, Client, COMMIT, type EnvBlock, JOURNEY, makeCheckout, NODE, READY, seedRun, serverUp, sha256, startHub, stopHub, sub, tempDir, ulid, waitFor, type Line } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The template's bytes, exactly as fixtures/seed.mjs writes them, and the seed record it leaves. */
const TEMPLATE = 'orders=0\nproducts=3\nseeded-by=dh332-fixture\n';
const RECORD = { source: 'fixtures://shop/snapshot-2026-10-01.sql', copied_at: '2026-10-01T04:00:00.000Z', migration: '20261015120000_add_orders' };

const env = (...seedFlags: string[]): EnvBlock => ({ up: serverUp(), ports: ['web'], ready: READY, within: 20, seed: { run: seedRun(...seedFlags), database: 'DATABASE' } });

async function journey(client: Client, checkout: string): Promise<{ run: string; started: Line; done: Line }> {
  const { run } = await client.call('run.start', { check: 'journey:checkout', claim: `claim:${ulid()}`, commit: COMMIT, cwd: checkout, argv: [NODE, JOURNEY], environment: true }, 60_000);
  const done = await waitFor(async () => (await client.events('run.finished')).find((e) => e.data?.run === run), 90_000, `run.finished for ${run}`);
  const started = (await client.events('run.started')).find((e) => e.data?.run === run)!;
  return { run: run as string, started, done };
}

/** Every value in a JSON value, by key, at any depth. */
function entries(value: unknown, out: [string, unknown][] = []): [string, unknown][] {
  if (Array.isArray(value)) for (const v of value) entries(v, out);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) { out.push([k, v]); entries(v, out); }
  return out;
}
const asTime = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? Date.parse(v) : undefined);

/**
 * The reading AC8 makes of a run's record: some event naming the run carries the seed's record (its source, when
 * that source was copied and its migration revision), the template's digest, and a time it was cloned within the
 * run. Null when it does; otherwise what is missing.
 */
function cloneRecordProblem(events: Line[], run: string, from: number, to: number): string | null {
  const digest = sha256(TEMPLATE);
  const naming = events.filter((e) => e.kind !== 'run.started' && e.kind !== 'run.finished' && JSON.stringify(e).includes(run));
  const missing: string[] = [];
  const carries = naming.find((e) => {
    const text = JSON.stringify(e.data ?? {});
    const kv = entries(e.data);
    const cloned = kv.some(([k, v]) => /clon/i.test(k) && (() => { const t = asTime(v); return t !== undefined && t >= from - 1000 && t <= to + 1000; })());
    return text.includes(RECORD.source) && text.includes(RECORD.copied_at) && text.includes(RECORD.migration) && text.includes(digest) && cloned;
  });
  if (carries) return null;
  const all = JSON.stringify(naming);
  if (!all.includes(RECORD.source)) missing.push('the seed record\'s source');
  if (!all.includes(RECORD.copied_at)) missing.push('when the source was copied');
  if (!all.includes(RECORD.migration)) missing.push('the migration revision');
  if (!all.includes(digest)) missing.push(`the template's digest sha256 ${digest}`);
  missing.push('in one event naming the run, with a clone time within it');
  return `the run's record lacks its database's seed record: ${missing.join('; ')} (events naming ${run}: ${all.slice(0, 1500)})`;
}

describe('AC4 #332.0d4c185f a journey on a database seeded without its completion record is BLOCKED, naming the missing record', () => {
  it('AC4 a seed step that exits 0 without leaving its record makes the journey\'s run missing (BLOCKED), its findings naming the missing seed record, and the journey never runs', async () => {
    const checkout = makeCheckout(env('--no-record'));
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const { done } = await journey(client, checkout);
      expect(done.data.outcome, `the journey's run is missing, which the verdict table makes BLOCKED (${JSON.stringify(done.data)})`).toBe('missing');
      expect(existsSync(join(checkout, 'seed.json')), 'the seed step ran (it wrote seed.json in the checkout)').toBe(true);
      const findings = ((done.data.findings ?? []) as string[]).join(' | ');
      expect(findings, 'its findings name the seed').toMatch(/seed/i);
      expect(findings, 'and the record it didn\'t leave').toMatch(/record/i);
      expect(existsSync(join(checkout, 'journey.json')), 'the journey ran on a database seeded without its record').toBe(false);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 180_000);
});

describe('AC8 #332.92539e14 a run\'s database cloned from the seed\'s template carries the template\'s seed record with the template\'s digest and the time it was cloned; a clone of a template kept without its record is BLOCKED, naming the missing record, and a cloner that copies the database without its record fails this test', () => {
  it('AC8 the journey runs on its own clone of the seeded template, and the run\'s record carries the seed\'s source, copy time and migration with the template\'s digest and the time it was cloned', async () => {
    const checkout = makeCheckout(env());
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const { run, started, done } = await journey(client, checkout);
      expect(done.data.outcome, `the journey passed on a seeded database (${JSON.stringify(done.data)})`).toBe('passed');
      const seeded = JSON.parse(readFileSync(join(checkout, 'seed.json'), 'utf8')) as Line;
      const seen = JSON.parse(readFileSync(join(checkout, 'journey.json'), 'utf8')) as Line;
      expect(seen.db?.content, 'the app served the seeded database').toBe(TEMPLATE);
      expect(typeof seen.db?.database, 'the app was given its database in DATABASE').toBe('string');
      expect(seen.db.database, 'the app was given the template itself, not a clone of it').not.toBe(seeded.database);
      expect(cloneRecordProblem(await client.events(), run, started.ts as number, done.ts as number)).toBeNull();
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 180_000);

  it('AC8 a template kept without its record: the run that seeds it and the next run on it are each BLOCKED, naming the missing seed record, and no journey runs', async () => {
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      for (const which of ['the run that seeds the template', 'the next run, on the kept template']) {
        const checkout = makeCheckout(env('--no-record'));
        const { done } = await journey(client, checkout);
        expect(done.data.outcome, `${which} is missing, BLOCKED (${JSON.stringify(done.data)})`).toBe('missing');
        const findings = ((done.data.findings ?? []) as string[]).join(' | ');
        expect(findings, `${which}: its findings name the seed record it lacks`).toMatch(/seed/i);
        expect(findings, `${which}: its findings name the missing record`).toMatch(/record/i);
        expect(existsSync(join(checkout, 'journey.json')), `${which}: the journey ran on a clone with no record`).toBe(false);
      }
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 240_000);

  it('AC8 (wrong program) a cloner that copies the database without its record (DEEP_HUB_PLANT=env-clone-without-record) fails the reading: the run\'s record carries no seed record for its clone', async () => {
    const checkout = makeCheckout(env());
    const hub = await startHub(sub(tempDir(), 'root'), { DEEP_HUB_PLANT: 'env-clone-without-record' });
    const client = await Client.open(hub);
    try {
      const { run, started, done } = await journey(client, checkout);
      expect(existsSync(join(checkout, 'seed.json')), 'the scenario formed: the seed step ran').toBe(true);
      const problem = cloneRecordProblem(await client.events(), run, started.ts as number, done.ts as number);
      expect(problem, 'the reading passes on a cloner that drops the seed record').not.toBeNull();
      expect(problem, 'and names the record').toMatch(/seed record/);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 180_000);
});

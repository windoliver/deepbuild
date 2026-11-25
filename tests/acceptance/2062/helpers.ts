// Test-side tools for the #2062 acceptance tests, over world.ts: the criteria's IDs, the tie run in a process under
// another locale, the series source and one land of it, hosts whose timer is the test's, and the two fixture stores
// that fail one read and then pass everything through.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, vi } from 'vitest';
import type { EvidenceStore } from '../../../packages/evidence/src/index.ts';
import type { ExtensionHost, HttpClient, Installed, InstallFrom } from '../../../packages/extension-host/src/index.ts';
import type { RecordStore } from '../../../packages/record/src/index.ts';
import { admit, cleanup, HOUR, makePackage, openHost, said, type Edge, type HostOptions, type World } from './world.ts';

export * from './world.ts';

/** Each criterion's ID (scripts/proof-change.mjs `criterionId`), which starts its tests' names. */
export const AC = {
  1: 'AC1 #2062.dd448700',
  2: 'AC2 #2062.9bf72360',
  3: 'AC3 #2062.1c13446a',
  4: 'AC4 #2062.1800089a',
  5: 'AC5 #2062.926f3013',
} as const;

afterAll(cleanup, 120_000);

/** Admits a package a test starts from: one that doesn't load is a set-up error, never an assertion's failure. */
export async function setUp(h: ExtensionHost, from: string, what: string, grant?: InstallFrom['grant']): Promise<Installed> {
  const got = await admit(h, from, grant);
  if (!got.ok) throw Error(`set-up: ${what} installs, passes its check and loads: ${got.step}: ${got.reason}`);
  return got.installed;
}

// ---- AC3: the tie in a process under another locale.
const UNDER_LOCALE = fileURLToPath(new URL('./under-locale.mjs', import.meta.url));
/** What the process said: its locale, how that locale orders the first two providers, and the edges of `u`. */
export interface UnderLocale { locale: string; order: number; edges: Edge[] }
/** The tie between `providers`, run by a process of its own under `locale` (under-locale.mjs). */
export async function underLocale(locale: string, providers: readonly string[]): Promise<UnderLocale> {
  const { stdout } = await promisify(execFile)(process.execPath, [UNDER_LOCALE, ...providers], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', LC_ALL: locale },
    timeout: 240_000, // deadline: a process that hangs fails its test; nothing is judged on it
  });
  return JSON.parse(stdout.trim().split('\n').at(-1)!) as UnderLocale;
}

// ---- AC4, AC5: a series source, and one land of it.
export const SOURCE = 'ext.meter.load';
const METER_HOST = 'api.meter.example';
/** How long past its end a window of the source's stays open. */
const TIMEOUT = 5_000;
const METER = `export default async function (deep: any): Promise<void> {
  await deep.registerSource('${SOURCE}', {
    variant: 'polled', host: '${METER_HOST}', path: '/load', shape: 'series',
    quota: { per_minute: 600, per_day: 100_000 }, timeout: ${TIMEOUT}, freshFor: 1_000,
    parse(answer: { body: string }): unknown { return { values: JSON.parse(answer.body), unit: 'n' }; },
  });
}
`;
/** The package `meter`, which registers the series source. */
export const meter = (): string => makePackage({
  id: 'test/meter', access: { words: ['hosts'] }, requires: { preview: ['deep.registerSource'] }, sources: [{ name: SOURCE, variant: 'polled' }],
}, METER);
export const METER_GRANT: NonNullable<InstallFrom['grant']> = { hosts: [{ host: METER_HOST, quota: { calls: 1_000_000, per_ms: HOUR } }] };
/** The hub's HTTP client: the source's n-th call is answered with the n-th values. */
export function answering(calls: readonly Record<string, number>[]): HttpClient {
  let n = 0;
  return async (request) => {
    const values = new URL(request.url).hostname === METER_HOST ? calls[n++] : undefined;
    if (!values) throw new TypeError(`fetch failed: no answer for call ${n} of ${request.url}`);
    return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(values) };
  };
}
/** One read of the source, whose call lands one batch: the batch's file, or why none landed. */
export async function land(h: ExtensionHost): Promise<{ file: string | null; refused: string | null }> {
  try {
    const r = await h.readSource(SOURCE);
    if (r.status === 'batch') return { file: r.batch.file, refused: null };
    return { file: null, refused: r.status === 'reading' ? 'it made a reading, not a batch' : r.cause };
  } catch (e) {
    return { file: null, refused: said(e) };
  }
}

/** A host whose own timer never fires: the test makes every tick, on its clock. */
export const heldHost = (w: World, o: HostOptions): Promise<ExtensionHost> => openHost(w, {
  ...o,
  ready: async (h) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try { await h.ready(); } finally { vi.useRealTimers(); }
  },
});

// ---- The fixture stores.
/** A method of `target`, called on it: a store may keep private fields a proxy can't reach. */
const through = (target: object, key: string | symbol): unknown => {
  const value: unknown = Reflect.get(target, key, target);
  return typeof value === 'function' ? value.bind(target) as unknown : value;
};
const READS: ReadonlySet<string | symbol> = new Set(['raw', 'read', 'rows', 'table', 'session']);
/** A record store round a real one that fails its first read once `arm()` is called, once, and then passes everything through. */
export function failsFirstRead(record: RecordStore): { record: RecordStore; arm(): void; failed: string[] } {
  let armed = false;
  const failed: string[] = [];
  const fixture = new Proxy(record, {
    get: (target, key) => {
      if (!armed || !READS.has(key)) return through(target, key);
      return (...args: unknown[]) => {
        armed = false;
        failed.push(`record.${String(key)}(${JSON.stringify(args[0])})`);
        const e = Error(`the fixture record store failed ${failed[0]}`);
        if (key === 'rows') throw e;
        return Promise.reject(e);
      };
    },
  });
  return { record: fixture, arm: () => { armed = true; }, failed };
}
/**
 * An evidence store round a real one that fails once, at the first look at a third file of `files` after two of them
 * were read, and then passes everything through. `before`: the files read by then; `failed`: the file it failed on.
 */
export function failsAtThird(evidence: EvidenceStore, files: ReadonlySet<string>): { evidence: EvidenceStore; before: string[]; failed: string[] } {
  const before: string[] = [];
  const failed: string[] = [];
  const fixture = new Proxy(evidence, {
    get: (target, key) => {
      const call = through(target, key);
      if (key !== 'get' && key !== 'read') return call;
      return (sha: string) => {
        if (files.has(sha) && !failed.length && !before.includes(sha)) {
          if (before.length === 2) {
            failed.push(sha);
            return Promise.reject(Error(`the fixture evidence store failed evidence.${key}(${JSON.stringify(sha)})`));
          }
          if (key === 'read') before.push(sha);
        }
        return (call as (sha: string) => unknown)(sha);
      };
    },
  });
  return { evidence: fixture, before, failed };
}

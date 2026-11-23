// #2650 AC5: a replay recorded while recording was on replays every call it recorded, binary answers included. A host
// opened without the `recording` option records, as every host does today (the issue's first comment). It makes text
// calls (a polled source's three readings, a library's search) and binary ones (a library file's bytes, and an asset
// file of the library downloaded in two ranges, whose bytes stay in the file the call names); its recording(), taken
// through JSON as a fixture file would hold it, then replays in a new world with no network: every call answers as
// it did, byte for byte. The bytes hold every byte value, so no text form of them survives a round trip unharmed.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ExtensionHost, Recording } from '../../../packages/extension-host/src/index.ts';
import { AC5, MINUTE } from './helpers.ts';
import { installAndLoad, network, openHost, openWorld, pkg, tempDir, type Route } from './host.ts';

const LEVEL = 'ext.feeds.level';
const LIBRARY = 'ext.feeds.library';
const API = 'api.feeds.example';
const FILES = 'files.feeds.example';
const HOUR = 3_600_000;
const GRANT = { hosts: [API, FILES].map((host) => ({ host, quota: { calls: 1000, per_ms: HOUR } })) };

/** A thumbnail's bytes: every byte value, 16 times over. */
const THUMB = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
/** An asset file of 1.5 MiB, past the hub's 1 MiB range, so it comes in two: bytes from a hash chain, every value among them. */
const ASSET = (() => {
  const parts: Buffer[] = [];
  let seed = Buffer.from('#2650 asset');
  for (let size = 0; size < 1.5 * 2 ** 20; size += 32) parts.push((seed = createHash('sha256').update(seed).digest()));
  return Buffer.concat(parts).subarray(0, 1.5 * 2 ** 20);
})();
const sha256 = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex');

/** The two hosts, as the plug-in's calls reach them: three levels in turn, a search, a thumbnail and the asset by range. */
function hosts(): Record<string, Route> {
  const levels = [1.25, 2.5, 3.75];
  return {
    [API]: (path) => (path === '/level' ? { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: levels.shift() ?? 99 }) } : { status: 404, body: '' }),
    [FILES]: (path, range) => {
      if (path === '/api/search?q=crate') return { status: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rows: [{ id: 'crate', name: 'Wooden crate', thumbnail: '/files/thumb.bin' }] }) };
      if (path === '/files/thumb.bin') return { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: THUMB };
      if (path !== '/files/asset.bin') return { status: 404, body: '' };
      const m = /^bytes=(\d+)-(\d+)$/.exec(range ?? '');
      if (!m) return { status: 200, headers: { 'content-type': 'application/octet-stream' }, body: ASSET };
      const [from, to] = [Number(m[1]), Math.min(Number(m[2]), ASSET.length - 1)];
      return { status: 206, headers: { 'content-type': 'application/octet-stream', 'content-range': `bytes ${from}-${to}/${ASSET.length}` }, body: ASSET.subarray(from, to + 1) };
    },
  };
}

interface Calls { levels: unknown[]; search: unknown; thumb: { status: number | null; bytes?: Uint8Array }; asset: Buffer }
/** The plug-in's calls, in one order, on a clock the test moves past the level's freshness between its reads. */
async function calls(h: ExtensionHost, clock: { at: number }, folder: string): Promise<Calls> {
  const levels: unknown[] = [];
  const level = async () => { const r = await h.readSource(LEVEL); levels.push(r.status === 'reading' ? { value: r.reading.value, unit: r.reading.unit } : r); };
  await level();
  clock.at += 2_000;
  await level();
  const search = (await h.libraryCall(LIBRARY, 'search', { words: 'crate' })).value;
  const thumb = await h.libraryFile(LIBRARY, '/files/thumb.bin');
  const file = join(folder, 'asset.bin');
  await h.assetFile({ library: LIBRARY, path: '/files/asset.bin' }, { file, sha256: sha256(ASSET), size: ASSET.length, kept: file });
  clock.at += 2_000;
  await level();
  return { levels, search, thumb: thumb as Calls['thumb'], asset: readFileSync(file) };
}

describe(`${AC5} A replay recorded while recording was on replays every call it recorded, binary answers included`, () => {
  it(`${AC5} a host's recording of text and binary calls replays each of them in a new world with no network, byte for byte`, async () => {
    const T0 = Date.UTC(2026, 10, 17, 9, 0, 0);
    const liveClock = { at: T0 };
    const live = network(hosts());
    const w1 = await openWorld();
    const h1 = await openHost(w1, { http: live.client, now: () => liveClock.at });
    await installAndLoad(h1, await pkg('feeds'), GRANT);
    const made = await calls(h1, liveClock, tempDir('live'));
    expect(made.levels, 'the live readings').toEqual([{ value: 1.25, unit: 'm' }, { value: 2.5, unit: 'm' }, { value: 3.75, unit: 'm' }]);
    expect(made.thumb.status, 'the live thumbnail').toBe(200);
    expect(Buffer.from(made.thumb.bytes!).equals(THUMB), 'the live thumbnail\'s bytes').toBe(true);
    expect(made.asset.equals(ASSET), 'the live asset\'s bytes').toBe(true);

    const recording = JSON.parse(JSON.stringify(h1.recording())) as Recording;
    console.log(`#2650 AC5: ${live.asked.length} calls made live; the recording holds ${recording.calls.length}: ${JSON.stringify(recording.calls.map((c) => [c.source, c.request.method, c.request.url, c.request.headers.range ?? null]))}`);
    expect(recording.calls.map((c) => `${c.request.method} ${c.request.url}${c.request.headers.range ? ` ${c.request.headers.range}` : ''}`), 'the recording holds every call the host made, in order').toEqual(live.asked);

    const replayClock = { at: T0 };
    const offline = network({});
    const w2 = await openWorld();
    const h2 = await openHost(w2, { http: offline.client, now: () => replayClock.at, replay: recording });
    await installAndLoad(h2, await pkg('feeds'), GRANT);
    const replayed = await calls(h2, replayClock, tempDir('replay'));
    expect(replayed.levels, 'each reading replays').toEqual(made.levels);
    expect(replayed.search, 'the search replays').toEqual(made.search);
    expect(replayed.thumb.status, `the thumbnail's call replays: ${JSON.stringify({ ...replayed.thumb, bytes: undefined })}`).toBe(200);
    expect(Buffer.from(replayed.thumb.bytes!).equals(THUMB), 'the thumbnail\'s bytes replay, byte for byte').toBe(true);
    expect(replayed.asset.equals(ASSET), 'the asset\'s bytes replay, byte for byte').toBe(true);
    expect(offline.asked, 'calls the replaying host made to the network').toEqual([]);
  }, 10 * MINUTE);
});

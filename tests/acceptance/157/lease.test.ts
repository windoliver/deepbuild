// AC7 #157.96eb79fd: "Two exports started together, from one session or two, run one after the other: the second takes
// the GPU lease only after the first releases it, and the lease events show no overlap"
//
// Two `deep-show run` processes started at the same moment on this machine, each presenting the 3 s fixture film
// (320 × 180 at 24 fps) and exporting it as H.264 with AAC into its own folder, the export call naming the agent
// session that asks for it (`session`). Leg one: both name the session `sess-a`; leg two: one names `sess-a`, the
// other `sess-b`. Each receipt's `lease` is the GPU lease the export held: its resource `{host, kind: "gpu", key}`, its
// holder, and the times of its two events, `acquired` and `released` (milliseconds since the Unix epoch, this
// machine's clock). The two exports must lease the same GPU, and one's lease must be released before the other's is
// acquired. A run that can't open a GPU fails here, as any export does.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, H264_AAC, TIMEOUT, exportCall, filmDoc, isObject, present, presented, receiptOf, runAsync, scenario, show, useShow, useTemp, watchedReplies,
  type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const SESSIONS: JsonObject = {
  'sess-a': { thread: 'thread-a', name: 'Claude Code: film A', process: { pid: 3002, start: 3_000 } },
  'sess-b': { thread: 'thread-b', name: 'Claude Code: film B', process: { pid: 3001, start: 110 } },
};

interface Lease { host: string; kind: string; key: string; holder: string; acquired: number; released: number }
function leaseOf(reply: JsonObject, what: string): Lease {
  const l = receiptOf(reply, what).raw['lease'];
  expect(isObject(l), `${what}: receipt.lease is an object, got ${show(l ?? null)}`).toBe(true);
  const o = l as JsonObject;
  const res = o['resource'];
  expect(isObject(res) && typeof res['host'] === 'string' && typeof res['key'] === 'string', `${what}: receipt.lease.resource is {host, kind, key}, got ${show(res ?? null)}`).toBe(true);
  expect(typeof o['acquired'] === 'number' && typeof o['released'] === 'number' && (o['released'] as number) >= (o['acquired'] as number), `${what}: receipt.lease has acquired ≤ released, got ${show(o)}`).toBe(true);
  const r = res as JsonObject;
  return { host: String(r['host']), kind: String(r['kind']), key: String(r['key']), holder: String(o['holder']), acquired: o['acquired'] as number, released: o['released'] as number };
}

/** Two exports started together, from the sessions named; their leases. */
async function together(sessions: [string, string]): Promise<Lease[]> {
  const bin = shows.bin(FULL);
  const runs = sessions.map((session) => {
    const evidence = temp(); const dir = temp();
    const sc = scenario(evidence, [present(DOC.a, filmDoc(evidence, { frames: 72, size: [320, 180] })), exportCall({ out: join(dir, 'film.mp4'), ...H264_AAC, session })], { sessions: SESSIONS });
    return { sc, session };
  });
  const watched = await Promise.all(runs.map((r) => runAsync(bin, r.sc)));
  return watched.map((w, i) => {
    const what = `the export from ${runs[i]!.session} (process ${i + 1})`;
    const [shown, exported] = watchedReplies(w, 2, what);
    presented(shown!, `${what}: the film`);
    return leaseOf(exported!, what);
  });
}
/** The judge: one GPU, two leases that don't overlap, the second acquired at or after the first's release. */
function overlapFailures(leases: Lease[]): string[] {
  const [a, b] = [...leases].sort((x, y) => x.acquired - y.acquired);
  const f: string[] = [];
  if (a!.kind !== 'gpu' || b!.kind !== 'gpu') f.push(`the leases are of kinds ${a!.kind} and ${b!.kind}, not gpu`);
  if (a!.host !== b!.host || a!.key !== b!.key) f.push(`the exports leased ${a!.host}/${a!.key} and ${b!.host}/${b!.key}, not one GPU`);
  if (b!.acquired < a!.released) f.push(`the second export acquired the GPU lease at ${b!.acquired}, ${a!.released - b!.acquired} ms before the first released it at ${a!.released}: the leases overlap`);
  return f;
}

describe(`${AC[7]} two exports share no GPU: the second waits for the lease`, () => {
  it(`${AC[7]} two exports started together from one session lease the same GPU one after the other, with no overlap`, async () => {
    expect(overlapFailures(await together(['sess-a', 'sess-a'])), 'the leases of two exports from one session').toEqual([]);
  }, TIMEOUT);

  it(`${AC[7]} two exports started together from two sessions lease the same GPU one after the other, with no overlap`, async () => {
    expect(overlapFailures(await together(['sess-a', 'sess-b'])), 'the leases of two exports from two sessions').toEqual([]);
  }, TIMEOUT);
});

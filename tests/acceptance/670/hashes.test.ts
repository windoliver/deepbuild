import { describe, expect, it } from 'vitest';
import {
  FIGURE, SNAP_SIZE, decodePng, hashFailures, keepProof, keepSnapshot, outcome, readEvidence, run, runLines, scenario, sha256, show,
  snapshots, useEvidence, useShowBinary, type Hashes, type JsonObject,
} from './helpers.ts';

useShowBinary();
const evidence = useEvidence();

const TIMES = ['0s', '1s', '2s'];
/** The planted renderer, reachable only through the scenario's `planted`: it seeds its noise from the clock. */
const PLANTED = 'seeds_noise_from_clock';

/** Render-back of the figure at 0 s, 1 s and 2 s, one `deep show` each, in one run of the hub. */
const renderBack = (planted?: string): JsonObject => scenario(evidence(), TIMES.map((t) => show(FIGURE, t)), planted);

/** Each time's snapshot hash in one run; a reply with no snapshot leaves its time out. */
function hashesOf(replies: JsonObject[]): Hashes {
  const out: Hashes = {};
  for (const [i, t] of TIMES.entries()) {
    const snaps = snapshots(replies[i]!, `the reply at ${t}`);
    if (snaps.length === 1) out[t] = snaps[0]!.sha256;
  }
  return out;
}

/** The three runs the criterion names: a first, a second in the same process, and one in a fresh process. */
function threeRuns(planted?: string): { first: JsonObject[]; second: JsonObject[]; fresh: JsonObject[] } {
  const line = renderBack(planted);
  const [first, second] = runLines([line, line]) as [JsonObject[], JsonObject[]];
  const fresh = run(line);
  return { first, second, fresh };
}

describe('AC2 render-back at 0 s, 1 s and 2 s returns snapshots whose hashes are equal on a second run and in a fresh process', () => {
  it('AC2 each time\'s snapshot hash is the same on the first run, a second run in the same process and a run in a fresh process', async () => {
    const { first, second, fresh } = threeRuns();
    const runs = { first: hashesOf(first), second: hashesOf(second), fresh: hashesOf(fresh) };
    keepProof('ac2-figure', FIGURE);
    keepProof('ac2-replies', { first, second, fresh });
    keepProof('ac2-hashes', runs);
    for (const [name, replies] of Object.entries({ first, second, fresh })) {
      for (const [i, t] of TIMES.entries()) {
        expect(outcome(replies[i]!), `the ${name} run presents the figure at ${t}: ${JSON.stringify(replies[i]!['issues'])?.slice(0, 1500)}`).toBe('presented');
      }
    }
    // A renderer seeded by the clock, a per-process hash order or a cache that changes what it draws fails here, naming the snapshot.
    expect(hashFailures(TIMES, runs.first, runs.second, runs.fresh), 'every snapshot hash is equal across the three runs').toEqual([]);
    // Each hash is the snapshot's: its bytes read back by that hash, a PNG of the size asked for.
    for (const t of TIMES) {
      const png = await readEvidence(evidence(), runs.first[t]!);
      expect(sha256(png), `the snapshot at ${t} reads back by its hash`).toBe(runs.first[t]);
      const image = decodePng(png);
      expect([image.width, image.height], `the snapshot at ${t} is ${SNAP_SIZE.join(' × ')} px`).toEqual(SNAP_SIZE);
      keepSnapshot(`ac2-snapshot-${t}`, png);
    }
    // The marker moves across the chart, so the three times draw three pictures: a render-back that
    // ignores its time would make the hash and seek checks hold vacuously.
    expect(new Set(TIMES.map((t) => runs.first[t])).size, 'the snapshots at 0 s, 1 s and 2 s differ (the marker moves)').toBe(3);
  }, 300_000);

  it(`AC2 a planted renderer that seeds its noise from the clock (${PLANTED}) fails the hash criterion, naming the snapshot`, () => {
    const { first, second, fresh } = threeRuns(PLANTED);
    const runs = { first: hashesOf(first), second: hashesOf(second), fresh: hashesOf(fresh) };
    keepProof('ac2-planted-hashes', runs);
    // The planted twin still renders every snapshot; what differs is its pixels.
    for (const [name, hashes] of Object.entries(runs)) {
      expect(TIMES.filter((t) => hashes[t] === undefined), `the planted ${name} run returns a snapshot at every time`).toEqual([]);
    }
    const failures = hashFailures(TIMES, runs.first, runs.second, runs.fresh);
    keepProof('ac2-planted-failures', failures);
    expect(failures.length, 'the hash check fails on the planted renderer').toBeGreaterThan(0);
    for (const f of failures) expect(f, 'each failure names the snapshot by its time').toMatch(/^snapshot at (0s|1s|2s): hash /);
  }, 300_000);
});

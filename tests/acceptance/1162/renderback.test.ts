// AC2: "Render-back at 0, 1, 2 and 4 s gives snapshot hashes equal on a second run and in a fresh process on one
// machine, blank guard first; seeking to each time equals playing to it; and from 4 s, with nothing moving, no frame is
// presented for 2 s. A planted renderer that seeds noise from the clock fails, naming the snapshot"
//
// asserts: one scenario renders the piece back at 0 s, 1 s, 2 s and 4 s (#393's `deep show` with `t`, `size` and
// `include: pixels`); it runs twice in one process and once in another. Every snapshot is read back from the evidence
// store by its hash (its bytes' SHA-256), and the blank guard runs on it before any hash is compared (a blank one makes
// the test fail BLOCKED); `hashFailures` finds nothing; the four snapshots are not all one picture (the piece moves, so a
// render-back that ignores t can't pass). The time core's `determinism` comparison (#488) at the same four times gives
// equal play and seek pixel hashes, and its `play` to 6 s on a 60 Hz display draws more than one frame and none after
// 4 s. The planted `seeds_noise_from_clock` (#670's) fails `hashFailures`, a failure naming the snapshot.
// Wrong programs: a renderer seeded by the clock, a per-process hash order, a cache that changes what it draws; a seek
// that differs from play; a view that keeps drawing once nothing moves.
import { describe, expect, it } from 'vitest';
import {
  DOC, arr, blankGuard, failsNaming, hashFailures, importTable, keepProof, none, num, obj, piece, readEvidence, runShow, scenario, sec, seedStore,
  sha256, show, showAt, shown, snapshots, useBuilds, useDir,
  type JsonObject, type ShowPlanted,
} from './helpers.ts';

const builds = useBuilds(['deep-show']);
const dir = useDir();
const TIMES = ['0s', '1s', '2s', '4s'] as const;

interface Hashes { first: (string | undefined)[]; second: (string | undefined)[]; fresh: (string | undefined)[] }
/** The four snapshots' hashes from two runs in one process and one in a fresh process, each read back and guarded. */
async function renderBack(planted?: ShowPlanted): Promise<Hashes> {
  const evidence = dir();
  seedStore(evidence);
  const bin = builds.bin('deep-show');
  const calls: JsonObject[] = [importTable(), ...TIMES.map((t) => showAt(piece(), t))];
  const sc = scenario(evidence, calls, planted);
  const what = `AC2 render-back${planted ? ` (planted ${planted})` : ''}`;
  const [one, two] = runShow(bin, [sc, sc], `${what}: two runs in one process`);
  const [three] = runShow(bin, [sc], `${what}: a fresh process`);
  const hashes = async (replies: JsonObject[], run: string): Promise<(string | undefined)[]> => {
    const out: (string | undefined)[] = [];
    for (const [i, t] of TIMES.entries()) {
      const reply = replies[i + 1]!;
      expect(reply['outcome'], `${what}, ${run}: the piece at ${t} is presented: ${shown(reply)}`).toBe('presented');
      const [snap] = snapshots(reply, `${what}, ${run}, ${t}`);
      if (!snap) { out.push(undefined); continue; }
      const png = await readEvidence(evidence, snap.sha256);
      blankGuard(png, `${what}, ${run}: the snapshot at ${t}`);
      expect(sha256(png), `${what}, ${run}: the snapshot at ${t} is kept by its bytes' SHA-256`).toBe(snap.sha256);
      if (!planted && run === 'first') keepProof(`ac2-snapshot-${t}.png`, png);
      out.push(snap.sha256);
    }
    return out;
  };
  return { first: await hashes(one!, 'first'), second: await hashes(two!, 'second'), fresh: await hashes(three!, 'fresh') };
}

describe('AC2 render-back the same every run, seeking equals playing, and nothing drawn once nothing moves', () => {
  it('AC2 render-back at 0, 1, 2 and 4 s gives equal hashes on a second run and in a fresh process, blank guard first; the planted clock-seeded renderer fails, naming the snapshot', async () => {
    const h = await renderBack();
    keepProof('ac2-hashes.json', { times: [...TIMES], ...h } as unknown as JsonObject);
    none(hashFailures(TIMES, h.first, h.second, h.fresh), 'AC2 render-back');
    expect(new Set(h.first).size, `AC2: the piece moves, so its four snapshots are not one picture: ${JSON.stringify(h.first)}`).toBeGreaterThan(1);
    const p = await renderBack('seeds_noise_from_clock');
    const failures = hashFailures(TIMES, p.first, p.second, p.fresh);
    keepProof('ac2-planted-seeds_noise_from_clock.json', { ...p, failures } as unknown as JsonObject);
    failsNaming(failures, ['snapshot at'], 'AC2 the planted seeds_noise_from_clock');
  }, 1_800_000);

  it('AC2 seeking to each time equals playing to it, and from 4 s no frame is presented for 2 s', () => {
    const evidence = dir();
    seedStore(evidence);
    const calls: JsonObject[] = [
      importTable(), show(piece()),
      { call: 'determinism', doc: DOC, display_hz: 60, at_times: TIMES.map((t) => sec(Number(t.replace('s', '')))) },
      { call: 'play', doc: DOC, display_hz: 60, to: sec(6) },
    ];
    const [r] = runShow(builds.bin('deep-show'), [scenario(evidence, calls)], 'AC2 seek and play');
    const [, presented, det, play] = r!;
    keepProof('ac2-determinism.json', det!);
    keepProof('ac2-play.json', play!);
    expect(presented!['outcome'], `AC2: the piece is presented: ${shown(presented)}`).toBe('presented');
    expect(det!['outcome'], `AC2: the time core compares play and seek: ${shown(det)}`).toBe('compared');
    const frames = arr(det!['frames'], 'AC2 determinism: frames').map((f, i) => obj(f, `AC2 determinism: frames[${i}]`));
    expect(frames.length, 'AC2: one comparison per time').toBe(TIMES.length);
    const failures: string[] = [];
    frames.forEach((f, i) => {
      const playPixels = obj(f['play'], `AC2 at ${TIMES[i]}: play`)['pixels'];
      const seekPixels = obj(f['seek'], `AC2 at ${TIMES[i]}: seek`)['pixels'];
      if (typeof playPixels !== 'string' || playPixels === '') failures.push(`snapshot at ${TIMES[i]}: play drew no pixel hash`);
      else if (playPixels !== seekPixels) failures.push(`snapshot at ${TIMES[i]}: playing to it gives ${playPixels}, seeking to it ${String(seekPixels)}`);
    });
    none(failures, 'AC2 seeking equals playing');
    expect(play!['outcome'], `AC2: the piece plays to 6 s: ${shown(play)}`).toBe('played');
    expect(num(play!['drawn'], 'AC2 play: drawn'), 'AC2: the piece draws more than one frame while it moves').toBeGreaterThan(1);
    const last = num(play!['last_drawn'], 'AC2 play: last_drawn');
    expect(last, `AC2: from 4 s, with nothing moving, no frame is presented for 2 s; the last frame drawn was at ${last} flicks (${last / sec(1)} s)`).toBeLessThanOrEqual(sec(4));
  }, 1_800_000);
});

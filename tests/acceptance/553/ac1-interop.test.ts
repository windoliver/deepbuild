// AC1 #553.f47ade22: In the interop part, the app's backend and the web player's play the two-player piece for 1,200
// match steps through the shipped relay behind the test relay's faults and pass net.rollback together; a planted web
// backend that writes a frame's step big-endian fails, naming the field and the backend
//
// The interop part is the network seam's (README: The interop part): `node scripts/net-interop.mjs`, given the piece,
// its evidence store and player 1's script. The piece is #551's paddle piece (its world `court`, its logic item
// `rules`; net: 60 Hz, delay 2, window 8, a full-state hash at every match step). The part plays the app's copy (player
// 1, the macOS backend) and headless Chrome's web player (player 2, the web's backend, its person pressing paddle 2's
// keys) through the shipped relay behind the network seam's test relay, whose seeded faults delay, drop, duplicate and
// reorder frames. Its report must read PASS with net.rollback PASS and say what it did; then this file holds it to the
// substance: both copies ran the match and rolled back, the faults struck, both records hold the same merged track, both
// copies hold the same occurrences, and their full-state hash at every confirmed step is the one a replay of the record
// alone gives (#551's `replay`: every message on time, so to speak). The planted web backend writes each frame's `first`
// big-endian: the part fails, a failure naming the field `first` and the web's backend, none the app's.
// Wrong programs it fails: the merge base (no interop part); a part that reads PASS without the faults, without a
// rollback or with copies that part; backends that differ on the wire; a part that misses or misnames the planted frame.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STEP, WEB_BIG_ENDIAN, WINDOW, paddleDoc, rally, rulesProgram, type JsonValue } from './fixtures.ts';
import {
  AC, FULL, Script, TIMEOUT, arr, copy551Of, hashesOf, interop, isObject, none, num, obj, occurrenceLines, presented, putEvidence, replayCall, runShow, show, str,
  trackFailures, trackLines, useBuilds, useChildren, useTemp, world, type Copy551, type JsonObject,
} from './helpers.ts';

const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const STEPS = 1200;
const document = paddleDoc({ hash_every: 1, timeout: 120 });

/** The interop part's inputs as files: the piece, its evidence store and player 1's script. */
function inputs(): { doc: string; evidence: string; plays: string } {
  const dir = temp();
  const evidence = temp();
  putEvidence(evidence, rulesProgram().bytes);
  writeFileSync(join(dir, 'piece.json'), JSON.stringify(document));
  writeFileSync(join(dir, 'plays.json'), JSON.stringify({ '1': rally(2, STEPS)['1'] }));
  return { doc: join(dir, 'piece.json'), evidence, plays: join(dir, 'plays.json') };
}
const backendOf = (r: JsonObject, side: 'app' | 'web'): string => str(obj(obj(r['backends'], 'interop.backends')[side], `interop.backends.${side}`)['name'], `interop.backends.${side}.name`);

describe(`${AC[1]} the app's backend and the web player's in one match through the shipped relay behind the test relay's faults`, () => {
  it(`${AC[1]} the app's copy and the web player's play the paddle piece for 1,200 match steps through the shipped relay behind the test relay's faults and pass net.rollback together`, async () => {
    const files = inputs();
    const r = await interop({ ...files, steps: STEPS, seed: 553 }, 'AC1 the interop part');
    const f: string[] = [];
    if (r['status'] !== 'PASS') f.push(`the interop part reads ${show(r['status'])}, not PASS: ${show(r['failures'] ?? null, 1200)}`);
    if (!(Array.isArray(r['failures']) && r['failures'].length === 0)) f.push(`the interop part lists failures: ${show(r['failures'] ?? null, 1200)}`);
    const check = obj(r['check'], 'interop.check (net.rollback on the two copies)');
    if (check['kind'] !== 'net.rollback' || check['verdict'] !== 'PASS') f.push(`net.rollback on the two copies reads ${show([check['kind'], check['verdict']])}, not net.rollback PASS: ${show(check['failures'] ?? null, 1200)}`);
    const [app, web] = [backendOf(r, 'app'), backendOf(r, 'web')];
    if (app !== 'network.macos') f.push(`the app's copy played on the backend ${app}, not the macOS backend network.macos`);
    if (web === app) f.push(`the web player's copy played on ${web}, the app's own backend, not the web's`);
    // The test relay's faults struck.
    const relay = obj(r['relay'], 'interop.relay (what the test relay did)');
    for (const k of ['delayed', 'dropped', 'duplicated', 'reordered']) if (!(num(relay[k], `interop.relay.${k}`) > 0)) f.push(`the test relay ${k} no frame`);
    if (!(num(relay['frames'], 'interop.relay.frames') >= STEPS)) f.push(`the test relay carried ${show(relay['frames'])} frames, fewer than one a match step`);
    // The copies, as each backend's copy reports itself.
    const copies = obj(r['copies'], 'interop.copies');
    const a: Copy551 = copy551Of(copies['app'], 'the app\'s copy');
    const w: Copy551 = copy551Of(copies['web'], 'the web player\'s copy');
    if (a.player !== 1 || w.player !== 2) f.push(`the app's copy is player ${a.player} and the web player's ${w.player}, not 1 and 2`);
    if (a.ran !== STEPS) f.push(`the app's copy ran ${a.ran} match steps, not ${STEPS}`);
    for (const c of [a, w]) if (c.rollbacks === 0) f.push(`copy ${c.player} never rolled back, so the faults made no entry late`);
    if (!a.record || !w.record) { none([...f, 'a copy has no record'], 'AC1 the interop part'); return; }
    const before = Math.min(a.record.confirmed, w.record.confirmed) + 1;
    if (before < STEPS - 3 * WINDOW) f.push(`the copies confirmed only ${before} of ${STEPS} steps`);
    for (const p of [1, 2]) {
      const n = a.record.track.filter((e) => e.player === p && e.t < before * STEP).length;
      if (n < 10) f.push(`the merged track holds ${n} of player ${p}'s entries, fewer than 10`);
    }
    f.push(...trackFailures(trackLines(w.record.track, before), trackLines(a.record.track, before), 'the web player\'s record and the app\'s'));
    const [ao, wo] = [occurrenceLines(a, before, 'AC1'), occurrenceLines(w, before, 'AC1')];
    if (ao.length === 0) f.push('the app\'s copy holds no occurrence, so none could be replaced');
    if (JSON.stringify(ao) !== JSON.stringify(wo)) f.push(`the copies' occurrences differ: ${ao.find((l) => !wo.includes(l)) ?? wo.find((l) => !ao.includes(l)) ?? `${ao.length} rows and ${wo.length}`}`);
    // Every confirmed step's full-state hash is the one the record alone gives.
    const evidence = files.evidence;
    const id = String(document['id']);
    const s = new Script();
    s.present(id, document);
    const m = s.add(replayCall(id, a.record.raw['track'] as JsonValue[], before, 1));
    const rr = await runShow(builds.show(), world(evidence, [id], s.calls), 'AC1 the app\'s record replayed alone');
    presented(rr[0], 'AC1 the paddle piece');
    const replay = hashesOf(rr[m], 'AC1 the replay');
    for (const c of [a, w]) {
      let shared = 0;
      for (const h of c.hashes.filter((x) => x.step < before)) {
        const want = replay.get(h.step);
        if (want === undefined) continue;
        shared += 1;
        if (want !== h.hash) { f.push(`copy ${c.player}'s full-state hash at match step ${h.step} is ${h.hash}, not the replay's ${want}`); break; }
      }
      if (shared < before - 2 * WINDOW) f.push(`copy ${c.player} shares only ${shared} hashes with the replay, fewer than ${before - 2 * WINDOW}`);
    }
    none(f, 'the app and the web player through the shipped relay behind the test relay\'s faults');
  }, TIMEOUT);

  it(`${AC[1]} a planted web backend that writes a frame's step big-endian fails the interop part, naming the field and the backend`, async () => {
    const r = await interop({ ...inputs(), steps: 300, seed: 553, planted: WEB_BIG_ENDIAN }, 'AC1 the interop part, planted');
    expect(r['status'], `the interop part fails the planted web backend: ${show(r, 1500)}`).toBe('FAIL');
    const [app, web] = [backendOf(r, 'app'), backendOf(r, 'web')];
    const failures = arr(r['failures'], 'interop.failures').filter(isObject);
    const named = failures.filter((x) => x['field'] === 'first' && x['backend'] === web);
    expect(named.length, `a failure names the field first and the web's backend ${web}: ${show(failures, 1500)}`).toBeGreaterThan(0);
    expect(failures.filter((x) => x['backend'] === app), `no failure names the app's backend ${app}`).toEqual([]);
  }, TIMEOUT);
});

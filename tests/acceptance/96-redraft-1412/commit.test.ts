// AC6 a write acknowledged and then dropped never reads as success. AC14 the doc.patched event is the
// commit point: a layer file written by hash whose event never landed is never current after a restart.
import { describe, expect, it } from 'vitest';
import {
  ASALPHA, CLI_YOU, P, SHOW, create, expectValidPatched, fixture, layerFiles, lostOf, node, outcome, patch, patchedData, posOf, read, record,
  revisionRows, revisionsOf, send, set, show, showKilled, shown, str, strs, useBinary, useFolders, world, type JsonObject,
} from './helpers.ts';

useBinary();
const { evidence, state } = useFolders();

/** Outcomes that say a patch didn't land. `applied` and `no_change` both read as success (Patch: Result). */
const NOT_LANDED = ['refused', 'conflict', 'superseded'];

describe('AC6 a write acknowledged and then dropped surfaces in the reply or on the next call, never as success (parity/agent/write-readback.scene)', () => {
  const scene = fixture('parity/agent/write-readback.scene.json');
  const write = patch(P(1), 0, scene['write'] as JsonObject[]);
  const lost = patch(P(2), 1, scene['lost'] as JsonObject[]);

  it('AC6 alpha\'s move whose layer file can\'t be written at its commit is never success: its reply says so, or alpha\'s next call (its read-back) reports it lost; the read-back shows the box where it was', () => {
    const r = show(world(evidence(), [send(ASALPHA, write), send(ASALPHA, lost), read(ASALPHA), revisionsOf()], { state: state(), fault: { layer_file_fails: P(2) } })).replies;
    expect(outcome(r[0]!), 'alpha\'s first write applies').toBe('applied');
    const back = shown(r[2]!, 'alpha\'s read-back');
    expect(posOf(back.document, 'alpha.box'), 'the read-back shows the box where the first write put it: the move is not there').toEqual(scene['kept_pos']);
    if (outcome(r[1]!) === 'applied') {
      expect(back.lost, `the move ${P(2)} was acknowledged as applied, so alpha's next call reports it lost`).toContain(P(2));
    } else {
      expect(NOT_LANDED, `the move's reply says it didn't land: ${outcome(r[1]!)}`).toContain(outcome(r[1]!));
    }
    expect(back.lost, 'the write that landed is never reported lost').not.toContain(P(1));
    const rows = revisionRows(r[3]!);
    expect(rows.filter((row) => row.state === 'current').flatMap((row) => row.patches), 'the current revision doesn\'t hold the lost move').not.toContain(P(2));
    const logged = record(state());
    expectValidPatched(logged);
    expect(logged.map((l) => patchedData(l)['patch']), 'the record has the first write and no doc.patched event for the lost move').toEqual([P(1)]);
  });

  it('AC6 when alpha\'s next call is another patch, not a read, the dropped move still surfaces: in its own reply or in that next patch\'s reply, and the document never holds it', () => {
    const next = patch(P(3), 1, [create(node('alpha.note', 'Note', [400, 120]))]);
    const r = show(world(evidence(), [send(ASALPHA, write), send(ASALPHA, lost), send(ASALPHA, next), read(ASALPHA)], { state: state(), fault: { layer_file_fails: P(2) } })).replies;
    expect(outcome(r[0]!), 'alpha\'s first write applies').toBe('applied');
    if (outcome(r[1]!) === 'applied') {
      expect(lostOf(r[2]!, 'alpha\'s next patch'), `the move ${P(2)} was acknowledged as applied, so the reply to alpha's next call, a patch, reports it lost`).toContain(P(2));
    } else {
      expect(NOT_LANDED, `the move's reply says it didn't land: ${outcome(r[1]!)}`).toContain(outcome(r[1]!));
    }
    expect(lostOf(r[2]!, 'alpha\'s next patch'), 'the write that landed is never reported lost').not.toContain(P(1));
    expect(outcome(r[2]!), 'alpha\'s next patch, on the revision the first write made, applies').toBe('applied');
    const back = shown(r[3]!, 'alpha\'s read-back');
    expect(posOf(back.document, 'alpha.box'), 'the box is where the first write put it').toEqual(scene['kept_pos']);
    expect(posOf(back.document, 'alpha.note'), 'and alpha\'s next patch landed').toEqual([400, 120, 0]);
    const logged = record(state());
    expectValidPatched(logged);
    expect(logged.map((l) => patchedData(l)['patch']), 'the record holds the two writes that landed and nothing of the lost move').toEqual([P(1), P(3)]);
  });
});

describe('AC14 the doc.patched event is the commit point: a hub killed after a layer file is written by hash and before its event lands restarts showing the revision before, the record and the shown revision agree, and the orphan layer file is never current', () => {
  const MOVE1 = patch(P(1), 0, [set('you.n1', 'items/you.n1/at/pos', [100, 40, 0])]);
  const MOVE2 = patch(P(2), 1, [set('you.n1', 'items/you.n1/at/pos', [300, 40, 0])]);
  const LOST_POS = [300, 40, 0];

  /** Runs to the kill; returns the orphan: the lost move's layer file, which no doc.patched event names. */
  function crash(): string {
    const killed = showKilled(world(evidence(), [send(CLI_YOU, MOVE1), send(CLI_YOU, MOVE2), read()], { state: state(), fault: { kill_after_layer_file: P(2) } }));
    expect(killed.status === 0 && killed.signal === null, `the fault fixture kills ${SHOW} before it can answer (status ${killed.status}, signal ${killed.signal}, answered ${killed.stdout.trim() || 'nothing'})`).toBe(false);
    expect(killed.stdout.trim(), 'it answers nothing').toBe('');
    const logged = record(state());
    expectValidPatched(logged);
    expect(logged.map((l) => patchedData(l)['patch']), 'the first move\'s event landed, the second\'s didn\'t').toEqual([P(1)]);
    const named = new Set(logged.flatMap((l) => strs(l.event['evidence'] ?? [], 'evidence')));
    const files = layerFiles(state());
    for (const hash of named) expect(files.has(hash), `the layer file ${hash} the record names is in the state folder`).toBe(true);
    const lostFile = [...files.keys()].find((h) => !named.has(h) && JSON.stringify(posOf(files.get(h)!, 'you.n1')) === JSON.stringify(LOST_POS));
    expect(lostFile, 'the second move\'s layer file was written by hash before the kill, and no event names it').toBeDefined();
    return lostFile!;
  }

  /** What the criterion asks of the restarted hub, as failures; empty when it holds. */
  function restartFailures(reply: JsonObject, revisions: JsonObject, orphan: string): string[] {
    const out: string[] = [];
    const now = shown(reply, 'the restarted read');
    const logged = record(state());
    const lastRev = Math.max(...logged.map((l) => Number(patchedData(l)['rev'])));
    if (now.rev !== lastRev) out.push(`the shown revision is ${now.rev}, the record's last is ${lastRev}`);
    if (JSON.stringify(posOf(now.document, 'you.n1')) !== JSON.stringify([100, 40, 0])) out.push(`the shown revision holds the lost revision of patch ${P(2)}: n1 at ${JSON.stringify(posOf(now.document, 'you.n1'))}`);
    if (Object.values(now.files).includes(orphan)) out.push(`the orphan layer file ${orphan}, of the lost patch ${P(2)}, is current`);
    if (revisionRows(revisions).some((row) => row.patches.includes(P(2)) && row.state === 'current')) out.push(`a current revision holds the lost patch ${P(2)}`);
    return out;
  }

  it('AC14 after the kill and a restart, the shown revision is the one before, it agrees with the record, and the orphan layer file is never current', () => {
    const orphan = crash();
    const r = show(world(evidence(), [read(), revisionsOf()], { state: state() })).replies;
    expect(restartFailures(r[0]!, r[1]!, orphan), 'the restarted hub shows the revision the record committed').toEqual([]);
    expect(shown(r[0]!).rev, 'that is revision 1, your first move').toBe(1);
    const again = show(world(evidence(), [send(CLI_YOU, patch(P(3), 1, [set('you.n1', 'items/you.n1/at/pos', [120, 40, 0])])), read()], { state: state() })).replies;
    expect(outcome(again[0]!), 'and the restarted hub takes the next patch on that revision').toBe('applied');
    expect(posOf(shown(again[1]!).document, 'you.n1'), 'which shows').toEqual([120, 40, 0]);
  });

  it('AC14 the record and the shown revision agree by hash: the doc.patched event carries its revision\'s hash, and after the restart the record\'s last event names the shown revision\'s hash', () => {
    crash();
    const r = show(world(evidence(), [read()], { state: state() })).replies;
    const now = shown(r[0]!, 'the restarted read');
    const logged = record(state());
    expectValidPatched(logged);
    const last = logged[logged.length - 1]!;
    expect(patchedData(last)['hash'], `the record's last event, of patch ${P(1)}, carries its revision's hash (Revision: "The doc.patched event carries the revision's hash"; doc.patched@2's data.hash)`).toBeDefined();
    expect(str(patchedData(last)['hash'], 'the last event\'s hash'), 'and it is the hash of the revision the restarted hub shows').toBe(now.hash);
  });

  it('AC14 a hub that takes the newest layer file as current shows the lost revision, and this test fails on it, naming it', () => {
    const orphan = crash();
    const r = show(world(evidence(), [read(), revisionsOf()], { state: state(), planted: 'newest_layer_file_current' })).replies;
    expect(posOf(shown(r[0]!).document, 'you.n1'), 'the planted hub shows the lost revision').toEqual(LOST_POS);
    const failures = restartFailures(r[0]!, r[1]!, orphan);
    expect(failures.length, 'the check fails on the planted hub').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming the lost revision\'s patch').toContain(P(2));
  });
});

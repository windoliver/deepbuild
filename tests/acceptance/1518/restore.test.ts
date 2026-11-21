// #1518.c2ae9106: "Adding a removed word back to `keep` by one patch restores exactly that word's audio and picture, and
// the source asset's hash never changes"
//
// The video recording (README: Fixtures): sixteen tone words in silence, every frame showing its own number. D1 keeps
// all but words 3, 6, 10 and 13; D2 is D1's keep list with word 6 added. In one run, document a is your shared document
// stored holding D1, and you present D1 as document b and D2 as document c; then one patch of yours sets document a's cut
// item's `keep` to D2's list, and document a is read. D2 is then exported and its delivered file decoded.
// - Before: D1's strips play no sample of word 6; each word D1 keeps is played whole, each it removes not at all.
// - After the one patch (its reply carries the revision's expansion): `removed` is D1's less 6; word 6 is played whole
//   (inside one strip, clear of its fades), every other kept word whole and every removed one not at all; and the row's
//   strips, pictures, channels, removed, fragments and cuts are byte for byte those of D2 presented fresh.
// - Heard and seen, in D2's export: its sound plays the kept tones in order, word 6 among them, its full 300 ms; from word
//   6's onset through its sound, the picture shows word 6's own source frames, within one frame.
// - The source asset's hash: every strip plays the recording by its SHA-256, the patched revision's asset still names it,
//   and the store's file still hashes to it, before and after.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, ITEM, RATE, TIMEOUT, VIDEO, VIDEO_KEEP, VIDEO_REMOVED, VIDEO_TONES, codeAt, cutRow, isObject, keptOf, onsetsOf, patchCall, playedAs,
  present, presented, proof, readCall, readExport, rowText, runShow, sharedScenario, show, stageVideo, stepFailures, storedIntact, useShow, useTemp,
  videoFilm, yours, type CutRow, type JsonObject, type JsonValue, type Keep,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const R = 6;

/** Each word's play in a row, as `whole`, `part` or `none`, against what a keep list keeps. */
function playFailures(row: CutRow, keep: Keep, what: string): string[] {
  const kept = keptOf(keep);
  return VIDEO_TONES.flatMap((t, k) => {
    const got = playedAs(row.strips, t.start, t.start + t.length);
    const want = kept.has(k) ? 'whole' : 'none';
    return got === want ? [] : [`${what}: word ${k} is played ${got}, not ${want}`];
  });
}

describe(`${AC[3]} one patch adding a removed word back to keep restores exactly its sound and picture; the source asset's hash never changes`, () => {
  it(`${AC[3]} adding word 6 back to keep by one patch plays word 6 whole and only it, gives D2's row byte for byte, shows word 6's own frames in step with its sound, and the recording's hash never changes`, () => {
    const bin = shows.bin(FULL);
    const evidence = temp();
    const v = stageVideo(bin, evidence);
    const intactBefore = storedIntact(evidence, v.sha);
    const k2: Keep = [...VIDEO_KEEP, R];
    const d1 = videoFilm(v.sha, [v.record], VIDEO_KEEP);
    const d2 = videoFilm(v.sha, [v.record], k2);
    const replies = runShow(bin, sharedScenario(evidence, yours(d1), [
      present(DOC.b, d1), present(DOC.c, d2), patchCall(DOC.a, 1, 0, ITEM, `items/${ITEM}/params/keep`, k2 as unknown as JsonValue, 'bring word 6 back'), readCall(DOC.a),
    ]), 'D1 shared, D1 and D2 presented, the patch adding word 6');
    const before = cutRow(presented(replies[0], 'D1 as document b'), 'D1');
    const fresh = cutRow(presented(replies[1], 'D2 as document c'), 'D2');
    expect(replies[2]?.['outcome'], `the one patch adding word 6 to keep applies: ${show(replies[2], 2000)}`).toBe('applied');
    const after = cutRow(replies[2]!, 'document a after the patch');
    const read = replies[3]!;
    const { played } = readExport(bin, evidence, d2, temp(), 'D2 exported');
    const onsets = onsetsOf(played);
    const six = onsets.find((o) => o.word === R);
    proof('ac3-restore.json', { before: before.row, after: after.row, fresh: fresh.row, onsets, read: read['document'] ?? null });

    expect(before.removed, 'D1 removes words 3, 6, 10 and 13').toEqual([...VIDEO_REMOVED]);
    expect(after.removed, 'after the patch, removed is D1\'s less word 6').toEqual(VIDEO_REMOVED.filter((r) => r !== R));
    expect(playFailures(before, VIDEO_KEEP, 'D1'), 'D1 plays word 6 not at all, each kept word whole').toEqual([]);
    expect(playFailures(after, k2, 'after the patch'), 'after the patch word 6 is played whole, and nothing else changed').toEqual([]);
    expect(rowText(after), 'the patched row is byte for byte that of D2 presented fresh').toBe(rowText(fresh));

    expect(onsets.map((o) => o.word), 'D2\'s export plays the kept tones in order, word 6 among them').toEqual([...keptOf(k2)].sort((a, b) => a - b));
    expect(six, 'word 6 is heard in D2\'s export').toBeDefined();
    expect(Math.abs(six!.end - six!.at - VIDEO_TONES[R]!.length / RATE), `word 6 plays its full 300 ms (${(six!.end - six!.at).toFixed(4)} s)`).toBeLessThan(0.005);
    expect(stepFailures(played, [six!], () => 1), 'at word 6\'s onset the picture is in step with its sound').toEqual([]);
    const first = Math.floor((VIDEO_TONES[R]!.start / RATE) * VIDEO.fps) - 1;
    const last = Math.floor(((VIDEO_TONES[R]!.start + VIDEO_TONES[R]!.length) / RATE) * VIDEO.fps) + 1;
    const wrong = played.frames.filter((f) => f.t >= six!.at + 1 / VIDEO.fps && f.t <= six!.end - 2 / VIDEO.fps && (f.code === null || f.code < first || f.code > last));
    expect(wrong.map((f) => ({ t: f.t, code: f.code })), `through word 6's sound the picture shows its own source frames, ${first} to ${last}`).toEqual([]);
    expect(codeAt(played, six!.at), 'a picture of the recording is shown at word 6\'s onset').not.toBeNull();

    const doc = isObject(read['document']) ? read['document'] : {};
    const recAsset = ((doc['assets'] as JsonObject | undefined)?.['rec'] as JsonObject | undefined)?.['sha256'];
    expect(recAsset, 'the patched revision\'s recording asset still names the recording\'s SHA-256').toBe(v.sha);
    expect((((doc['items'] as JsonObject | undefined)?.[ITEM] as JsonObject | undefined)?.['params'] as JsonObject | undefined)?.['keep'], 'the read revision is the patched one: its cut item keeps D2\'s list').toEqual(k2);
    for (const [name, row] of [['D1', before], ['after the patch', after], ['D2', fresh]] as const) {
      expect(row.strips.map((s) => s.asset), `${name}: every strip plays the recording by its SHA-256`).toEqual(row.strips.map(() => v.sha));
    }
    expect([intactBefore, storedIntact(evidence, v.sha)], 'the store\'s file of the recording hashes to its name, before and after').toEqual([true, true]);
  }, TIMEOUT);
});

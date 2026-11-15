// AC3 #1968.84837e9c: "Shown to you: screenshots of a code item with token roles and a highlight on lines 3 to 5, the
// moving diff, and the terminal recording, taken by the check run from the canvas's own frames, with a recording of the
// diff moving and the terminal recording playing, are attached to the PR and shown to you in the session. Whether they
// look right is one taste call, recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above
// reads a picture to judge it"
//
// The check run (README: The taste call) shows three documents by the agent's session through `deep-show run` and takes
// each picture with `eval {t, pixels: true}`, the canvas's own frame stored as a PNG: `code-roles-highlight.png` (the
// still code item: eight token roles, its lines numbered, lines 3 to 5 highlighted, at 0 s), `moving-diff.png` (AC1's
// film at 0.5 s, mid-move, once its film block reports the diff `td`, so a build that draws no text diff fails here),
// `terminal-recording.png` (a test run's terminal recording played in a cell grid, at 2 s, every line printed); and
// `diff-and-terminal.apng`, the diff moving (0 to 1 s) then the recording playing (0 to 2 s), 20 frames a second, each
// frame the canvas's own PNG put into one animated PNG unchanged. Each is written to docs/evidence/1968/ and its path and
// SHA-256 printed, for the PR and the session. The call is a file you record, named by DEEPBUILD_TASTE_1968:
// {"criterion": "#1968.84837e9c", "by": "you", "screenshots": [sha256 × 3], "recordings": [sha256], "call":
// "looks_right" | "looks_wrong"}. With no record, or one made on other files, the test fails as INCONCLUSIVE;
// looks_wrong fails it. No other test in this suite reads a picture.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, DIFF, DOC, REPO, TIMEOUT, binOf, codeBoard, decodePng, diffFilm, diffOf, encodeApng, fl, getEvidence, idOf, inconclusive, obj, prebuild, presented,
  putEvidence, recordingBytes, runShow, scenario, sha256, show, showCall, snapshotOf, tasteVerdict, terminalBoard, useTemp, type Image, type JsonObject,
  type TasteRecord,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const ID = AC[3];
const KEEP = join(REPO, 'docs', 'evidence', '1968');
const FPS = 20;
const SHOTS = ['code-roles-highlight.png', 'moving-diff.png', 'terminal-recording.png'] as const;
const RECORDING = 'diff-and-terminal.apng';
const frames = (seconds: number): number[] => Array.from({ length: seconds * FPS + 1 }, (_, k) => fl(k / FPS));

describe(`${ID} one taste call on the canvas's own screenshots and recording`, () => {
  it(`${ID} the code item with token roles and a highlight on lines 3 to 5, the moving diff and the terminal recording, and a recording of the diff moving and the recording playing, from the canvas's own frames, and the recorded taste call says they look right`, () => {
    // The call's judge against its planted records.
    const s = ['a', 'b', 'c']; const rec = ['d'];
    const call = (o: Partial<TasteRecord>): TasteRecord => ({ criterion: idOf(ID), by: 'you', screenshots: s, recordings: rec, call: 'looks_right', ...o });
    expect(tasteVerdict(call({}), s, rec).status, 'a call on these files that says they look right passes').toBe('PASS');
    expect(tasteVerdict(null, s, rec).status, 'planted: no call is INCONCLUSIVE').toBe('INCONCLUSIVE');
    expect(tasteVerdict(call({ screenshots: ['a', 'b', 'x'] }), s, rec).status, 'planted: a call on another picture is INCONCLUSIVE').toBe('INCONCLUSIVE');
    expect(tasteVerdict(call({ by: 'an agent' }), s, rec).status, 'planted: a call that isn\'t yours is INCONCLUSIVE').toBe('INCONCLUSIVE');
    expect(tasteVerdict(call({ call: 'looks_wrong' }), s, rec).status, 'planted: looks_wrong fails').toBe('FAIL');

    // The screenshots, each the canvas's own frame.
    const ev = temp();
    const recording = putEvidence(ev, recordingBytes());
    const [C, D, T] = [DOC(1), DOC(2), DOC(3)];
    const shots = runShow(binOf(), scenario(ev, [C, D, T], [
      showCall(C, codeBoard()), { call: 'eval', doc: C, t: 0, pixels: true },
      showCall(D, diffFilm()), { call: 'eval', doc: D, t: fl(0.5), pixels: true, film: true },
      showCall(T, terminalBoard(recording)), { call: 'eval', doc: T, t: fl(2), pixels: true },
    ]), 'the screenshots');
    presented(shots[0]!, 'the code item with its token roles and the highlight');
    presented(shots[2]!, 'the moving diff');
    diffOf(obj(shots[3]!['film'], `the moving diff at 0.5 s: film (${show(shots[3]!)})`), DIFF, 'before', 'after', 'the moving diff at 0.5 s');
    presented(shots[4]!, 'the terminal recording');
    const pictures = [1, 3, 5].map((i, k) => getEvidence(ev, snapshotOf(shots[i]!, SHOTS[k]!), SHOTS[k]!));

    // The recording: the diff moving, then the terminal recording playing, every frame the canvas's own.
    const [times1, times2] = [frames(1), frames(2)];
    const played = runShow(binOf(), scenario(ev, [D, T], [
      showCall(D, diffFilm()), ...times1.map((t) => ({ call: 'eval', doc: D, t, pixels: true })),
      showCall(T, terminalBoard(recording)), ...times2.map((t) => ({ call: 'eval', doc: T, t, pixels: true })),
    ]), 'the recording');
    presented(played[0]!, 'the moving diff, recorded');
    presented(played[1 + times1.length]!, 'the terminal recording, recorded');
    const frameAt = (r: JsonObject, what: string): Image => decodePng(getEvidence(ev, snapshotOf(r, what), what));
    const anim = encodeApng([
      ...times1.map((t, k) => frameAt(played[1 + k]!, `the diff's frame at ${t} flicks`)),
      ...times2.map((t, k) => frameAt(played[2 + times1.length + k]!, `the recording's frame at ${t} flicks`)),
    ], FPS);

    // Kept for the PR and the session.
    mkdirSync(KEEP, { recursive: true });
    const write = (name: string, bytes: Buffer): string => {
      const path = join(KEEP, name);
      if (!existsSync(path) || sha256(readFileSync(path)) !== sha256(bytes)) writeFileSync(path, bytes);
      console.log(`for the taste call: ${join('docs', 'evidence', '1968', name)}  ${sha256(bytes)}`);
      return sha256(bytes);
    };
    const screenshots = SHOTS.map((name, k) => write(name, pictures[k]!));
    const recordings = [write(RECORDING, anim)];

    const file = process.env['DEEPBUILD_TASTE_1968'];
    const record = file && existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as TasteRecord) : null;
    const verdict = tasteVerdict(record, screenshots, recordings);
    if (verdict.status === 'INCONCLUSIVE') inconclusive(verdict.reason);
    expect(verdict.status, verdict.reason).toBe('PASS');
  }, 2 * TIMEOUT);
});

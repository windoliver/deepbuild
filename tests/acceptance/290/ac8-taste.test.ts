// AC8 #290.005a3986: Shown to you: screenshots of the sphere behind a wall at opacity 0.4, the torus behind a wall and
// the two copies of a 2-player match, taken by the check run from the renderer's own output, are attached to the PR
// and shown to you in the session. Whether they look right is one taste call, recorded; without it the run stays
// INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it
//
// The check run draws, with the fixtures the criteria use (helpers.ts): criterion 1's sphere behind its wall at
// `hidden_view: {opacity: 0.4}` and criterion 2's torus behind its wall at the same, each one frame of `view3d`; and
// criterion 4's characters' piece played 80 match steps by both copies, each copy's view after step 60 (#552's
// `views`). First, by the replies and no picture, it checks that the pictures show what the criterion names: each of
// the two frames lists the hidden view's blended draw of its item (`draws`, README), the piece is presented, its
// match plays, and each view read its own copy's `match.me`. Then it copies the four pictures byte for byte, the
// renderer's own PNGs (each frame's final target, each view's frame from the evidence store), to docs/evidence/290/,
// printing each SHA-256, and reads tests/acceptance/290/TASTE.json (README: The taste call): none, or a call on other
// pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly these pictures passes.
// It judges no picture. "Attached to the PR and shown to you in the session" is the implementing agent's; no test
// can see it.
//
// Wrong programs it fails: the merge base (no frame lists a hidden view's draw, and the piece is refused at check); a
// run whose pictures nobody has called, or called on other pictures.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNamed, requireMetal, useDir, useGpu, writeJson } from '../424/helpers.ts';
import {
  AC, DOC, HIDDEN_VIEW, OPACITY, REPO, SIZE, TIMEOUT, castProgram, drawsOf, gpu, heroesDoc, inconclusive, refusals, sha256, shotsOf, sphereDoc, torusDoc, view3d,
  type JsonValue,
} from './helpers.ts';
import { FULL, play, useBuilds, useChildren, useTemp } from './match.ts';

const bin = useGpu();
const builds = useBuilds({ show: [FULL] });
useChildren();
const dir = useDir();
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '290');
const TASTE = join(REPO, 'tests', 'acceptance', '290', 'TASTE.json');
const CRITERION = '#290.005a3986';
const NAMES = ['sphere-behind-wall.png', 'torus-behind-wall.png', 'match-copy-1.png', 'match-copy-2.png'] as const;
const VIEW_STEP = 60;

describe(`${AC[8]} the check run's pictures of the hidden view, and the one taste call on them`, () => {
  it(`${AC[8]} the check run takes the sphere, the torus and the two copies of a match from the renderer's own output, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, async () => {
    requireMetal();
    const out = dir();
    const labels = ['the sphere behind the wall at opacity 0.4', 'the torus behind the wall at opacity 0.4'];
    const run = gpu(bin(), out, [
      view3d({ doc: writeJson(out, 'sphere', sphereDoc('sphere-hidden', { hidden: { opacity: OPACITY, color: 'base' } })), size: SIZE, targets: ['final'], counts: true }),
      view3d({ doc: writeJson(out, 'torus', torusDoc('torus-hidden', { hidden: { opacity: OPACITY } })), size: SIZE, targets: ['final'], counts: true }),
    ]);
    expect(refusals(run, labels), 'view3d draws the sphere and the torus').toEqual([]);
    const [sphere, torus] = run.replies.map((r, i) => shotsOf(r, labels[i]!)[0]!);
    // What the pictures show is checked by the replies, not by a picture.
    expect([sphere!, torus!].map((s) => drawsOf(s).hidden.filter((d) => d.startsWith(`${HIDDEN_VIEW} `))), 'each frame lists the hidden view\'s blended draw of its item')
      .toEqual([[`${HIDDEN_VIEW} sphere`], [`${HIDDEN_VIEW} torus`]]);
    const program = castProgram();
    const asks = [1, 2].map((player) => ({ player, step: VIEW_STEP }));
    const played = await play(builds.show(), temp(), { doc: DOC.heroes, document: heroesDoc(program), program, steps: VIEW_STEP + 20, views: asks, what: 'AC8 the characters\' piece' });
    expect(played.blocked, 'the characters\' piece is presented and its match plays').toEqual([]);
    const views = asks.map((a) => played.views.find((v) => v.player === a.player && v.step === a.step));
    expect(views.map((v) => [v?.me, v?.bytes !== null && v?.bytes !== undefined]), 'each copy\'s view after step 60 read its own match.me and holds its frame').toEqual([[1, true], [2, true]]);

    const files: Record<(typeof NAMES)[number], Buffer> = {
      'sphere-behind-wall.png': readNamed(out, sphere!.view.final, 'png', labels[0]!),
      'torus-behind-wall.png': readNamed(out, torus!.view.final, 'png', labels[1]!),
      'match-copy-1.png': views[0]!.bytes!,
      'match-copy-2.png': views[1]!.bytes!,
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/290/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[8]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/290/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(290);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const shots = call['screenshots'];
    expect(typeof shots === 'object' && shots !== null && !Array.isArray(shots), 'TASTE.json: screenshots, by name').toBe(true);
    const recorded = shots as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the four files').toEqual([...NAMES].sort());
    const other = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (other.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${other.map((n) => `${n} recorded ${String(recorded[n])}, drawn ${hashes[n]}`).join('; ')}; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[8]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});

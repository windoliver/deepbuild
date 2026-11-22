// AC5 #959.3faaa651: "Shown to you: screenshots of a strategy map with a ridge blocking sight, radar blips, a cloaked
// unit and a last-seen ghost, taken by the check run from the canvas's own frames, with a recording of the fog changing
// as units move, are attached to the PR and shown to you in the session. Whether they look right is one taste call,
// recorded; without it the run stays INCONCLUSIVE, never PASS, and no criterion above reads a picture to judge it"
//
// The check run (README: The taste call). The strategy map (docs.ts: mapDoc; fixtures.ts: mapPlan): a 256 × 256 m
// terrain plate with a 12 m ridge across its middle, its fog overlay read through `match.me`; side 0 (player 1) in the
// south with two eyes, a radar and a scout that carries an eye and a detect sensor; side 1 in the north behind the
// ridge, with a cloaked unit and a depot (a structure) in the south. The logic item links the first-party reference
// library through sense.lib@1. `deep-show run`'s `match` plays both copies 90 steps, and `views` (#552's) gives copy
// 1's frame, as its panel draws it through its own `match.me`, after each asked step.
// First, by replies and no picture: the piece is presented, both copies play every step, and every fog cell, seen bit,
// blip bit and ghost row of copy 1 is the reference's, in which (checked on the reference, from the fixture's numbers)
// player 1 sees its own side of the ridge and none of the ground behind it, the three units behind it are blips, the
// cloaked unit is hidden at step 12 and seen at step 84, and the depot is a ghost at step 40. Then the pictures: copy
// 1's frames after steps 12, 40 and 84, and a recording of its frames after every third step from 0 to 87, written to
// docs/evidence/959/ with their SHA-256s printed. Then tests/acceptance/959/TASTE.json is read: none, or a call on
// other pictures, fails `INCONCLUSIVE:`, never a pass; `looks_wrong` fails; `looks_right` on exactly these pictures
// passes. It judges no picture. "Attached to the PR and shown to you in the session" is the implementing agent's; no
// test can see it. Off macOS, where no frame is drawn, it is INCONCLUSIVE.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { logicBin, prebuild } from '../190/helpers.ts';
import { encodeApng } from '../467/helpers.ts';
import {
  FULL, REPO, Script, TIMEOUT, inconclusive, macOnly, matchCall, pairOf, playedOnFailures, pngBytes, presented, putEvidence, run, scenario, sha256,
  useBuilds, useChildren, useTemp, viewsOf, type Image,
} from '../552/helpers.ts';
import { DOC, MAP_SIZE, mapDoc } from './docs.ts';
import { MAP, mapParams, mapPlan, mapPlate } from './fixtures.ts';
import { AC, IFACE, findSense, misses, type Fixture } from './helpers.ts';
import { RADAR, SEEN, gridsOf, runPlan, stateOf } from './model.ts';

prebuild(() => { logicBin(); });
const builds = useBuilds({ show: [FULL] });
useChildren();
const temp = useTemp();
const EVIDENCE = join(REPO, 'docs', 'evidence', '959');
const TASTE = join(REPO, 'tests', 'acceptance', '959', 'TASTE.json');
const CRITERION = '#959.3faaa651';
const NAMES = ['ridge-and-blips.png', 'last-seen-ghost.png', 'cloaked-unit-revealed.png', 'fog-changing.apng'] as const;
const CLIP = Array.from({ length: Math.floor((MAP.clip.to - MAP.clip.from) / MAP.clip.every) + 1 }, (_, i) => MAP.clip.from + i * MAP.clip.every);
const SHOTS = [MAP.shots.ridge, MAP.shots.ghost, MAP.shots.revealed];
const VIEW_STEPS = [...new Set([...CLIP, ...SHOTS])].sort((a, b) => a - b);
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

describe(`${AC[5]} the check run's pictures of the strategy map, and the one taste call on them`, () => {
  it(`${AC[5]} the check run takes the screenshots and the recording from the canvas's own frames, and the recorded call on exactly those pictures says they look right; with none the run is INCONCLUSIVE, never PASS`, async () => {
    const found = findSense();
    expect(found.problems, `first_party lists a first-party pack that declares ${IFACE} with its reference library (the packs are ${found.packs.join(', ')})`).toEqual([]);
    const f: Fixture = { plate: mapPlate(), params: mapParams(), plan: mapPlan() };
    const g = gridsOf(f.plate, f.params);
    const want = runPlan(f.plate, f.params, f.plan, MAP.steps);
    // The state the pictures show, on the reference, from the fixture's numbers (player 1 is side 0).
    const out = (k: number) => want[k]!.out;
    const one = (k: number, unit: number): number => out(k).seen[unit]! & 1;
    const fogAt = (k: number, x: number, z: number): number => stateOf(out(k).fog[Math.floor((z - f.plate.z0) / 4) * g.fc + Math.floor((x - f.plate.x0) / 4)]!, 1);
    const shot = MAP.shots;
    const ghostRow = MAP.units.depot * 2;
    expect({
      ownSide: fogAt(shot.ridge, -40, 40), behindRidge: [fogAt(shot.ridge, -40, -30), fogAt(shot.ridge, 0, -60)],
      northSeen: MAP.units.north.map((u) => one(shot.ridge, u)), northBlips: MAP.units.north.map((u) => out(shot.ridge).blip[u]! & 1),
      cloaked: [one(shot.ridge, MAP.units.cloaked), one(shot.revealed, MAP.units.cloaked)],
      depotSeen: [one(shot.ridge, MAP.units.depot), one(shot.ghost, MAP.units.depot)],
      ghost: [out(shot.ridge).ghost[ghostRow], out(shot.ghost).ghost[ghostRow], out(shot.ghost).ghostPos[2 * ghostRow], out(shot.ghost).ghostPos[2 * ghostRow + 1], out(shot.ghost).ghostKind[ghostRow]],
    }, 'on the reference: the ridge blocks player 1\'s sight, the units behind it are radar blips, the cloaked unit is hidden and then seen, and the depot is seen and then a ghost at its place').toEqual({
      ownSide: SEEN, behindRidge: [RADAR, RADAR], northSeen: [0, 0, 0], northBlips: [1, 1, 1], cloaked: [0, 1], depotSeen: [1, 0],
      ghost: [0, 1, MAP.depot[0], MAP.depot[1], MAP.depotKind],
    });
    macOnly();

    // By replies first: the piece is presented, its match plays, and copy 1 holds the reference's state at every step.
    const evidence = temp();
    const made = mapDoc(f, found.sense!.ref);
    for (const bytes of made.evidence) putEvidence(evidence, bytes);
    const s = new Script();
    const shown = s.present(DOC.map, made.document);
    const m = s.add(matchCall(DOC.map, MAP.steps, { relay: { seed: 959 }, views: VIEW_STEPS.map((step) => ({ player: 1, step })) }));
    const r = await run(builds.show(), scenario(evidence, [{ id: DOC.map, size: MAP_SIZE }], s.calls), 'AC5 the strategy map\'s match');
    presented(r[shown], 'AC5: the strategy map');
    const [copy, other] = pairOf(r[m], 'AC5');
    expect(playedOnFailures([copy, other], MAP.steps, 'AC5'), 'both copies play every step of the match').toEqual([]);
    expect(misses(Array.isArray(copy.raw['steps']) ? copy.raw['steps'] : [], want, f, 'copy 1').map((x) => x.message), 'every fog cell, seen bit, blip bit and ghost row of copy 1, at every step, is the reference\'s').toEqual([]);

    // The pictures: copy 1's own frames, drawn through its match.me.
    const views = viewsOf(r[m], evidence, 'AC5');
    const frame = (step: number): Image => {
      const v = views.find((x) => x.player === 1 && x.step === step);
      expect([v?.me, v?.image ? [v.image.width, v.image.height] : null], `AC5: copy 1's view after step ${step} is drawn through match.me 1 at ${MAP_SIZE.join(' × ')} px`).toEqual([1, MAP_SIZE]);
      return v!.image!;
    };
    const files: Record<(typeof NAMES)[number], Buffer> = {
      'ridge-and-blips.png': pngBytes(frame(shot.ridge)),
      'last-seen-ghost.png': pngBytes(frame(shot.ghost)),
      'cloaked-unit-revealed.png': pngBytes(frame(shot.revealed)),
      'fog-changing.apng': encodeApng(CLIP.map(frame), 10),
    };
    const hashes = Object.fromEntries(NAMES.map((n) => [n, sha256(files[n])]));
    mkdirSync(EVIDENCE, { recursive: true });
    for (const n of NAMES) {
      const path = join(EVIDENCE, n);
      if (!existsSync(path) || sha256(readFileSync(path)) !== hashes[n]) writeFileSync(path, files[n]);
    }
    const listed = NAMES.map((n) => `  docs/evidence/959/${n}  ${hashes[n]}`).join('\n');
    console.log(`${AC[5]}: the check run's pictures:\n${listed}`);

    if (!existsSync(TASTE)) inconclusive(`no taste call is recorded: attach these to the PR, show them to the owner\n${listed}\nand record the answer in tests/acceptance/959/TASTE.json (README: The taste call)`);
    let parsed: JsonValue;
    try { parsed = JSON.parse(readFileSync(TASTE, 'utf8')) as JsonValue; } catch (e) { return expect.fail(`TASTE.json is not JSON: ${(e as Error).message}`); }
    expect(typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed), 'TASTE.json is an object').toBe(true);
    const call = parsed as Record<string, JsonValue>;
    expect(call['issue'], 'TASTE.json: issue').toBe(959);
    expect(call['criterion'], 'TASTE.json: criterion').toBe(CRITERION);
    expect(['looks_right', 'looks_wrong'], 'TASTE.json: verdict').toContain(call['verdict']);
    expect(typeof call['who'] === 'string' && call['who'].trim() !== '', 'TASTE.json: who made the call').toBe(true);
    expect(typeof call['when'] === 'string' && /^\d{4}-\d\d-\d\dT/.test(call['when']) && !Number.isNaN(Date.parse(call['when'])), 'TASTE.json: when, an ISO 8601 time').toBe(true);
    const recorded = (call['screenshots'] ?? {}) as Record<string, JsonValue>;
    expect(Object.keys(recorded).sort(), 'TASTE.json: screenshots names the four files').toEqual([...NAMES].sort());
    const others = NAMES.filter((n) => recorded[n] !== hashes[n]);
    if (others.length) inconclusive(`the recorded call (${String(call['who'])}, ${String(call['when'])}) was made on other pictures: ${others.join(', ')} differ from this run's; this run's are written for a new call`);
    if (call['verdict'] === 'looks_wrong') expect.fail(`the taste call (${String(call['who'])}, ${String(call['when'])}) says they don't look right${typeof call['note'] === 'string' ? `: ${call['note']}` : ''}`);
    console.log(`${AC[5]}: taste call recorded by ${String(call['who'])} at ${String(call['when'])}: looks right`);
  }, TIMEOUT);
});

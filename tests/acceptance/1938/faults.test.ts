// #1938.f19b61dd: "Each loop check fires on its planted fault with its code and a fix as patch ops, and its clean twin
// passes: a subject cut by the frame, clipped highlights, text under 4.5:1, two items passing into each other, an item
// floating 0.2 m above the floor, a 20 m door, a missing texture, a fill that reseeds each frame, and a scene over its
// class"
//
// Fixtures (helpers.ts, README: Fixtures): nine pairs, each a planted fault and its clean twin, stored documents in the
// working agent alpha's layer. Each document is the one deliverable of its own claim of alpha's, whose one requirement
// is the pair's check input; `verdict` judges both claims in one `deep-show run`.
//
// asserts, for each pair:
//   - the planted document's row is FAIL, and an error or warning on it names the pair's check kind (`check`), carries
//     a non-empty `code` (the design's or the base's own where one is named: `geometry.overlap`, `geometry.floating`,
//     `asset_missing`, `over_budget`), names the fault's items in `ids`, and carries a fix as patch ops (`fix_ops`, or
//     `fix` as a list), each op one of Patch's ops on an item the document holds;
//   - the twin's row is PASS with nothing raised.
// And where the design gives the fix's numbers: the floating vase's fix lowers it 0.2 m, onto the floor, and nothing
// else; the crates' fix moves one of the two out along x, the axis of least overlap, by at least the 0.2 m they share.
// The missing texture's failure names its hash.
//
// Wrong programs: the base, where scene.scale, camera.framing, render.exposure, render.contrast and render.noise are
// BLOCKED `module_missing`, document.budget is BLOCKED `not_run` and document.validate reads no `assets`; a check that
// names its fix as text; a check that fails its twin too (one that reads a deliberate texture as noise, or a door's
// kind as its size); `audit_checks_overlaps_only` (#1936's planted audit), which passes the floating vase. The
// crates and the floating vase are the scene audit's (#1936), already built at the base: their tests pass there.
import { describe, expect, it } from 'vitest';
import {
  CRATES, TIMEOUT, VASE, VASE_AT, brief, caughtFailures, contrastPair, exposurePair, fixOps, floatingPair, framingPair, gpuGate, holds,
  judgePair, matching, none, noisePair, overClassPair, overlapPair, passFailures, proof, requireMetal, scalePair, sha256, texture,
  texturePair, useBuild, useFolders, type JsonObject, type JsonValue, type Pair,
} from './helpers.ts';

/** The criterion's ID: `#1938.` and the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#1938.f19b61dd';
const bin = useBuild();
const folder = useFolders();

/** One pair judged and held to the criterion: the planted fault caught, the twin passing. Returns the planted fault's matching issues. */
function holdsPair(pair: Pair, name: string): ReturnType<typeof matching> {
  if (pair.gpu) requireMetal(`${pair.fault.kind} on ${name}`);
  const judged = judgePair(bin(), folder(), pair);
  if (pair.gpu) { gpuGate(judged.planted, `${pair.fault.kind} on the planted ${name}`); gpuGate(judged.twin, `${pair.fault.kind} on the twin of ${name}`); }
  proof(`${pair.fault.kind} on ${name}`, { planted: judged.planted.raw, twin: judged.twin.raw });
  none(caughtFailures(judged.planted, pair.fault, pair.planted, `${pair.fault.kind} on ${name}`), `${pair.fault.kind} fires on ${name} with its code and a fix as patch ops`);
  none(passFailures(judged.twin, `${pair.fault.kind} on the clean twin of ${name}`), `${pair.fault.kind}'s clean twin of ${name} passes`);
  return matching(judged.planted, pair.fault);
}

/** Where `id` is after `ops`, from `start`, when every op sets its `at.pos` or a component of it; else why not. */
function placed(ops: readonly JsonObject[], id: string, start: readonly number[]): { at: number[]; failures: string[] } {
  const at = [...start];
  const failures: string[] = [];
  for (const op of ops) {
    const [path, value] = [op['path'], op['value'] as JsonValue];
    if (op['op'] !== 'set' || op['id'] !== id) { failures.push(`${brief(op, 400)} isn't a set on ${id}`); continue; }
    if (path === `items/${id}/at/pos` && Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number')) at.splice(0, 3, ...(value as number[]));
    else if (typeof path === 'string' && /^items\/[^/]+\/at\/pos\/[012]$/.test(path) && typeof value === 'number') at[Number(path.slice(-1))] = value;
    else failures.push(`${brief(op, 400)} doesn't set ${id}'s at.pos`);
  }
  return { at, failures };
}

describe(`${ID} each loop check fires on its planted fault with its code and a fix as patch ops, and its clean twin passes`, () => {
  it(`${ID} a subject cut by the frame fails camera.framing with its code and a fix as patch ops, and the framed twin passes`, () => {
    holdsPair(framingPair(), 'a subject cut by the frame');
  }, TIMEOUT);

  it(`${ID} clipped highlights fail render.exposure with its code and a fix as patch ops, and the twin at middle grey passes`, () => {
    holdsPair(exposurePair(), 'clipped highlights');
  }, TIMEOUT);

  it(`${ID} text under 4.5:1 fails render.contrast with its code and a fix as patch ops, and the twin in ink passes`, () => {
    holdsPair(contrastPair(), 'text under 4.5:1');
  }, TIMEOUT);

  it(`${ID} two items passing into each other fail the scene audit as geometry.overlap with a fix that moves one out along the axis of least overlap, and the twin side by side passes`, () => {
    const found = holdsPair(overlapPair(), 'two items passing into each other');
    const ops = found.map(fixOps).find((o) => o !== null)!;
    const moved = CRATES.filter((c) => ops.some((op) => op['id'] === c));
    expect(moved.length, `the overlap's fix moves one of the two crates: ${brief(ops)}`).toBe(1);
    const start = moved[0] === CRATES[0] ? [0, 0.5, 0] : [0.8, 0.5, 0];
    const { at, failures } = placed(ops, moved[0]!, start);
    none(failures, "the overlap's fix sets one crate's position and nothing else");
    const d = at.map((v, k) => v - start[k]!);
    expect(Math.abs(d[1]!) <= 1e-9 && Math.abs(d[2]!) <= 1e-9 && Math.abs(d[0]!) >= 0.2 - 1e-6,
      `the overlap's fix moves ${moved[0]} along x, the axis of least overlap, by at least 0.2 m: from ${brief(start)} to ${brief(at)}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} an item floating 0.2 m above the floor fails the scene audit as geometry.floating with a fix that lowers it 0.2 m, and the twin on the floor passes; the overlaps-only audit passes it`, () => {
    const pair = floatingPair();
    const found = holdsPair(pair, 'an item floating 0.2 m above the floor');
    const ops = found.map(fixOps).find((o) => o !== null)!;
    const { at, failures } = placed(ops, VASE, VASE_AT.planted);
    none(failures, "the floating vase's fix sets its position and nothing else");
    const d = at.map((v, k) => v - VASE_AT.planted[k]!);
    expect(Math.abs(d[0]!) <= 1e-9 && Math.abs(d[2]!) <= 1e-9 && Math.abs(d[1]! + 0.2) <= 1e-6,
      `the floating vase's fix lowers it 0.2 m onto the floor: from ${brief(VASE_AT.planted)} to ${brief(at)}`).toBe(true);

    // Wrong program: #1936's planted audit runs the overlap pass alone, so the vase isn't caught and the test fails on it.
    const planted = judgePair(bin(), folder(), pair, { planted: 'audit_checks_overlaps_only' });
    expect(matching(planted.planted, pair.fault).map((i) => brief(i.raw, 400)), 'under audit_checks_overlaps_only the floating vase is not caught').toEqual([]);
  }, TIMEOUT);

  it(`${ID} a 20 m door fails scene.scale with its code and a fix as patch ops, and the 2.1 m twin passes`, () => {
    holdsPair(scalePair(), 'a 20 m door');
  }, TIMEOUT);

  it(`${ID} a missing texture fails document.validate's assets as asset_missing, naming its hash, with a fix as patch ops, and the twin whose texture is in the store passes`, () => {
    const found = holdsPair(texturePair(), 'a missing texture');
    const sha = sha256(texture());
    expect(found.some((i) => holds(i.raw, sha) || JSON.stringify(i.raw).includes(sha)), `the missing texture's failure names its hash ${sha}: ${found.map((i) => brief(i.raw, 600)).join('; ')}`).toBe(true);
  }, TIMEOUT);

  it(`${ID} a fill that reseeds each frame fails render.noise with its code and a fix as patch ops, and the twin seeded once passes`, () => {
    holdsPair(noisePair(), 'a fill that reseeds each frame');
  }, TIMEOUT);

  it(`${ID} a scene over its class fails document.budget as over_budget with a fix as patch ops, and the twin within its class passes`, () => {
    holdsPair(overClassPair(), 'a scene over its class');
  }, TIMEOUT);
});

// Criterion 4 (no upstream test): "A logic item that names a 64 KiB test asset reads its bytes from assets_at in its
// start function and at step 0, and seeking from each checkpoint gives the same full-state hashes as a straight
// run; a set of assets that passes the end of memory, or overlaps the write region, is refused at check, naming the
// asset; swapping the asset for another changes the bake's key; and a planted restore that copies the asset again
// over bytes the program had changed fails logic.determinism on the full-state hash of the first checkpoint after
// the seek"
//
// Through `deep-logic check`, `bake` (its `keys` and restores) and `determinism` (README: deep-logic, Data assets).
// `atlas` (programs.ts) hashes its first asset's bytes (FNV-1a) in its start function and again at step 0, and
// then changes one byte of the asset's copy every step, a change no array shows. The test asset is 65,536 seeded
// bytes; the test computes the hash itself. `restore_copies_assets` copies the item's assets into memory again
// after it loads a checkpoint.
import { describe, expect, it } from 'vitest';
import { AC, EVERY, TIMEOUT, bakeCall, bakeOf, bytesOf, checkCall, determinismCall, determinismOf, firstDiff, layoutFor, logicBin, onMac, piece, prebuild, rows, sha256, show, type BakeSpec, type JsonObject, type Layout } from './helpers.ts';
import { ASSET_BYTES, ATLAS_MEMORY, atlas, fnv1a, layoutProbe } from './programs.ts';

prebuild(() => { logicBin(); });

const ID = 'atlas';
const WRITES = { start_sum: { type: 'i32' as const }, step0_sum: { type: 'i32' as const }, len: { type: 'i32' as const } };
const ASSET = bytesOf(532_041, ASSET_BYTES);
const OTHER = bytesOf(532_042, ASSET_BYTES);
const STEPS = 240;
const AT_TIMES = [1.5];
let layout: Layout | undefined;
const atlasLayout = (): Layout => (layout ??= layoutFor({ program: layoutProbe(), writes: WRITES }));
/** `atlas` with its assets at `assetsAt` (one past its three pages of state: 65,536 unless a test moves it). */
const atlasPiece = (assets: Buffer[], assetsAt = 65_536): JsonObject =>
  piece({ seed: 532_04, items: { [ID]: { program: atlas(atlasLayout(), assetsAt), writes: WRITES, assets, budget: { fuel: 4_000_000 } } } });
const SPEC: BakeSpec = { steps: STEPS, restores: [0, 60, 120, 180].map((from) => ({ from, steps: STEPS - from })) };
/** The refusal's naming field: every refusal's `asset`. */
const assetsNamed = (reply: JsonObject): string[] => (Array.isArray(reply['refusals']) ? reply['refusals'] : []).map((r) => (r && typeof r === 'object' && !Array.isArray(r) ? String(r['asset'] ?? '') : '')).filter((a) => a !== '');

describe(`${AC[4]} data assets are copied into memory once, before the start function, and are then the program's state`, () => {
  it(`${AC[4]} a 64 KiB asset is read from assets_at in the start function and at step 0, and seeking from each checkpoint gives the straight run's full-state hashes`, () => {
    const [bake, det] = onMac([bakeCall(atlasPiece([ASSET]), SPEC), determinismCall(atlasPiece([ASSET]), { steps: STEPS }, AT_TIMES)]);
    const b = bakeOf(bake!, 'the bake');
    expect(b.traps, 'atlas never traps').toEqual([]);
    const want = fnv1a(ASSET);
    expect(b.steps.map((s) => [s.arrays[`${ID}.start_sum`]?.[0], s.arrays[`${ID}.step0_sum`]?.[0], s.arrays[`${ID}.len`]?.[0]]).filter(([a, z, n]) => a !== want || z !== want || n !== ASSET_BYTES),
      `every step shows the start function's and step 0's hash of the asset's bytes (${want}) and its length (${ASSET_BYTES})`).toEqual([]);
    const straight = b.checkpoints[ID] ?? [];
    expect(straight.map((c) => c.step), 'checkpoints every 60 steps').toEqual([0, 60, 120, 180, 240]);
    expect(new Set(straight.map((c) => c.deep_hash)).size, 'the asset\'s copy changes between checkpoints').toBe(straight.length);
    for (const r of b.restores) {
      expect(firstDiff((r.checkpoints[ID] ?? []).map((c) => `${c.step} ${c.deep_hash}`), straight.filter((c) => c.step >= r.from).map((c) => `${c.step} ${c.deep_hash}`)), `seeking from checkpoint ${r.from} gives the straight run's full-state hashes`).toBeNull();
      expect(firstDiff(rows(r.steps, ID), rows(b.steps.filter((s) => s.step >= r.from), ID)), `and its step hashes and arrays`).toBeNull();
    }
    const d = determinismOf(det!, 'logic.determinism');
    expect([d.verdict, d.failures], 'logic.determinism passes').toEqual(['PASS', []]);
  }, TIMEOUT);

  it(`${AC[4]} a set of assets that passes the end of memory, or overlaps the write region, is refused at check, naming the asset`, () => {
    const second = bytesOf(532_043, ASSET_BYTES);
    // Two assets from 131,072: the first ends at 196,612; the second's bytes run to 262,152, 8 past the 262,144 of memory.
    const pastEnd = 131_072 + 2 * (4 + ASSET_BYTES);
    expect(pastEnd, 'the second asset passes the end of memory').toBeGreaterThan(ATLAS_MEMORY);
    const [fits, past, overlap] = onMac([
      checkCall(atlasPiece([ASSET])), checkCall(atlasPiece([ASSET, second], 131_072)), checkCall(atlasPiece([ASSET], 4000)),
    ]);
    expect(fits!['ok'], `an asset that fits is admitted: ${show(fits)}`).toBe(true);
    expect([past!['ok'], past!['code'], past!['item']], `assets past the end of memory are refused at check: ${show(past)}`).toEqual([false, 'logic_refused', ID]);
    expect(assetsNamed(past!), 'the refusal names the asset that passes the end, not the one that fits').toEqual([sha256(second)]);
    expect([overlap!['ok'], overlap!['code'], overlap!['item']], `an asset over the write region (4,096) is refused at check: ${show(overlap)}`).toEqual([false, 'logic_refused', ID]);
    expect(assetsNamed(overlap!), 'the refusal names the asset').toEqual([sha256(ASSET)]);
  }, TIMEOUT);

  it(`${AC[4]} swapping the asset for another changes the bake's key, and the same asset keeps it`, () => {
    const [a, again, other] = onMac([bakeCall(atlasPiece([ASSET]), { steps: 1 }), bakeCall(atlasPiece([ASSET]), { steps: 1 }), bakeCall(atlasPiece([OTHER]), { steps: 1 })]);
    const k = bakeOf(a!, 'the bake').keys?.[ID];
    expect(k, 'the bake has a key for the item').toBeDefined();
    expect(bakeOf(again!, 'the same bake again').keys?.[ID], 'the same inputs give the same key').toBe(k);
    expect(bakeOf(other!, 'the bake with the other asset').keys?.[ID], 'another asset gives another key').not.toBe(k);
  }, TIMEOUT);

  it(`${AC[4]} a planted restore that copies the asset again (restore_copies_assets) fails logic.determinism on the full-state hash of the first checkpoint after the seek`, () => {
    const [straightReply] = onMac([bakeCall(atlasPiece([ASSET]), SPEC)]);
    const [plantedReply, det] = onMac([bakeCall(atlasPiece([ASSET]), SPEC), determinismCall(atlasPiece([ASSET]), { steps: STEPS }, AT_TIMES)], ['restore_copies_assets']);
    const straight = bakeOf(straightReply!, 'the straight bake');
    const planted = bakeOf(plantedReply!, 'the bake with restore_copies_assets');
    const r60 = planted.restores.find((r) => r.from === 60);
    expect(r60?.checkpoints[ID]?.find((c) => c.step === 120)?.deep_hash, 'the planted restore from 60 differs from playing at checkpoint 120').not.toBe(straight.checkpoints[ID]?.find((c) => c.step === 120)?.deep_hash);
    const d = determinismOf(det!, 'logic.determinism with restore_copies_assets');
    expect(d.verdict, 'logic.determinism fails the planted restore').toBe('FAIL');
    const seeks = d.failures.filter((f) => f.run === 'seek');
    expect(seeks.map((f) => [f.from, f.checkpoint, f.field]), `the seek restored from 60 fails on the full-state hash of checkpoint 120, the first after it: ${JSON.stringify(d.failures)}`).toEqual([[60, 60 + EVERY, 'deep_hash']]);
  }, TIMEOUT);
});

// AC1 #3356.8d8c3ce5 (first half): on main, scene3d's ledger digest matches its sources.
//
// Through the surfaces the issue names: the kit call scripts/canvas-kit.mjs makes (`{"call": "kit", ledger}`: every
// part, the default backends, seed and sizes), in the build it makes (`cargo build --locked --bin deep-show`), here
// over scene3d alone and writing a copy of the committed ledger, so the checkout's crates/deep-show/kit-ledger.json is
// only read. The kit digests scene3d's sources as they are and writes that digest to the copy; the committed record
// must equal what it writes, field for field (version, digest, verdict, parts), so neither a digest left at an old
// tree nor a record edited by hand to a digest the kit didn't run at passes.
//
// The wrong program: the base, whose ledger records scene3d at `683377360bf9…` while its sources digest otherwise.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC1, LEDGER, SCENE3D, failuresOf, isObject, kitCall, kitModule, readLedger, run, same, shown, useBuild, useTemp } from './helpers.ts';

const kitBin = useBuild('kit');
const temp = useTemp();

describe(`${AC1} scene3d's ledger digest matches its sources`, () => {
  it(`${AC1} the committed kit-ledger.json records scene3d as the kit canvas-kit.mjs runs finds it for scene3d's current sources: the same digest, verdict and parts`, () => {
    const evidence = join(temp(), 'evidence');
    mkdirSync(evidence);
    const written = join(temp(), 'kit-ledger.json');
    copyFileSync(LEDGER, written);
    const [kitReply] = run(kitBin(), { evidence, calls: [kitCall([SCENE3D], written)] }, 'the kit over scene3d');
    const m = kitModule(kitReply!, SCENE3D);
    const fresh = readLedger(written)[SCENE3D];
    expect(isObject(fresh) && fresh['digest'] === m['digest'] && fresh['verdict'] === m['verdict'],
      `the kit wrote its scene3d result to the ledger it was given: reported ${shown({ digest: m['digest'], verdict: m['verdict'] })}, wrote ${shown(fresh ?? null)}`).toBe(true);
    const committed = readLedger(LEDGER)[SCENE3D];
    expect(isObject(committed) ? committed['digest'] : committed,
      `kit-ledger.json's scene3d digest is the one the kit computes for scene3d's sources (the kit's verdict there: ${String(m['verdict'])} ${failuresOf(m)})`).toBe(m['digest']);
    expect(same(committed, fresh), `kit-ledger.json records scene3d as the kit finds it: committed ${shown(committed ?? null)}; the kit wrote ${shown(fresh ?? null)}`).toBe(true);
  }, 3_000_000);
});

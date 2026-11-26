// AC2 #3356.c602cb3f: when `deep-show live` refuses to seal, its stderr names the code and the module. An empty stderr
// is not enough.
//
// Two refusals of the release `deep-show live` (`cargo build --locked --release --bin deep-show`), each given one line
// it can't read (helpers.ts: live), so a build that sealed would answer it instead:
//
// - The issue's own: `kit_failed`. The release build embeds the ledger DEEP_KIT_LEDGER names at build time
//   (crates/deep-show/build.rs); here, a copy of the committed ledger whose scene3d record holds a digest no source
//   tree has, so the seal refuses scene3d whatever its sources. The binary is copied out, and the release build is made
//   again without DEEP_KIT_LEDGER, so target/ holds the committed ledger's build when the test ends.
// - A seal refusal of another kind through the same exit: `--planted constraint_iterates_to_convergence` (#489's
//   planted motion constraint solve, which constraint@1's kit refuses at the seal, naming motion), in the release build
//   of the committed ledger.
//
// Each must exit 2 without answering its line, and its stderr must name the refusal's code (`seal_refused`) and each
// module it refuses, as words. Where the refusal goes on stdout (main.rs writes its one JSON line there today) isn't
// this criterion's, and isn't asserted.
//
// The wrong program: the base, whose seal writes its refusal to stdout only and leaves stderr empty.
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AC2, LEDGER, SCENE3D, SHOW, buildCommand, cargoBuild, copyOut, isObject, live, readLedger, useBins, useBuild, useTemp, type Ran } from './helpers.ts';

const releaseBin = useBuild('release');
const bins = useBins();
const temp = useTemp();

const word = (text: string, w: string): boolean => new RegExp(`(^|[^A-Za-z0-9_])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`).test(text);

/** The refusal's checks: exit 2, no line answered, and stderr naming `seal_refused` and each of `modules`. */
function refusedNaming(r: Ran, modules: string[], what: string): void {
  const said = `exit ${String(r.status)}; stdout: ${r.stdout.slice(0, 1500)}; stderr: ${JSON.stringify(r.stderr.slice(-1500))}`;
  expect(r.timedOut, `${what}: deep-show live finished within 5 minutes`).toBe(false);
  expect(r.lines.some((l) => isObject(l) && l['code'] === 'bad_input'), `${what}: deep-show live refuses to seal, so it reads no line: ${said}`).toBe(false);
  expect(r.status, `${what}: deep-show live exits 2 on a refused seal: ${said}`).toBe(2);
  expect(r.stderr.trim(), `${what}: deep-show live's stderr isn't empty when it refuses to seal: ${said}`).not.toBe('');
  expect(word(r.stderr, 'seal_refused'), `${what}: stderr names the code seal_refused: ${said}`).toBe(true);
  for (const m of modules) expect(word(r.stderr, m), `${what}: stderr names the module ${m}: ${said}`).toBe(true);
}

describe(`${AC2} when deep-show live refuses to seal, its stderr names the code and the module`, () => {
  it(`${AC2} a release build whose ledger records scene3d at a digest its sources don't have: deep-show live refuses to seal (kit_failed) and its stderr names seal_refused and scene3d`, () => {
    const ledger = readLedger(LEDGER);
    const record = ledger[SCENE3D];
    expect(isObject(record), `the committed ledger has a scene3d record: ${JSON.stringify(record ?? null)}`).toBe(true);
    const stale = join(temp(), 'kit-ledger.json');
    writeFileSync(stale, `${JSON.stringify({ ...ledger, [SCENE3D]: { ...(record as object), digest: '0'.repeat(64) } }, null, 2)}\n`);
    const bin = join(bins(), `${SHOW}-stale-scene3d`);
    let error = '';
    try {
      error = cargoBuild('release', stale);
      if (error === '') copyOut('release', bin);
    } finally {
      // target/ goes back to the committed ledger's release build.
      const restored = cargoBuild('release');
      expect(restored, `the release build is made again with the committed ledger: ${buildCommand('release')}`).toBe('');
    }
    expect(error, `the release build with the stale ledger builds: ${buildCommand('release', stale)}`).toBe('');
    refusedNaming(live(bin), [SCENE3D], 'scene3d recorded at another digest');
  }, 5_400_000);

  it(`${AC2} the release build of the committed ledger with --planted constraint_iterates_to_convergence: deep-show live refuses to seal (motion's planted constraint solve) and its stderr names seal_refused and motion`, () => {
    refusedNaming(live(releaseBin(), ['--planted', 'constraint_iterates_to_convergence']), ['motion'], 'motion with a planted constraint solve');
  }, 600_000);
});

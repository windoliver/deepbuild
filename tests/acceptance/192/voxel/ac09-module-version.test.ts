// #192.aeb0ef10: A provider's content key names the sandbox module's version, not the logic module's: in a test build
// that changes only the logic module's version, checking the voxel document again runs the provider zero times and
// reuses its output by key, while a build that changes only the sandbox module's version runs it once; a planted key
// that names the logic module's version runs it again after the logic-only change and fails, naming the key's term.
//
// Three builds share one `--cache` folder, where a provider's output is kept by its content key across processes
// (README: The surface): `full,test-mesh-item`, the same with `test-logic-version-bump` (only the logic module's
// version differs, as `registry`'s `versions` shows) and with `test-sandbox-version-bump` (only the sandbox module's).
// Each installs the voxel pack and checks the voxel document once; the sandbox module's `runs` before and after that
// check say whether the provider ran. Then the first two builds again, each with the scenario's `planted:
// "provider_key_names_logic"`, on a fresh cache: this test's check must fail, naming the logic module's version.
import { describe, expect, it } from 'vitest';
import {
  DOC, LOGIC_BUMP, MESH_BUILD, REGISTRY, SANDBOX, SANDBOX_BUMP, countsOf, deepShow, installPack, meshOf, present, provided, rowOf, runShow,
  scenario, show, sub, useTemp, versionOf, type Feature, type PackDir, type Planted,
} from './helpers.ts';
import { SIZE, voxPack, voxelDoc } from './programs.ts';

const ID = '#192.aeb0ef10';
const temp = useTemp();
const SEED = 192_009;

interface Checked { logic: string; sandbox: string; ran: number; key: string; out: string }
/** One process of `features` on the shared `cache`: the modules' versions, and the voxel document checked once. */
function check(features: Feature[], vox: PackDir, evidence: string, cache: string, planted?: Planted): Checked {
  const [registry, install, before, shown, after, out] = runShow(deepShow(features), scenario(evidence, [
    REGISTRY, installPack(vox), SANDBOX, present(DOC.a, voxelDoc(SIZE.first, SEED)), SANDBOX, provided(DOC.a),
  ], planted), cache);
  const what = `${features.join(',')}${planted ? ` (planted ${planted})` : ''}`;
  expect(install!['outcome'], `${what}: test/voxpack@1.0.0 installs: ${show(install)}`).toBe('installed');
  expect(shown!['outcome'], `${what}: the voxel document is presented: ${show(shown)}`).toBe('presented');
  const row = rowOf(out!, 'vox', what);
  return {
    logic: versionOf(registry!, 'logic'), sandbox: versionOf(registry!, 'sandbox'),
    ran: countsOf(after!, `${what}: sandbox after`).runs - countsOf(before!, `${what}: sandbox before`).runs,
    key: row.key, out: JSON.stringify(meshOf(row, `${what}: the mesh`)),
  };
}
/** What the criterion requires after the first build, of a logic-only build and (when given) a sandbox-only build. */
function failures(first: Checked, logicOnly: Checked, sandboxOnly?: Checked): string[] {
  const out: string[] = [];
  if (first.ran !== 1) out.push(`the first build's check ran the provider ${first.ran} times, not once`);
  if (logicOnly.logic === first.logic || logicOnly.sandbox !== first.sandbox) out.push(`the logic test build changes the logic module's version and only it: logic ${first.logic} → ${logicOnly.logic}, sandbox ${first.sandbox} → ${logicOnly.sandbox}`);
  if (logicOnly.ran !== 0) out.push(`after a build that changed only the logic module's version (${first.logic} → ${logicOnly.logic}), the check ran the provider ${logicOnly.ran} times, not 0: the content key's term for the logic module's version changed it`);
  if (logicOnly.key !== first.key) out.push(`the content key changed with only the logic module's version: ${first.key} → ${logicOnly.key} (a key term names the logic module's version)`);
  if (logicOnly.out !== first.out) out.push('the logic-only build\'s check didn\'t reuse the output by key: its mesh differs');
  if (sandboxOnly) {
    if (sandboxOnly.sandbox === first.sandbox || sandboxOnly.logic !== first.logic) out.push(`the sandbox test build changes the sandbox module's version and only it: sandbox ${first.sandbox} → ${sandboxOnly.sandbox}, logic ${first.logic} → ${sandboxOnly.logic}`);
    if (sandboxOnly.ran !== 1) out.push(`after a build that changed only the sandbox module's version (${first.sandbox} → ${sandboxOnly.sandbox}), the check ran the provider ${sandboxOnly.ran} times, not once: the content key doesn't name the sandbox module's version`);
    if (sandboxOnly.key === first.key) out.push(`the content key stayed ${first.key} across the sandbox module's version change`);
  }
  return out;
}

describe(`${ID} a provider's content key names the sandbox module's version, not the logic module's`, () => {
  it(`${ID} after a build that changes only the logic module's version the voxel document's check runs the provider zero times and reuses its output by key, after one that changes only the sandbox module's version it runs once; a planted key naming the logic module's version runs it again and fails, naming the key's term`, () => {
    const root = temp();
    const vox = voxPack(sub(root, 'packs'));
    const cache = sub(root, 'cache');
    const first = check(MESH_BUILD, vox, sub(root, 'evidence-1'), cache);
    const logicOnly = check(LOGIC_BUMP, vox, sub(root, 'evidence-2'), cache);
    const sandboxOnly = check(SANDBOX_BUMP, vox, sub(root, 'evidence-3'), cache);
    expect(failures(first, logicOnly, sandboxOnly), 'the key names the sandbox module\'s version and not the logic module\'s').toEqual([]);

    const plantedCache = sub(root, 'cache-planted');
    const planted = failures(
      check(MESH_BUILD, vox, sub(root, 'evidence-4'), plantedCache, 'provider_key_names_logic'),
      check(LOGIC_BUMP, vox, sub(root, 'evidence-5'), plantedCache, 'provider_key_names_logic'),
    );
    expect(planted.length, 'the planted key that names the logic module\'s version fails this check').toBeGreaterThan(0);
    expect(planted.filter((f) => f.includes('term') && f.includes('logic module\'s version')), `and a failure names that key term, the logic module's version: ${show(planted)}`).not.toEqual([]);
  }, 3_600_000);
});

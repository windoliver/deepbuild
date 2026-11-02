// Criterion 7: the canvas links Vello GPU and Vello CPU and never Vello's compute renderer, checked on the dependency
// tree, so the spike measures the renderer the decision names.
//
// Checked with `cargo tree` on the checkout: the GPU layer's package (`deep-gpu-layer`, whose `deep-gpu` binary draws the
// live 2D path and runs the spike) links `vello_gpu` 0.3 and `vello_cpu` 0.3, Vello GPU on the same wgpu the GPU layer
// uses; no package of the workspace, in any dependency kind, links Vello's compute renderer (`vello`, with its
// `vello_encoding` and `vello_shaders`, under research/ upstream at 235739c4f0), and Cargo.lock holds none of them. The
// spike's renderer, as `deep-gpu run`'s `vello_gpu` call answers it (README), is Vello GPU at the locked version. At the
// base nothing links `vello_gpu`.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CARGO_ENV, DEEP_GPU, REPO, gpuReplies, lockedVersions, needsMac, obj, useBuilds, useDir } from './helpers.ts';

const builds = useBuilds([DEEP_GPU]);
const dir = useDir('deep-385-deps-');
const COMPUTE = ['vello', 'vello_encoding', 'vello_shaders'];

function tree(args: string[]): string[] {
  const run = spawnSync('cargo', ['tree', '--locked', '--prefix', 'none', ...args], { cwd: REPO, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: CARGO_ENV });
  expect(run.status, `cargo tree ${args.join(' ')} ran: ${run.stderr.slice(-2000)}`).toBe(0);
  return run.stdout.split('\n').filter((l) => l.trim() !== '');
}
/** Each package of a tree as `name version` (cargo tree's `name vX.Y.Z` lines). */
const packages = (lines: string[]): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  for (const l of lines) {
    const m = /^([A-Za-z0-9_-]+) v(\S+)/.exec(l.trim());
    if (m) out.set(m[1]!, (out.get(m[1]!) ?? new Set()).add(m[2]!));
  }
  return out;
};
/** The compute renderer's packages a tree holds. */
const computeIn = (lines: string[]): string[] => [...packages(lines).entries()].filter(([n]) => COMPUTE.includes(n)).map(([n, v]) => `${n} ${[...v].join(', ')}`);

describe('C7 the canvas links Vello GPU and Vello CPU, never Vello\'s compute renderer', () => {
  it('C7 on the dependency tree: deep-gpu-layer links vello_gpu 0.3 and vello_cpu 0.3, Vello GPU on the GPU layer\'s wgpu; nothing in the workspace or Cargo.lock is Vello\'s compute renderer', () => {
    // The check itself names the compute renderer when a tree holds it.
    expect(computeIn(['deep-canvas v0.0.0 (/x)', 'vello v0.11.0', 'vello_cpu v0.3.0']), 'the check finds the compute renderer in a tree that holds it').toEqual(['vello 0.11.0']);
    const gpuLayer = packages(tree(['-p', 'deep-gpu-layer', '-e', 'normal,build']));
    const has = (name: string): string[] => [...(gpuLayer.get(name) ?? [])];
    expect(has('vello_gpu').filter((v) => v.startsWith('0.3.')), `deep-gpu-layer links vello_gpu 0.3 (it links ${JSON.stringify(has('vello_gpu'))})`).not.toEqual([]);
    expect(has('vello_cpu').filter((v) => v.startsWith('0.3.')), `deep-gpu-layer links vello_cpu 0.3 (it links ${JSON.stringify(has('vello_cpu'))})`).not.toEqual([]);
    const direct = packages(tree(['-p', 'deep-gpu-layer', '-e', 'normal', '--depth', '1']));
    const vgDeps = packages(tree(['-p', `vello_gpu@${has('vello_gpu')[0] ?? '0.3.0'}`, '-e', 'normal', '--depth', '1']));
    expect([...(vgDeps.get('wgpu') ?? [])], 'Vello GPU draws through the wgpu the GPU layer uses').toEqual([...(direct.get('wgpu') ?? ['none'])]);
    const workspace = tree(['--workspace', '-e', 'normal,build,dev']);
    expect(computeIn(workspace), 'no workspace package links Vello\'s compute renderer').toEqual([]);
    for (const name of COMPUTE) expect(lockedVersions(name), `Cargo.lock holds no ${name}`).toEqual([]);
  }, 1_800_000);

  it('C7 the spike measures the renderer the decision names: Vello GPU at the locked version', () => {
    expect(lockedVersions('vello_gpu').length, 'Cargo.lock holds vello_gpu').toBe(1);
    needsMac();
    const [vg] = gpuReplies(builds.bin(DEEP_GPU), dir(), [{ call: 'vello_gpu' }]);
    const want = { name: 'vello_gpu', version: lockedVersions('vello_gpu')[0] };
    expect(obj(vg!['renderer'], 'vello_gpu: renderer'), 'the live 2D path is Vello GPU').toEqual(want);
    expect(obj(obj(vg!['spike'], 'vello_gpu: spike')['renderer'], 'the spike record\'s renderer'), 'the spike measured it').toEqual(want);
  }, 1_800_000);
});

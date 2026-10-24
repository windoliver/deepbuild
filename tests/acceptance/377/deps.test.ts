// #377.66576129: no game engine is a dependency of the app; the canvas draws with its own wgpu renderer.
// Read from `cargo metadata --locked` of this checkout: the GPU layer is a workspace crate of ours (not
// vendored) that depends on wgpu directly and holds the `deep-gpu` binary or is in its dependency tree;
// no game engine is in the normal dependency tree, on any target, of the app (deep-app), of that crate
// or of the binary's crate. The check's own twin: the same metadata with an engine added under the app
// fails it, naming the engine. At the base no workspace crate depends on wgpu.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { BIN_NAME, REPO } from './helpers.ts';

interface Dep { name: string; kind: string | null }
interface Package { id: string; name: string; source: string | null; manifest_path: string; dependencies: Dep[]; targets: { name: string; kind: string[] }[] }
interface Node { id: string; deps: { pkg: string; dep_kinds: { kind: string | null }[] }[] }
interface Metadata { packages: Package[]; workspace_members: string[]; resolve: { nodes: Node[] } }

/** Game engines and the frameworks built as one, by crate name. */
const ENGINES = /^(bevy|bevy_.+|fyrox(-.+)?|godot(-.+)?|gdext|gdnative(-.+)?|unreal(-.+)?|three-d(-.+)?|three_d|macroquad|miniquad|ggez|piston(2d)?(-.+)?|amethyst(_.+)?|rend3(-.+)?|kiss3d|raylib(-.+)?|comfy|notan(_.+)?|nannou(_.+)?|tetra|quicksilver|coffee|oxygengine(-.+)?|ambient_.+|blue_engine|bracket-lib|good-web-game|urho(-.+)?|ogre(-.+)?)$/;

function metadata(): Metadata {
  const r = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  expect(r.status, `cargo metadata --locked runs: ${r.stderr?.slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as Metadata;
}

/** Every package in the normal dependency tree of `root` (dev and build dependencies left out), on any target. */
function tree(meta: Metadata, root: string): Set<string> {
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const walk = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const d of nodes.get(id)?.deps ?? []) if (d.dep_kinds.some((k) => k.kind === null)) walk(d.pkg);
  };
  walk(root);
  return seen;
}

/** The GPU layer's crates, the roots checked, and the problems found, each naming what it found. */
function check(meta: Metadata): { gpu: string[]; problems: string[] } {
  const byId = new Map(meta.packages.map((p) => [p.id, p]));
  const members = meta.workspace_members.map((id) => byId.get(id)!).filter(Boolean);
  const ours = members.filter((p) => p.source === null && !p.manifest_path.includes('/vendor/'));
  const gpu = ours.filter((p) => p.dependencies.some((d) => d.name === 'wgpu' && d.kind === null));
  const problems: string[] = [];
  if (gpu.length === 0) problems.push('no workspace crate of ours depends on wgpu directly: the canvas has no wgpu renderer of its own');
  const app = members.find((p) => p.name === 'deep-app');
  if (!app) problems.push('no deep-app crate in the workspace');
  const binCrate = members.find((p) => p.targets.some((t) => t.name === BIN_NAME && t.kind.includes('bin')));
  if (!binCrate) problems.push(`no workspace crate has the ${BIN_NAME} binary`);
  else if (gpu.length && !gpu.some((g) => tree(meta, binCrate.id).has(g.id))) problems.push(`${binCrate.name} (the ${BIN_NAME} binary) doesn't draw with the GPU layer crate (${gpu.map((g) => g.name).join(', ')})`);
  for (const root of [app, binCrate, ...gpu].filter((p): p is Package => p !== undefined)) {
    for (const id of tree(meta, root.id)) {
      const p = byId.get(id);
      if (p && ENGINES.test(p.name)) problems.push(`${root.name} depends on the game engine ${p.name} ${id}`);
    }
  }
  return { gpu: gpu.map((g) => g.name), problems: [...new Set(problems)] };
}

describe('#377.66576129 no game engine is a dependency of the app; the canvas draws with its own wgpu renderer', () => {
  it('#377.66576129 the GPU layer is our own crate on wgpu, and no game engine is in the app\'s, the GPU layer\'s or the binary\'s dependency tree; an engine planted under the app fails the check, naming it', () => {
    const meta = metadata();
    const real = check(meta);
    expect(real.problems, 'the dependency trees of the app, the GPU layer and the binary').toEqual([]);
    // The twin: the same metadata with bevy under deep-app.
    const app = meta.packages.find((p) => p.name === 'deep-app')!;
    const bevy: Package = { id: 'registry+https://github.com/rust-lang/crates.io-index#bevy@0.17.0', name: 'bevy', source: 'registry+https://github.com/rust-lang/crates.io-index', manifest_path: '/registry/bevy/Cargo.toml', dependencies: [], targets: [] };
    const planted: Metadata = {
      ...meta,
      packages: [...meta.packages, bevy],
      resolve: { nodes: [...meta.resolve.nodes.map((n) => (n.id === app.id ? { ...n, deps: [...n.deps, { pkg: bevy.id, dep_kinds: [{ kind: null }] }] } : n)), { id: bevy.id, deps: [] }] },
    };
    expect(check(planted).problems.join('\n'), 'an engine under the app fails the check, naming it').toMatch(/deep-app depends on the game engine bevy/);
  }, 600_000);
});

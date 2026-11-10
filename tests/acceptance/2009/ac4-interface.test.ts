// #2009.e7924149: no Rapier type crosses the backend interface: the physics crate's public items and every world
// document field name none, checked from the crate's public API; and a checkpoint whose backend version differs from
// the pin is refused at restore, naming both versions, never loaded. Twins: the Cargo feature `test-leaks-rapier`
// (a public re-export and a public function naming a Rapier type), caught by the API check; `restore_ignores_version`,
// which loads the other version's checkpoint, caught by the restore judge.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RAPIER_CRATES, fieldNames, leaks, type Doc } from './api.ts';
import {
  AC, BACKEND, CARGO_ENV, PIN, REPO, TARGET, TIMEOUT, arr, bake, blocked, caught, cargoError, dynamic, floor, none, obj, physics,
  prebuild, show, sphere, world, type JsonObject, type JsonValue,
} from './helpers.ts';

prebuild();

const RAPIER_CRATE = 'deep-physics-rapier';
const LEAK_FEATURE = 'test-leaks-rapier';
/** World document fields the public API must hold as fields, so the scan reaches the document (README). */
const DOC_FIELDS = ['restitution_threshold', 'max_speed', 'contact_materials', 'rolling_resistance', 'tangent_speed'];
const DOC_TARGET = join(TARGET, 'acceptance-2009-doc');

interface Package { id: string; name: string; version: string; source: string | null; dependencies: { name: string; kind: string | null }[]; targets: { name: string; kind: string[] }[] }
interface Metadata { packages: Package[]; workspace_members: string[] }
const rapierName = (name: string): boolean => RAPIER_CRATES.test(name.replace(/-/g, '_'));

function metadata(): Metadata {
  const r = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1'], { cwd: REPO, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, env: { ...process.env, ...CARGO_ENV } });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') blocked('cargo isn\'t on this machine');
  expect(r.status, `cargo metadata --locked runs: ${r.stderr?.slice(-2000)}`).toBe(0);
  return JSON.parse(r.stdout) as Metadata;
}
/** rustdoc's JSON of `crate`'s library on the stable toolchain (RUSTC_BOOTSTRAP=1 admits `--output-format json`). */
function rustdoc(crate: string, features: string[] = []): Doc {
  const error = cargoError(['rustdoc', '--locked', '-p', crate, '--lib', ...(features.length ? ['--features', features.join(',')] : []), '--', '-Z', 'unstable-options', '--output-format', 'json'],
    { RUSTC_BOOTSTRAP: '1', CARGO_TARGET_DIR: DOC_TARGET });
  expect(error, `rustdoc JSON of ${crate}${features.length ? ` with ${features.join(',')}` : ''}`).toBe('');
  const file = join(DOC_TARGET, 'doc', `${crate.replace(/-/g, '_')}.json`);
  expect(existsSync(file), `rustdoc wrote ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8')) as Doc;
}

const R = 0.1;
const restWorld = (): JsonObject => world({
  checkpoint: { every: 60 },
  contact_materials: { half: { friction: 0.5, restitution: 0.5, density: 1000 } },
  shapes: { floor: { kind: 'box', half: [30, 0.1, 30] }, ball: sphere(R) },
  bodies: { floor: floor('half'), ball: dynamic('ball', 'half', [0, 2 + R, 0], { mass: 1 }) },
});
const OTHER = '0.35.3';
/** Refused at restore, naming both versions, never loaded: not ok, no states, the reply's text holds both versions. */
function refusedRestore(reply: JsonObject): string[] {
  const f: string[] = [];
  if (reply['ok'] !== false) f.push(`the restore of a ${OTHER} checkpoint isn't refused: ok is ${show(reply['ok'])}`);
  if ('bodies' in reply) f.push('the refused restore answers states: the checkpoint was loaded');
  const text = JSON.stringify(reply);
  for (const v of [OTHER, PIN]) if (!text.includes(v)) f.push(`the refusal doesn't name ${v}: ${show(reply)}`);
  return f;
}

describe(`${AC[4]} no Rapier type crosses the backend interface; a checkpoint of another backend version is refused at restore`, () => {
  it(`${AC[4]} the physics crates' public API names no Rapier type and holds the world document's fields; rapier3d resolves to =${PIN}; the twin feature ${LEAK_FEATURE} is caught`, () => {
    const meta = metadata();
    const byId = new Map(meta.packages.map((p) => [p.id, p]));
    const members = meta.workspace_members.map((id) => byId.get(id)).filter((p): p is Package => p !== undefined);
    const users = members.filter((p) => p.dependencies.some((d) => d.kind === null && rapierName(d.name)));
    expect(users.some((p) => p.dependencies.some((d) => d.kind === null && d.name === BACKEND)), `a workspace crate depends on ${BACKEND} (crates on a Rapier crate: ${users.map((p) => p.name).join(', ') || 'none'})`).toBe(true);
    const versions = [...new Set(meta.packages.filter((p) => p.name === BACKEND).map((p) => p.version))];
    expect(versions, `${BACKEND} resolves to the pin alone`).toEqual([PIN]);
    const scanned = [...new Set([...users, ...members.filter((p) => p.name.includes('physics'))])];
    const names = scanned.map((p) => p.name);
    expect(names, `the crates scanned (each on a Rapier crate, or named for physics) include ${RAPIER_CRATE}`).toContain(RAPIER_CRATE);
    expect(scanned.find((p) => p.name === RAPIER_CRATE)!.targets.some((t) => t.name === 'deep-physics' && t.kind.includes('bin')), `${RAPIER_CRATE} holds the deep-physics binary`).toBe(true);
    const found: string[] = []; const fields = new Set<string>();
    for (const p of scanned) {
      if (!p.targets.some((t) => t.kind.includes('lib'))) { found.push(`${p.name} has no library, so its interface can't be read from a public API`); continue; }
      const doc = rustdoc(p.name);
      for (const l of leaks(doc)) found.push(`${p.name}: public ${l.kind} ${l.item} names ${l.names}`);
      for (const n of fieldNames(doc)) fields.add(n);
    }
    none(found, `no public item of ${names.join(', ')} names a Rapier type`);
    none(DOC_FIELDS.filter((f) => !fields.has(f)).map((f) => `no public field ${f}`), 'the world document\'s fields are public items the scan reads');
    const twin = leaks(rustdoc(RAPIER_CRATE, [LEAK_FEATURE]));
    caught(twin.filter((l) => l.kind === 'use').map((l) => l.item), `${LEAK_FEATURE}'s public re-export of a Rapier type`);
    caught(twin.filter((l) => l.kind === 'function').map((l) => l.item), `${LEAK_FEATURE}'s public function naming a Rapier type`);
  }, TIMEOUT);

  it(`${AC[4]} a checkpoint records rapier3d ${PIN} and restores to the bake's states; one of backend version ${OTHER} is refused at restore naming both versions, never loaded; the twin restore_ignores_version is caught`, () => {
    const w = restWorld();
    const [baked] = physics([bake(w, 180, { read: ['ball'], checkpoints: true })]);
    expect(baked!['ok'], `the bake runs: ${show(baked)}`).toBe(true);
    const cps = arr(baked!['checkpoints'], 'checkpoints').map((c, i) => obj(c, `checkpoints[${i}]`));
    const cp = cps.find((c) => c['step'] === 60);
    expect(cp, `a checkpoint at step 60 (every 60): steps ${cps.map((c) => show(c['step'])).join(', ')}`).toBeDefined();
    expect(cp!['backend'], 'the checkpoint names its backend and version').toEqual({ name: BACKEND, version: PIN });
    expect(typeof cp!['state'], 'the checkpoint holds the backend\'s state').toBe('string');
    const straight = arr(obj(baked!['bodies'], 'bodies')['ball'], 'bodies.ball');
    const other: JsonObject = { ...cp!, backend: { name: BACKEND, version: OTHER } };
    const restore = (c: JsonObject): JsonObject => ({ call: 'restore', world: w, checkpoint: c, steps: 60, read: ['ball'] });
    const [same, refused] = physics([restore(cp!), restore(other)]);
    expect(same!['ok'], `the pinned checkpoint restores: ${show(same)}`).toBe(true);
    const resumed = arr(obj(same!['bodies'], 'restored bodies')['ball'], 'restored bodies.ball');
    expect(resumed as JsonValue, 'restored at step 60 and run 60 steps, the ball\'s states equal the straight bake\'s, steps 60 to 120').toEqual(straight.slice(60, 121));
    none(refusedRestore(refused!), `a checkpoint of ${BACKEND} ${OTHER} is refused at restore`);
    const [twin] = physics([restore(other)], 'restore_ignores_version');
    expect(twin!['ok'], `restore_ignores_version answers: ${show(twin)}`).toBe(true);
    caught(refusedRestore(twin!), 'restore_ignores_version');
  }, TIMEOUT);
});

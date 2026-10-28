// AC3: a package that declares it replaces the app shell, the canvas core, the supervisor or the installer is
// refused at install.
//
// Those four are the trusted ring's pieces (design: "Plug-ins can't replace or extend the ring"). A manifest
// declares what it replaces in `replaces`, by name: `app-shell`, `canvas-core`, `supervisor`, `installer` (README,
// The surface under test). Each is tried twice, by a package inside DeepBuild's signed release and by one outside
// it, since no package may; the same package without the declaration then installs, so the refusal is the
// declaration's.
import { describe, expect, it } from 'vitest';
import { installedIds, installError, openHost, openWorld, pkg, releaseEntry } from './helpers.ts';

const RING = [
  { name: 'app-shell', label: 'the app shell' },
  { name: 'canvas-core', label: 'the canvas core' },
  { name: 'supervisor', label: 'the supervisor' },
  { name: 'installer', label: 'the installer' },
] as const;

describe('AC3 #351.542cefd7 a package that declares it replaces the app shell, the canvas core, the supervisor or the installer is refused at install', () => {
  for (const { name, label } of RING) {
    it(`AC3 a package that declares it replaces ${label} (replaces: ["${name}"]) is refused at install, inside the release or out; without the declaration it installs`, async () => {
      const inRelease = await pkg('plain', { manifest: { id: `deepbuild/ring-${name}`, replaces: [name] } });
      const outside = await pkg('plain', { manifest: { id: `test/ring-${name}`, replaces: [name] } });
      const h = await openHost(await openWorld(), { release: [await releaseEntry(inRelease)] });
      for (const [dir, id] of [[inRelease, `deepbuild/ring-${name}`], [outside, `test/ring-${name}`]] as const) {
        expect(await installError(h, dir), `${id}, which declares it replaces ${label}, is refused at install`).not.toBeNull();
        expect(await installedIds(h), `${id} isn't installed`).not.toContain(id);
      }
      const plain = await pkg('plain', { manifest: { id: `test/ring-${name}` } });
      expect(await installError(h, plain), `test/ring-${name} without the declaration installs`).toBeNull();
      expect(await installedIds(h)).toContain(`test/ring-${name}`);
    }, 120_000);
  }
});

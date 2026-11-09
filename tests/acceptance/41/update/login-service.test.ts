// AC #41 (login service): "After two updates, the login service still starts the hub, by its definition read
// back; a planted setup that pins a version's folder starts nothing once that folder is removed and fails."
//
// Surface assumed (the issue and design name no module; packages/hub/src/service.ts builds its plist inline and
// exports no definition function, so the tests pin a new pure one):
//   packages/cli/src/login-service.ts exports
//     serviceDefinition({ home: string }) => { programArguments: string[] }
//   - `home` is the install home holding `versions/<version>/` folders and the `versions/current` symlink that an
//     update switches. programArguments[0] is an absolute path to the executable the login service runs; it must
//     lie under `<home>/versions/current/` and must not name any `<home>/versions/<version>/` folder, so it is
//     the same text before and after any update and resolves through the link to whichever version is current.
//   - the tests run programArguments[0] with programArguments.slice(1), as the login service would; a fake
//     `bin/deep` shell script in each version prints `hub <version>`, so what starts is told from the version.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

type Def = { programArguments: string[] };
type Make = (o: { home: string }) => Def;
const load = async (): Promise<Make> =>
  ((await import('../../../../packages/cli/src/login-service.ts')) as { serviceDefinition: Make }).serviceDefinition;

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});

const fakeHome = (): string => {
  const home = mkdtempSync(join(tmpdir(), 'login-service-'));
  homes.push(home);
  for (const v of ['1.0.0', '1.1.0', '1.2.0']) {
    mkdirSync(join(home, 'versions', v, 'bin'), { recursive: true });
    const bin = join(home, 'versions', v, 'bin', 'deep');
    writeFileSync(bin, `#!/bin/sh\necho "hub ${v}"\n`);
    chmodSync(bin, 0o755);
  }
  return home;
};

/** An update as the installer does it: point a new link at the version and rename it over `current`, atomically. */
const switchTo = (home: string, v: string): void => {
  const tmp = join(home, 'versions', `.current-${v}`);
  symlinkSync(v, tmp);
  renameSync(tmp, join(home, 'versions', 'current'));
};

const start = (def: Def) => spawnSync(def.programArguments[0]!, def.programArguments.slice(1), { encoding: 'utf8' });

describe('the login service points at the link every update keeps', () => {
  it('AC16 #41.539bf83d after two updates and the removal of the old version folders, the definition read back still starts the hub, at the newest version', async () => {
    const serviceDefinition = await load();
    const home = fakeHome();
    switchTo(home, '1.0.0');
    serviceDefinition({ home }); // setup writes the definition once, at 1.0.0
    const written = JSON.stringify(serviceDefinition({ home }));
    switchTo(home, '1.1.0');
    switchTo(home, '1.2.0');
    rmSync(join(home, 'versions', '1.0.0'), { recursive: true });
    rmSync(join(home, 'versions', '1.1.0'), { recursive: true });
    expect(readlinkSync(join(home, 'versions', 'current'))).toBe('1.2.0');

    const def = serviceDefinition({ home });
    expect(JSON.stringify(def)).toBe(written); // an update leaves the definition untouched
    const r = start(def);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('hub 1.2.0\n');
  });

  it('AC16 #41.539bf83d the first program path goes through <home>/versions/current/ and names no version folder', async () => {
    const serviceDefinition = await load();
    const home = fakeHome();
    switchTo(home, '1.0.0');
    const first = serviceDefinition({ home }).programArguments[0]!;
    expect(first.startsWith(join(home, 'versions', 'current') + '/')).toBe(true);
    for (const v of ['1.0.0', '1.1.0', '1.2.0']) expect(first).not.toContain(`/versions/${v}`);
    for (const a of serviceDefinition({ home }).programArguments) expect(a).not.toMatch(/\/versions\/\d/);
  });

  it('AC16 #41.539bf83d a definition written at 1.0.0 starts 1.0.0 then, and after the switch to 1.2.0 the same text starts 1.2.0', async () => {
    const serviceDefinition = await load();
    const home = fakeHome();
    switchTo(home, '1.0.0');
    const def = serviceDefinition({ home });
    expect(start(def).stdout).toBe('hub 1.0.0\n');
    switchTo(home, '1.1.0');
    expect(start(def).stdout).toBe('hub 1.1.0\n');
    switchTo(home, '1.2.0');
    expect(start(def).stdout).toBe('hub 1.2.0\n');
  });

  it('AC16 #41.539bf83d its first program path is still there once every version but the current one is removed', async () => {
    const serviceDefinition = await load();
    const home = fakeHome();
    switchTo(home, '1.0.0');
    const def = serviceDefinition({ home });
    switchTo(home, '1.2.0');
    rmSync(join(home, 'versions', '1.0.0'), { recursive: true });
    rmSync(join(home, 'versions', '1.1.0'), { recursive: true });
    expect(existsSync(def.programArguments[0]!)).toBe(true);
  });
});

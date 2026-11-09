// AC19 #41.13231c35 "The rehearsal publishes to a loopback registry and nowhere else; a planted config whose registry
// resolves off loopback is refused before any upload, naming the URL. After the registry stops, the reinstall succeeds
// with 0 network requests". Issue scope: "Before any publish, the release rehearses it: every package goes to a registry
// on loopback only, then a fresh project installs `deepbuild` and each per-platform deep-hook package from it and runs
// `deep --version` and `deep doctor`. The registry is then stopped, and a reinstall from the npm cache succeeds with no
// network."
//
// Surface assumed (the issue and design name no command line, so this is the one the tests pin):
//   node scripts/release-rehearse.mjs --archives <dir> --work <dir>
//   - --archives: a release-pack --out folder: manifest.json = { commit, archives: [{ name, file, sha256 }] } beside the
//     tarballs it lists (the shape tests/acceptance/41/pack/pack.test.ts pins). The rehearsal publishes every one.
//   - --work: a folder that doesn't exist yet. The rehearsal makes <work>/home, the fresh HOME of every npm and deep it
//     runs (npm's cache is that HOME's default, <work>/home/.npm), and <work>/project, the fresh project; both stay after
//     it exits.
//   - Before any upload it resolves, for every archive, the registry that archive's publish would use (its package.json's
//     publishConfig.registry when it has one, as npm publish honours it over any flag); a URL whose host is not, or does not
//     resolve only to, a loopback address refuses the whole run: non-zero exit, the URL as written named on stdout or
//     stderr, and no `published:` line.
//   - Otherwise it starts a registry on a loopback address and prints `registry: <url>`; publishes every archive there,
//     printing `published: <name>@<version>` for each; installs `deepbuild` into <work>/project from it with npm
//     (--ignore-scripts), so the project's package-lock.json lists deepbuild and every per-platform package of the
//     manifest, each `resolved` under <url>; runs the installed `deep --version`, printing `deep --version: <its stdout,
//     trimmed>`, and `deep doctor`, printing `deep doctor: exit <code>`; stops the registry, printing `registry stopped`
//     (nothing answers at <url> once the rehearsal has exited); then removes the project's node_modules, reinstalls from
//     the npm cache and prints `reinstall network requests: <n>`.
//   - Exit 0 only when all of that succeeded and n is 0.
// The tests plant small packages packed with the real `npm pack` (helpers.ts releaseFolder), so each run stays short:
// `deepbuild` 0.41.0 whose `deep` answers --version and doctor, and deep-hook packages for this platform and one other,
// as its optionalDependencies. The planted off-loopback URLs are documentation addresses (192.0.2.0/24, 2001:db8::/32)
// that route nowhere, so a wrong program's upload reaches no one. Independently of the rehearsal's own count, the test
// reinstalls the left project from <work>/home's npm cache with `npm ci --offline`, its registry and proxy pointed at
// loopback tripwires that count every connection.

import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC19, answers, cleanup, type Files, NODE, NPM, PLATFORM_PACKAGE, releaseFolder, run, script, scrubbedEnv, shown, tempDir, tripwire } from './helpers.js';

afterAll(cleanup, 120_000);
const REHEARSE = script('release-rehearse.mjs');
const VERSION = '0.41.0';
const OTHER = process.platform === 'linux' ? '@deepbuild/deep-hook-darwin-arm64' : '@deepbuild/deep-hook-linux-x64';
const exec = (body: string) => ({ body, mode: 0o755 });
const json = (o: object) => `${JSON.stringify(o, null, 2)}\n`;

function plantedRelease(publishConfig: { root?: string; platform?: string } = {}): string {
  const platform = (name: string, registry?: string): Files => {
    const [os, cpu] = name.replace('@deepbuild/deep-hook-', '').split('-');
    return {
      'package.json': json({ name, version: VERSION, os: [os], cpu: [cpu], files: ['bin'], ...(registry ? { publishConfig: { registry } } : {}) }),
      'bin/deep-hook': exec(`#!/bin/sh\necho 'deep-hook ${name} ${VERSION}'\n`),
    };
  };
  return releaseFolder({
    root: {
      'package.json': json({ name: 'deepbuild', version: VERSION, bin: { deep: 'bin/deep.js' }, files: ['bin'],
        optionalDependencies: { [PLATFORM_PACKAGE]: VERSION, [OTHER]: VERSION },
        ...(publishConfig.root ? { publishConfig: { registry: publishConfig.root } } : {}) }),
      'bin/deep.js': exec([
        '#!/usr/bin/env node',
        'const [cmd] = process.argv.slice(2);',
        `if (cmd === '--version') { console.log('${VERSION}'); process.exit(0); }`,
        "if (cmd === 'doctor') { console.log('planted doctor: every item passed'); process.exit(0); }",
        'process.exit(2);',
        '',
      ].join('\n')),
    },
    here: platform(PLATFORM_PACKAGE, publishConfig.platform),
    other: platform(OTHER),
  }, tempDir('dh41ra-'));
}

// npm's retries and timeouts kept short, so a wrong program that tries an unroutable upload fails within the test.
const rehearseEnv = () => scrubbedEnv({ npm_config_fetch_retries: '0', npm_config_fetch_timeout: '20000' });
async function rehearse(archives: string) {
  const work = join(tempDir('dh41rw-'), 'work');
  const r = await run(NODE, [REHEARSE, '--archives', archives, '--work', work], { cwd: archives, env: rehearseEnv(), timeoutMs: 1_500_000 });
  return { r, work, text: `${r.stdout}\n${r.stderr}` };
}
const line = (text: string, prefix: string) => text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length).trim());
const LOOPBACK = /^(127(\.\d{1,3}){3}|\[::1\]|localhost)$/;

describe(`${AC19} The rehearsal publishes to a loopback registry and nowhere else, and the reinstall after it stops uses no network`, () => {
  it(`${AC19} every archive is published to the rehearsal's loopback registry, the fresh project installs deepbuild and each per-platform package from it, deep runs, the registry stops and the reinstall counts 0 network requests`, async () => {
    const archives = plantedRelease();
    const { r, work, text } = await rehearse(archives);
    expect(r.code, `the rehearsal of a clean release must pass:\n${shown(r)}`).toBe(0);

    const [url] = line(text, 'registry:');
    expect(url, `the rehearsal names its registry (registry: <url>):\n${text}`).toBeTruthy();
    expect(new URL(url!).hostname, `the rehearsal's registry ${url} is on loopback`).toMatch(LOOPBACK);
    expect(line(text, 'published:').sort(), 'every archive in the manifest was published there, once').toEqual(['deepbuild', PLATFORM_PACKAGE, OTHER].map((n) => `${n}@${VERSION}`).sort());

    const lockFile = join(work, 'project', 'package-lock.json');
    expect(existsSync(lockFile), `the fresh project's lockfile at ${lockFile}`).toBe(true);
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { packages: Record<string, { resolved?: string }> };
    for (const name of ['deepbuild', PLATFORM_PACKAGE, OTHER]) {
      const entry = lock.packages[`node_modules/${name}`];
      expect(entry, `the fresh project resolved ${name}`).toBeTruthy();
      expect(entry!.resolved ?? '', `${name} came from the loopback registry ${url}, nowhere else`).toMatch(new RegExp(`^${url!.replace(/\/$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));
    }
    for (const [key, entry] of Object.entries(lock.packages)) if (key && entry.resolved) expect(entry.resolved.startsWith(url!.replace(/\/$/, '')), `${key} resolved from ${entry.resolved}, not the loopback registry`).toBe(true);

    expect(line(text, 'deep --version:'), 'the installed deep answered --version with the released version').toEqual([VERSION]);
    expect(line(text, 'deep doctor:'), 'the installed deep doctor ran').toEqual(['exit 0']);
    expect(text.split('\n').map((l) => l.trim()), 'the rehearsal stopped its registry').toContain('registry stopped');
    expect(await answers(url!), `nothing answers at ${url} after the rehearsal exits`).toBe(false);
    expect(line(text, 'reinstall network requests:'), 'the rehearsal\'s reinstall counted no network request').toEqual(['0']);

    // The same reinstall, judged here: the left project from its npm cache, every network path a counting tripwire.
    const registryTrip = await tripwire();
    const proxyTrip = await tripwire();
    try {
      rmSync(join(work, 'project', 'node_modules'), { recursive: true, force: true });
      const env = scrubbedEnv({ HOME: join(work, 'home'), npm_config_registry: registryTrip.url, npm_config_proxy: proxyTrip.url, npm_config_https_proxy: proxyTrip.url, npm_config_noproxy: '', npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false' });
      const again = await run(NPM, ['ci', '--offline', '--ignore-scripts'], { cwd: join(work, 'project'), env, timeoutMs: 900_000 });
      expect(again.code, `a reinstall from the npm cache the rehearsal left, with no network, succeeds:\n${shown(again)}`).toBe(0);
      expect(registryTrip.count() + proxyTrip.count(), 'the reinstall made no network request').toBe(0);
      const deep = await run(join(work, 'project', 'node_modules', '.bin', 'deep'), ['--version'], { cwd: join(work, 'project'), env, timeoutMs: 120_000 });
      expect(deep.stdout.trim(), shown(deep)).toBe(VERSION);
      expect(existsSync(join(work, 'project', 'node_modules', ...PLATFORM_PACKAGE.split('/'), 'bin', 'deep-hook')), `${PLATFORM_PACKAGE} reinstalled`).toBe(true);
    } finally {
      await registryTrip.close();
      await proxyTrip.close();
    }
  }, 1_800_000);

  it.each([
    ['the deepbuild package publishes to an IPv4 address off loopback', { root: 'http://192.0.2.1:4873/' }, 'http://192.0.2.1:4873/'],
    ['a per-platform package publishes to a URL that starts 127.0.0.1 but whose host is off loopback', { platform: 'http://127.0.0.1@192.0.2.7:4873/' }, 'http://127.0.0.1@192.0.2.7:4873/'],
    ['a per-platform package publishes to an IPv6 address off loopback', { platform: 'http://[2001:db8::41]:4873/' }, 'http://[2001:db8::41]:4873/'],
  ])(`${AC19} a planted publishConfig.registry off loopback is refused before any upload, naming the URL: %s`, async (_label, planted, url) => {
    const { r, text } = await rehearse(plantedRelease(planted));
    expect(r.code, `the rehearsal must refuse:\n${shown(r)}`).not.toBe(0);
    expect(r.code, `the rehearsal must refuse, not crash or hang:\n${shown(r)}`).not.toBeNull();
    expect(text, 'the refusal names the URL as written').toContain(url);
    expect(line(text, 'published:'), 'nothing was uploaded anywhere before the refusal').toEqual([]);
  }, 1_800_000);
});

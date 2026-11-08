// AC1 #41.a90a4093 "`npx deepbuild setup` works on a clean macOS and Linux machine", and the npm part of AC9 #41.6d07af40
// "the npm package under 30 MB installed". Issue scope: "npm package with the `deep` command; deep-hook as per-platform
// optional packages"; the rehearsal installs "`deepbuild` and each per-platform deep-hook package" from a loopback
// registry "and runs `deep --version` and `deep doctor`". Design, How it installs: "one npm package, `deepbuild`, with
// the `deep` command. deep-hook ships as per-platform optional packages"; it needs Node 24.22 or newer.
//
// Here a clean machine is: the packages the release makes from this repository, served from a read-only registry on
// loopback (fixtures/registry.mjs, test-side; it serves those archives and nothing else, so a third-party dependency the
// release didn't ship fails the install, as the issue's rehearsal premise requires), a fresh HOME, an empty folder and a
// fresh project, and a clean environment (fixtures/clean-machine.mjs lists every variable it holds). Two stand-ins only:
// the login service (DEEP_HUB_LAUNCHER, so the machine's real launchd or systemd is never touched) and the OS
// confirmation (DEEP_HUB_TEST_CONFIRM), as every setup suite in this repo stubs them. The Linux half runs the same script
// inside a Linux container with no network when a container runtime answers `docker info`; when none answers, or its
// image isn't present locally (this suite never pulls), that test fails reporting BLOCKED with the reason, never a pass.
//
// Surface assumed (the issue and design name the package and command; these are the names the tests pin):
//   - the release's archives come from `node scripts/release-pack.mjs --repo <dir> --commit <sha> --out <dir>` (pinned by
//     tests/acceptance/41/pack/pack.test.ts), run on a fresh shallow clone of this checkout's committed HEAD, offline
//     (npm's registry a closed loopback port with npm_config_offline=true, CARGO_NET_OFFLINE=true): uncommitted work is
//     not in a release, and the release's build, if any, takes its dependencies from the local caches;
//   - its manifest lists an archive named `deepbuild` (bin `deep`, so `npx deepbuild <args>` runs `deep <args>`) and one
//     per platform named `@deepbuild/deep-hook-<process.platform>-<process.arch>` (here PLATFORM_PACKAGE, and
//     `@deepbuild/deep-hook-linux-<arch>` for the container), which holds the deep-hook binary at `bin/deep-hook`;
//   - `deep --version` prints the deepbuild archive's package.json version; `deep doctor --json` prints one JSON item per
//     line and exits 0, 1 or 3 (its own verdicts: pass, an item failed, an item not checked);
//   - after `npx deepbuild setup`, every hook command in Claude Code's settings that names a program called deep-hook
//     names one whose bytes are the per-platform archive's `bin/deep-hook` (a copy or a link), never this checkout's build.
// AC9 measures every regular file under the fresh project's node_modules after `npm install deepbuild` (deepbuild, its
// dependencies and this platform's deep-hook package; links not followed), against 30 MB = 30,000,000 bytes.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, AC9, cleanup, FIXTURES, NODE, PLATFORM_PACKAGE, release, REPO, rootArchive, run, scrubbedEnv, sharedDir, shown, tempDir, type Release } from './helpers.js';

afterAll(async () => { for (const name of containers) spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); await cleanup(); }, 120_000);
const containers: string[] = [];
const IMAGE = 'node:24-bookworm-slim';
const BUDGET = 30_000_000;

interface Step { command: string; code: number | null; signal: string | null; error: string | null; stdout: string; stderr: string }
interface Result {
  platform: string; arch: string; node: string; registry: string | null; steps: Record<string, Step | undefined>;
  settingsText: string | null; claudeJsonText: string | null; hooks: Array<{ command: string; path: string; real: string | null; sha256: string | null }>;
  platformPackage: string; archiveHookSha256?: string | null; installed: string[]; nodeModulesBytes: number | null;
  packageBytes: Record<string, number>; projectHookSha256: string | null; registryLog: string;
}
const stepShown = (s: Step | undefined) => (s ? `${s.command}: exit ${s.code}${s.signal ? ` (${s.signal})` : ''}${s.error ? `, ${s.error}` : ''}\n--- stdout\n${s.stdout.slice(-3000)}\n--- stderr\n${s.stderr.slice(-3000)}` : 'never ran');

/** The clean-machine run on this host, once per file: AC1's macOS test and AC9 read the same install. */
let hostRun: Promise<{ rel: Release; res: Result }> | undefined;
function onHost() {
  hostRun ??= (async () => {
    const rel = await release();
    rootArchive(rel);
    const work = tempDir('dh41c-');
    const r = await run(NODE, [join(FIXTURES, 'clean-machine.mjs'), rel.out, work, FIXTURES], { cwd: work, env: scrubbedEnv(), timeoutMs: 3_600_000 });
    if (!existsSync(join(work, 'result.json'))) throw Error(`the clean-machine run wrote no result: ${shown(r)}`);
    return { rel, res: JSON.parse(readFileSync(join(work, 'result.json'), 'utf8')) as Result };
  })();
  return hostRun;
}

/** What "works" means on either machine, judged from the run's own record. */
function judge(res: Result, rel: Release, opts: { checkout?: string }) {
  const { version } = rootArchive(rel);
  expect(res.registry, 'the loopback registry over the release\'s archives started').toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  expect(rel.manifest.archives.map((a) => a.name), `the release must make ${res.platformPackage}, deep-hook's package for this machine`).toContain(res.platformPackage);
  expect(res.archiveHookSha256, `${res.platformPackage}'s archive must hold the deep-hook binary at bin/deep-hook`).toMatch(/^[0-9a-f]{64}$/);

  const setup = res.steps.setup;
  expect(setup?.code, `npx deepbuild setup must exit 0:\n${stepShown(setup)}`).toBe(0);
  const npxVersion = res.steps.npxVersion;
  expect(npxVersion?.code, stepShown(npxVersion)).toBe(0);
  expect(npxVersion!.stdout.trim(), 'npx deepbuild --version prints the released version').toBe(version);

  const install = res.steps.install;
  expect(install?.code, `npm install deepbuild in a fresh project must succeed from the release's archives alone:\n${stepShown(install)}`).toBe(0);
  expect(res.installed, 'the fresh project holds deepbuild').toContain('deepbuild');
  expect(res.installed, `the fresh project holds ${res.platformPackage}, the optional package for this platform`).toContain(res.platformPackage);
  expect(res.projectHookSha256, `${res.platformPackage} as installed holds the archive's bin/deep-hook`).toBe(res.archiveHookSha256);
  const v = res.steps.version;
  expect(v?.code, stepShown(v)).toBe(0);
  expect(v!.stdout.trim(), 'the installed deep --version prints the released version').toBe(version);

  const doctor = res.steps.doctor;
  expect([0, 1, 3], `deep doctor runs from the installed files and gives its own verdict:\n${stepShown(doctor)}`).toContain(doctor?.code);
  expect(doctor!.stderr, 'deep doctor loads every module it needs from the install').not.toMatch(/ERR_MODULE_NOT_FOUND|Cannot find (module|package)/);
  const items = doctor!.stdout.split('\n').filter((l) => l.trim());
  expect(items.length, `deep doctor --json prints its items:\n${stepShown(doctor)}`).toBeGreaterThan(0);
  for (const line of items) {
    let item: unknown;
    try { item = JSON.parse(line); } catch { item = undefined; }
    expect(typeof (item as { code?: unknown } | undefined)?.code, `each deep doctor --json line is an item with a code: ${line}`).toBe('string');
  }

  const hooks = res.hooks.filter((h) => basename(h.path) === 'deep-hook');
  expect(hooks.length, `setup writes Claude Code hook commands that run deep-hook; settings.json:\n${res.settingsText}`).toBeGreaterThan(0);
  for (const h of hooks) {
    expect(h.real, `the deep-hook a hook command names exists: ${h.command}`).not.toBeNull();
    expect(h.sha256, `the deep-hook ${h.path} the hooks run is the release's ${res.platformPackage} bin/deep-hook`).toBe(res.archiveHookSha256);
  }
  if (opts.checkout) {
    const at = opts.checkout;
    for (const h of hooks) expect(h.real!.startsWith(`${at}/`), `the hooks run a deep-hook outside this checkout: ${h.real}`).toBe(false);
    expect(res.settingsText ?? '', 'Claude Code\'s settings name nothing in this checkout').not.toContain(at);
    expect(res.claudeJsonText ?? '', 'Claude Code\'s user state names nothing in this checkout').not.toContain(at);
    expect(`${doctor!.stdout}${doctor!.stderr}`, 'deep doctor reports nothing from this checkout').not.toContain(at);
  }
}

describe(`${AC1} npx deepbuild setup works on a clean macOS and Linux machine`, () => {
  it(`${AC1} macOS: from the release's packages on a loopback registry, in a fresh HOME and a clean environment, npx deepbuild setup succeeds and deep --version and deep doctor run from the installed files`, async () => {
    if (process.platform !== 'darwin') throw Error(`BLOCKED: the macOS half needs a Mac; this is ${process.platform}`);
    const { rel, res } = await onHost();
    expect(res.platform).toBe('darwin');
    judge(res, rel, { checkout: REPO });
  }, 7_200_000);

  it(`${AC1} Linux: the same install inside a Linux container with no network succeeds the same way, or the test reports BLOCKED when no container runtime answers`, async () => {
    const info = await run('docker', ['info', '--format', '{{.OSType}} {{.Architecture}}'], { cwd: REPO, env: scrubbedEnv({ PATH: `${process.env.PATH ?? ''}` }), timeoutMs: 120_000 });
    if (info.code !== 0) throw Error(`BLOCKED: no container runtime answers \`docker info\` (${info.error ?? `exit ${info.code}: ${(info.stderr || info.stdout).trim().slice(0, 400)}`}); start one, then run this test again`);
    const image = await run('docker', ['image', 'inspect', '--format', '{{.Os}}', IMAGE], { cwd: REPO, env: scrubbedEnv({ PATH: `${process.env.PATH ?? ''}` }), timeoutMs: 120_000 });
    if (image.code !== 0) throw Error(`BLOCKED: the image ${IMAGE} isn't present locally and this suite never pulls (no network); run \`docker pull ${IMAGE}\` once, then run this test again`);
    const rel = await release();
    rootArchive(rel);
    const work = sharedDir('dh41-linux-');
    cpSync(rel.out, join(work, 'a'), { recursive: true });
    const name = `dh41-rehearse-${process.pid}-${Date.now()}`;
    containers.push(name);
    const uid = `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`;
    const r = await run('docker', ['run', '--rm', '--name', name, '--network', 'none', '--pull', 'never', '--user', uid,
      '-v', `${work}:/w`, '-v', `${FIXTURES}:/t:ro`, IMAGE, 'node', '/t/clean-machine.mjs', '/w/a', '/w/m', '/t'],
    { cwd: work, env: scrubbedEnv({ PATH: `${process.env.PATH ?? ''}` }), timeoutMs: 3_600_000 });
    const file = join(work, 'm', 'result.json');
    expect(existsSync(file), `the container's run wrote no result: ${shown(r)}`).toBe(true);
    const res = JSON.parse(readFileSync(file, 'utf8')) as Result;
    expect(res.platform).toBe('linux');
    judge(res, rel, {});
  }, 7_200_000);
});

describe(`${AC9} the npm package under 30 MB installed`, () => {
  it(`${AC9} deepbuild and this platform's deep-hook package, installed into a fresh project from the release's archives, take under 30 MB`, async () => {
    const { res } = await onHost();
    expect(res.steps.install?.code, `npm install deepbuild must succeed before its size means anything:\n${stepShown(res.steps.install)}`).toBe(0);
    expect(res.installed, 'deepbuild is installed').toContain('deepbuild');
    expect(res.installed, `${PLATFORM_PACKAGE} is installed, so its binary is counted`).toContain(PLATFORM_PACKAGE);
    expect(res.projectHookSha256, `${PLATFORM_PACKAGE} holds bin/deep-hook`).toMatch(/^[0-9a-f]{64}$/);
    const sizes = Object.entries(res.packageBytes).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, b]) => `${n} ${b}`).join(', ');
    expect(res.nodeModulesBytes, `installed size ${res.nodeModulesBytes} bytes against ${BUDGET}; largest: ${sizes}`).not.toBeNull();
    expect(res.nodeModulesBytes!, `installed size ${res.nodeModulesBytes} bytes against ${BUDGET}; largest: ${sizes}`).toBeLessThan(BUDGET);
  }, 7_200_000);
});

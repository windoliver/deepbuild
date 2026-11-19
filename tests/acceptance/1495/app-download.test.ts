// AC7 #1495.7644dc0b From the extracted app download, with every read outside its folder and a fresh HOME refused and
// the network off, `deep --version` prints the release's version and the fixture film's still exports. A planted bundle
// that loads a font from the checkout is refused that read and fails, naming the path.
//
// Issue, Scope: "The app download gets the proof the npm install has in #41. From its extracted copy alone, under the
// platform sandbox (#236) with reads granted only to that folder and a fresh HOME and with no network, `deep --version`
// prints the release's version and the fixture film's still exports". Design, Cutting a release: "From its extracted
// copy alone, under the platform sandbox with reads granted only to that folder, a fresh HOME and no network, the app
// download prints the release's version and exports the fixture film's still"; Platforms: fonts are "bundled fonts only".
//
// Surfaces (README, The contract 4, 5, 9 and 12; How to run): the real app download of this checkout's HEAD, built once
// per commit under target/da1495/<commit>/ from the release's archives (scripts/release-pack.mjs, then
// scripts/app-runtime.mjs) and zipped as the release zips it; the planted bundle from `scripts/app-runtime.mjs --plant
// checkout-font`; each handed to a fixture release whose signed manifest lists it, and verified by `tag`. The test's own
// check of the first sentence runs the extracted copy under the platform sandbox seam (@deepbuild/supervisor's
// Seatbelt backend), granted reads of that folder and a fresh HOME, writes to that HOME, and no host.
// Wrong programs: the base (no scripts/release.mjs, and no canvas core in the app's runtime folder); a release whose app
// check passes a bundle that reads outside its folder (the plant must be refused, naming the font's path); an app
// download that needs anything outside its folder, a home or the network (the test's own sandboxed run).
import { spawn } from 'node:child_process';
import { closeSync, copyFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { seatbelt, type Grant } from '../../../packages/supervisor/src/index.ts';
import {
  APP, FILM, MIN, PNG_SIGNATURE, REPO, RUNTIME, SCRIPT, STILL, appFile, cleanup, infoPlist, initRepo, named, notes, preflight, published, sha256File,
  shown, tag, tagged, tempDir, world, writeOut, zipApp, type Artifact, type Held, type Ran,
} from './helpers.ts';

// ---- Processes this file starts, each in a process group of its own, stopped by that group's PID.
const owned = new Set<number>();
const stop = (pid: number): void => {
  try { process.kill(-pid, 'SIGKILL'); } catch { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
};
afterAll(() => {
  for (const pid of owned) stop(pid);
  cleanup();
});
function long(command: string, args: readonly string[], o: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<Ran> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const pid = child.pid;
    if (pid) owned.add(pid);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { stdout = (stdout + d).slice(-60_000); });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { stderr = (stderr + d).slice(-60_000); });
    const timer = setTimeout(() => { if (pid) stop(pid); stderr += `\n[stopped at ${o.timeoutMs} ms]`; }, o.timeoutMs);
    child.on('error', (e) => { stderr += `\n[${e.message}]`; });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (pid) owned.delete(pid);
      resolve({ code, signal, stdout, stderr, text: `${stdout}\n${stderr}` });
    });
  });
}

// ---- The real app downloads, built once per commit (README, How to run).

const CACHE = join(REPO, 'target', 'da1495');
const blocked = (why: string): never => { throw Error(`BLOCKED: ${why}`); };
const BUILD_ENV: NodeJS.ProcessEnv = {
  ...process.env, PATH: `/opt/homebrew/opt/rustup/bin:${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`,
  CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0',
};
const lease = (args: readonly string[], timeoutMs: number): Promise<Ran> => long(join(REPO, 'scripts', 'lease'), args, { cwd: REPO, env: BUILD_ENV, timeoutMs });
const MACHO = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);
function magic(file: string): string {
  const fd = openSync(file, 'r');
  const head = Buffer.alloc(4);
  try { readSync(fd, head, 0, 4, 0); } finally { closeSync(fd); }
  return head.toString('hex');
}
/** What the manifest lists the app download holds (README, The contract 4): every binary, bundled font and pack file. */
function holdsOf(root: string): Held[] {
  const out: Held[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const rel = p.slice(root.length + 1);
        if (rel.includes('/runtime/packs/') || /\.(?:ttf|otf|ttc|woff2?)$/i.test(rel) || MACHO.has(magic(p))) out.push({ path: rel, sha256: sha256File(p) });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

interface Download { version: string; artifact: Artifact }
const downloads = new Map<string, Promise<Download>>();
/**
 * The app download of this checkout's HEAD, `plain` or `checkout-font` (the planted bundle), as the release makes it: the
 * release's archives from scripts/release-pack.mjs, the runtime folder from scripts/app-runtime.mjs, DeepBuild.app
 * holding it as Contents/Resources/runtime, zipped. Cached under target/da1495/<commit>/; a build that can't be made
 * is BLOCKED, naming it, never a pass.
 */
function download(kind: 'plain' | 'checkout-font'): Promise<Download> {
  let made = downloads.get(kind);
  if (!made) {
    made = (async () => {
      if (!existsSync(SCRIPT)) throw Error('scripts/release.mjs does not exist: there is no release to verify an app download, so nothing here was checked');
      if (process.platform !== 'darwin') blocked(`the app download and its sandbox (Seatbelt) are macOS's; this is ${process.platform}`);
      const head = await long('git', ['rev-parse', 'HEAD'], { cwd: REPO, env: process.env, timeoutMs: MIN });
      if (head.code !== 0) blocked(`git rev-parse HEAD in the checkout failed: ${shown(head)}`);
      const dir = join(CACHE, head.stdout.trim().slice(0, 12));
      const archives = join(dir, 'archives');
      if (!existsSync(join(archives, 'manifest.json'))) {
        rmSync(archives, { recursive: true, force: true });
        mkdirSync(archives, { recursive: true });
        const r = await lease([process.execPath, join(REPO, 'scripts', 'release-pack.mjs'), '--repo', REPO, '--commit', 'HEAD', '--out', archives], 180 * MIN);
        if (r.code !== 0 || !existsSync(join(archives, 'manifest.json'))) blocked(`the release's archives couldn't be made (commit your work first: the pack takes a clean tree): node scripts/release-pack.mjs --repo <checkout> --commit HEAD --out ${archives}: ${shown(r)}`);
      }
      const runtime = join(dir, kind === 'plain' ? 'runtime' : 'runtime-checkout-font');
      if (!existsSync(`${runtime}.done`)) {
        rmSync(runtime, { recursive: true, force: true });
        const args = [process.execPath, join(REPO, 'scripts', 'app-runtime.mjs'), '--archives', archives, '--out', runtime, ...(kind === 'plain' ? [] : ['--plant', 'checkout-font'])];
        const r = await lease(args, 180 * MIN);
        const said = `node scripts/app-runtime.mjs --archives ${archives} --out ${runtime}${kind === 'plain' ? '' : ' --plant checkout-font'}: ${shown(r)}`;
        if (r.code !== 0 || !existsSync(join(runtime, 'bin', 'deep'))) {
          // The plain runtime is the base's own script on the release's archives; the plant is new with this issue.
          if (kind === 'plain') blocked(`the app's runtime folder couldn't be laid out: ${said}`);
          throw Error(`the planted bundle couldn't be laid out: ${said}`);
        }
        writeFileSync(`${runtime}.done`, `${new Date().toISOString()}\n`);
      }
      const version = (JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8')) as { version: string }).version;
      const folder = join(dir, kind);
      const zip = join(folder, appFile(version));
      if (!existsSync(`${zip}.done`)) {
        rmSync(folder, { recursive: true, force: true });
        mkdirSync(join(folder, APP, 'Contents', 'Resources'), { recursive: true });
        writeFileSync(join(folder, APP, 'Contents', 'Info.plist'), infoPlist(version));
        cpSync(runtime, join(folder, RUNTIME), { recursive: true, verbatimSymlinks: true });
        zipApp(join(folder, APP), zip, BUILD_ENV);
        writeFileSync(`${zip}.done`, `${new Date().toISOString()}\n`);
      }
      return { version, artifact: { name: APP, file: appFile(version), path: zip, sha256: sha256File(zip), holds: holdsOf(folder) } };
    })();
    downloads.set(kind, made);
  }
  return made;
}

/** A zip extracted into a fresh folder, as the release extracts it; the folder. */
async function extracted(zip: string): Promise<string> {
  const x = tempDir('dr1495x-');
  const r = await long('/usr/bin/ditto', ['-x', '-k', zip, x], { cwd: x, env: process.env, timeoutMs: 30 * MIN });
  expect(r.code, `ditto -x -k ${zip}: ${shown(r)}`).toBe(0);
  return x;
}
/** A fresh HOME holding the fixture film, and a TMPDIR inside it. */
function freshHome(): string {
  const h = tempDir('dr1495h-');
  mkdirSync(join(h, 'tmp'));
  copyFileSync(FILM, join(h, 'film.json'));
  return h;
}
const homeEnv = (h: string): Record<string, string> => ({ HOME: h, TMPDIR: join(h, 'tmp'), PATH: '/usr/bin:/bin' });
/** argv under the platform sandbox: reads of `x` and `h`, writes to `h`, no host. */
async function confined(argv: string[], x: string, h: string): Promise<Ran> {
  const grant: Grant = { read: [x, h], write: [h] };
  const launch = await seatbelt.confine({ argv, cwd: h, env: homeEnv(h) }, grant, 'run:1495');
  return long(launch.argv[0]!, launch.argv.slice(1), { cwd: launch.cwd, env: launch.env, timeoutMs: 15 * MIN });
}
const isPng = (file: string): boolean => existsSync(file) && readFileSync(file).subarray(0, 8).equals(PNG_SIGNATURE);
const exportArgs = (h: string): string[] => ['export', '--document', join(h, 'film.json'), '--still', STILL, '--out', join(h, 'still.png')];

/** A fixture release at the app download's version whose signed manifest lists `artifact`; its tag run. */
async function cut(d: Download): Promise<{ run: Ran; published: string[]; tagged: string | null; commit: string }> {
  const w = world();
  const commit = initRepo(w, d.version);
  writeOut(w, commit, [d.artifact]);
  const report = preflight(w, commit);
  const n = notes(w, commit, report);
  expect(n.code, `release.mjs notes exits 0:\n${shown(n)}`).toBe(0);
  const run = tag(w, commit, report, { timeoutMs: 90 * MIN });
  return { run, published: published(w), tagged: tagged(w, d.version), commit };
}

const HOURS = 6 * 60 * MIN;
/** A path to a font file under the checkout's bundled fonts, as a refusal names it. */
const FONTS = new RegExp(`${REPO.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/crates/deep-text/fonts/[^\\s'"\`),;:]+?\\.(?:ttf|otf|ttc|woff2?)`, 'i');

describe(`${named(7)} From the extracted app download, under the sandbox, deep --version prints the release's version and the fixture film's still exports`, () => {
  it(`${named(7)} the release's check passes the real app download: it is verified, published and tagged`, async () => {
    const d = await download('plain');
    const c = await cut(d);
    expect(c.run.code, `the release verifies the app download of this checkout:\n${shown(c.run)}`).toBe(0);
    expect(c.published).toEqual([d.artifact.file]);
    expect(c.tagged).toBe(c.commit);
  }, HOURS);

  it(`${named(7)} from its extracted copy, with reads outside it and a fresh HOME refused and no network, deep --version prints the version and the still exports`, async () => {
    const d = await download('plain');
    const x = await extracted(d.artifact.path);
    const h = freshHome();
    const deep = join(x, RUNTIME, 'bin', 'deep');

    // The sandbox holds: a read outside the two folders is refused, and no connection leaves it. Neither control is
    // vacuous: unconfined, the same read and the same connection succeed.
    const readme = join(REPO, 'README.md');
    const outside = await confined(['/bin/cat', readme], x, h);
    expect(outside.code, `a read of the checkout is refused under the grant:\n${shown(outside)}`).not.toBe(0);
    const free = await long('/bin/cat', [readme], { cwd: h, env: homeEnv(h), timeoutMs: MIN });
    expect(free.code, `unconfined, the same read succeeds:\n${shown(free)}`).toBe(0);
    let connections = 0;
    const listener = createServer((sock) => { connections += 1; sock.destroy(); });
    await new Promise<void>((done) => listener.listen(0, '127.0.0.1', done));
    const nc = ['-z', '-w', '3', '127.0.0.1', String((listener.address() as { port: number }).port)];
    const offline = await confined(['/usr/bin/nc', ...nc], x, h);
    const blockedConnections = connections;
    const online = await long('/usr/bin/nc', nc, { cwd: h, env: homeEnv(h), timeoutMs: MIN });
    await new Promise<void>((done) => listener.close(() => done()));
    expect([offline.code === 0, blockedConnections], `no connection leaves the sandbox:\n${shown(offline)}`).toEqual([false, 0]);
    expect([online.code, connections], `unconfined, the same connection is made:\n${shown(online)}`).toEqual([0, 1]);

    const version = await confined([deep, '--version'], x, h);
    expect(version.code, shown(version)).toBe(0);
    expect(version.stdout.trim(), 'deep --version prints the release\'s version').toBe(d.version);
    const still = await confined([deep, ...exportArgs(h)], x, h);
    expect(still.code, `the fixture film's still exports:\n${shown(still)}`).toBe(0);
    expect(isPng(join(h, 'still.png')), 'the still is a PNG').toBe(true);
  }, HOURS);

  it(`${named(7)} (wrong program) the checkout-font bundle exports outside the sandbox, and the release refuses it, naming the font's path in the checkout`, async () => {
    const d = await download('checkout-font');
    // It is the wrong program it says: unconfined, it draws the still, reading its font from the checkout.
    const x = await extracted(d.artifact.path);
    const h = freshHome();
    const free = await long(join(x, RUNTIME, 'bin', 'deep'), exportArgs(h), { cwd: h, env: homeEnv(h), timeoutMs: 15 * MIN });
    expect(free.code, `outside the sandbox the planted bundle exports the still:\n${shown(free)}`).toBe(0);
    expect(isPng(join(h, 'still.png'))).toBe(true);

    const c = await cut(d);
    expect(c.run.code, `the release's check refuses the planted bundle:\n${shown(c.run)}`).not.toBe(0);
    const path = FONTS.exec(c.run.text)?.[0];
    expect(path, `the refusal names the font's path under ${REPO}/crates/deep-text/fonts/:\n${shown(c.run)}`).toBeDefined();
    expect(existsSync(path!), `${path} is a font the checkout has: the read was refused, not missing`).toBe(true);
    expect(c.published, 'the planted bundle is not published').toEqual([]);
    expect(c.tagged, 'nothing is tagged').toBeNull();
  }, HOURS);
});

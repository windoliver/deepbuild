// AC21 #41.7e835721 "A planted package whose deep-hook binary differs from the built tree by one byte, or has lost its
// exec bit, fails, naming the file and the package; a planted unsigned dylib inside the per-platform package fails the
// codesign step, naming the file". Issue scope: "Every file under each package's runtime folder is byte-identical to the
// built tree's, with its exec bits. On macOS every Mach-O npm extracts passes `codesign --verify --strict` and names the
// release's Developer ID."
//
// Not proven here: "names the release's Developer ID". This machine holds no Developer ID, so no test can make a Mach-O
// signed by one, and so none shows a correctly signed dylib passing (the twin of the unsigned plant). The plant below
// proves the codesign step runs `codesign --verify --strict` on each Mach-O in the package as npm extracts it, by
// asserting codesign's own diagnostic for unsigned code; the Developer ID half needs the release's identity.
//
// Surface assumed (the issue and design name no command line, so this is the one the tests pin):
//   node scripts/release-verify.mjs --archive <package.tgz> --built <dir>
//   - <package.tgz>: one per-platform deep-hook package's archive, as `npm pack` makes it. Its runtime folder is `bin/`:
//     deep-hook at `bin/deep-hook`, and any dylib it loads beside it.
//   - <dir>: the built tree for that folder: `bin/<rel>` in the package corresponds to `<dir>/<rel>`.
//   - Each regular file under the archive's `bin/`, read as npm extracts it, must exist in <dir> with the same bytes and
//     the same owner exec bit. On macOS each Mach-O among them must pass `codesign --verify --strict`.
//   - Exit 0 when nothing fails. Otherwise non-zero, and each failure names the package (its package.json `name`) and the
//     file as `bin/<rel>`; a codesign failure carries codesign's own message.
// The byte and exec-bit plants use a linux-x64 package whose deep-hook is not a Mach-O, so no signing rule reaches it
// on any host; the dylib plant is a darwin-arm64 package and runs on macOS only (elsewhere it reports BLOCKED).

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AC21, cleanup, type Files, NODE, npmPack, put, run, script, scrubbedEnv, shown, tempDir } from './helpers.js';

afterAll(cleanup, 120_000);
const VERIFY = script('release-verify.mjs');
const LINUX = '@deepbuild/deep-hook-linux-x64';
const DARWIN = '@deepbuild/deep-hook-darwin-arm64';
const json = (o: object) => `${JSON.stringify(o, null, 2)}\n`;

/** 64 KiB of fixed bytes standing in for a built deep-hook. */
const BUILT = (() => {
  const out = Buffer.alloc(65536);
  let x = 0x41;
  for (let i = 0; i < out.length; i += 1) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = x >>> 16 & 0xff; }
  return out;
})();

/** A built tree holding `built`, and the package archive made from `packed`; both under one temp folder. */
function plant(name: string, built: Files, packed: Files): { archive: string; built: string } {
  const dir = tempDir('dh41v-');
  put(join(dir, 'built'), built);
  const [os, cpu] = name.replace('@deepbuild/deep-hook-', '').split('-');
  put(join(dir, 'pkg'), { 'package.json': json({ name, version: '0.41.0', os: [os], cpu: [cpu], files: ['bin'] }), ...packed });
  const file = npmPack(join(dir, 'pkg'), join(dir, 'out'));
  return { archive: join(dir, 'out', file), built: join(dir, 'built') };
}
async function verify(p: { archive: string; built: string }) {
  const r = await run(NODE, [VERIFY, '--archive', p.archive, '--built', p.built], { cwd: tempDir('dh41vc-'), env: scrubbedEnv(), timeoutMs: 600_000 });
  return { r, text: `${r.stdout}\n${r.stderr}` };
}
const exec = (body: Buffer) => ({ body, mode: 0o755 });

describe(`${AC21} Each per-platform package's runtime files are the built tree's, byte for byte and with their exec bits`, () => {
  it(`${AC21} a package whose bin/deep-hook is the built tree's, exec bit kept, passes, so the failures below come from the plant`, async () => {
    const { r, text } = await verify(plant(LINUX, { 'deep-hook': exec(BUILT) }, { 'bin/deep-hook': exec(BUILT) }));
    expect(r.code, `an identical package must pass:\n${text}`).toBe(0);
  }, 900_000);

  it(`${AC21} a planted package whose deep-hook differs from the built tree by one byte fails, naming the file and the package`, async () => {
    const changed = Buffer.from(BUILT);
    changed[40000] = changed[40000]! ^ 0x01;
    const { r, text } = await verify(plant(LINUX, { 'deep-hook': exec(BUILT) }, { 'bin/deep-hook': exec(changed) }));
    expect(r.code, `one changed byte must fail:\n${shown(r)}`).not.toBe(0);
    expect(r.code, shown(r)).not.toBeNull();
    expect(text, 'the failure names the file').toContain('bin/deep-hook');
    expect(text, 'the failure names the package').toContain(LINUX);
  }, 900_000);

  it(`${AC21} a planted package whose deep-hook lost its exec bit fails, naming the file and the package`, async () => {
    const { r, text } = await verify(plant(LINUX, { 'deep-hook': exec(BUILT) }, { 'bin/deep-hook': { body: BUILT, mode: 0o644 } }));
    expect(r.code, `a lost exec bit must fail:\n${shown(r)}`).not.toBe(0);
    expect(r.code, shown(r)).not.toBeNull();
    expect(text, 'the failure names the file').toContain('bin/deep-hook');
    expect(text, 'the failure names the package').toContain(LINUX);
  }, 900_000);

  it(`${AC21} a planted unsigned dylib inside the per-platform package fails the codesign step, naming the file`, async () => {
    if (process.platform !== 'darwin') throw Error(`BLOCKED: codesign runs on macOS only; this is ${process.platform}`);
    const dir = tempDir('dh41d-');
    const src = join(dir, 'plant.c');
    put(dir, { 'plant.c': 'int deep_plant(void) { return 41; }\n' });
    const cc = spawnSync('/usr/bin/cc', ['-dynamiclib', '-o', join(dir, 'libdeepplant.dylib'), src], { encoding: 'utf8' });
    if (cc.status !== 0) throw Error(`BLOCKED: no C compiler to make the planted dylib (/usr/bin/cc: ${cc.stderr || cc.error?.message})`);
    const strip = spawnSync('codesign', ['--remove-signature', join(dir, 'libdeepplant.dylib')], { encoding: 'utf8' });
    if (strip.status !== 0) throw Error(`BLOCKED: codesign --remove-signature failed: ${strip.stderr}`);
    const check = spawnSync('codesign', ['--verify', '--strict', join(dir, 'libdeepplant.dylib')], { encoding: 'utf8' });
    expect(check.status, 'the planted dylib is unsigned, as codesign itself says').not.toBe(0);
    const dylib = readFileSync(join(dir, 'libdeepplant.dylib'));
    const hook = Buffer.from('#!/bin/sh\nexit 0\n');
    // The dylib is the built tree's too, byte for byte, so only the codesign step can fail it.
    const { r, text } = await verify(plant(DARWIN,
      { 'deep-hook': exec(hook), 'libdeepplant.dylib': exec(dylib) },
      { 'bin/deep-hook': exec(hook), 'bin/libdeepplant.dylib': exec(dylib) }));
    expect(r.code, `an unsigned dylib must fail:\n${shown(r)}`).not.toBe(0);
    expect(r.code, shown(r)).not.toBeNull();
    expect(text, 'the failure names the file').toContain('bin/libdeepplant.dylib');
    expect(text, 'the failure names the package').toContain(DARWIN);
    expect(text, 'the failure is codesign --verify --strict\'s own, run on the file').toMatch(/not signed at all/);
  }, 900_000);
});

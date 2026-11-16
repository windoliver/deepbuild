// #12 AC8: the README quick start works on a clean machine with Node 24.22+ and Rust: `npm run build` builds the
// TypeScript packages and `crates/deep-hook`, and `npm link` puts `deep` on the PATH.
//
// On a clean checkout of this one, with a HOME of its own: README.md's quick start commands `npm install`,
// `npm run build` and `npm link`, run as written by the real npm and Node, with npm's prefix in the box so the link
// lands there, and that prefix's bin first on PATH. cargo is the real one through rustup, except that the workspace
// build is narrowed to deep-hook (README.md, The quick start, says why and what that still sees).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { AC8, MINUTE, ROOT, boxEnv, cleanCheckout, makeBox, needNode, realCargo, realNpm, removeBoxes, run, shown, writePassThroughCargo } from './helpers.ts';

afterAll(removeBoxes, 10 * MINUTE);

/** The README's quick start: the shell block that runs `npm run build`, one command a line. */
function quickStart(): string[] {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const blocks = [...readme.matchAll(/```(?:sh|bash|shell|console)?\n([\s\S]*?)```/g)].map(([, body]) => body!.split('\n').map((line) => line.replace(/^\$\s*/, '').trim()).filter(Boolean));
  return blocks.find((lines) => lines.includes('npm run build')) ?? [];
}

it(`${AC8} the README quick start works on a clean checkout with Node 24.22+ and Rust: npm run build builds the TypeScript packages and crates/deep-hook, and npm link puts deep on the PATH`, () => {
  needNode(AC8);
  const cargo = realCargo(AC8);
  const steps = quickStart();
  const order = ['npm install', 'npm run build', 'npm link'].map((command) => steps.indexOf(command));
  expect(order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1]!)), `${AC8} README.md's quick start runs npm install, npm run build and npm link, in that order: ${JSON.stringify(steps)}`).toBe(true);

  const box = makeBox('ac8');
  writePassThroughCargo(box, cargo);
  const clean = join(box.dir, 'clean');
  cleanCheckout(clean);
  const prefix = join(box.dir, 'prefix');
  // A machine with Rust: rustup's proxies (rustc among them) on PATH, behind the pass-through cargo.
  const env = boxEnv(box, {
    npm_config_prefer_offline: 'true',
    npm_config_prefix: prefix,
    PATH: [box.bin, dirname(cargo), dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter),
  });

  const install = run(realNpm(), ['install'], clean, env, 10 * MINUTE);
  expect(install.status, `${AC8} npm install exits 0 on a clean checkout: ${shown(install)}`).toBe(0);

  const build = run(realNpm(), ['run', 'build'], clean, env, 20 * MINUTE);
  expect(build.status, `${AC8} npm run build exits 0 on a clean checkout: ${shown(build)}`).toBe(0);
  // The TypeScript packages: each workspace package whose build emits has its dist/ now.
  const unbuilt = readdirSync(join(clean, 'packages')).filter((name) => {
    const folder = join(clean, 'packages', name);
    if (!existsSync(join(folder, 'package.json'))) return false;
    const manifest = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8')) as { scripts?: { build?: string } };
    if (!manifest.scripts?.build) return false;
    const config = join(folder, 'tsconfig.json');
    if (existsSync(config) && /"noEmit"\s*:\s*true/.test(readFileSync(config, 'utf8'))) return false;
    return !existsSync(join(folder, 'dist')) || readdirSync(join(folder, 'dist')).length === 0;
  });
  expect(unbuilt, `${AC8} npm run build builds every TypeScript package whose build emits: ${shown(build)}`).toEqual([]);
  // crates/deep-hook: a fresh build of its binary in the clean checkout's target/, which runs.
  const hook = join(clean, 'target/debug/deep-hook');
  expect(existsSync(hook), `${AC8} npm run build builds crates/deep-hook into target/debug/deep-hook: ${shown(build)}`).toBe(true);
  const version = run(hook, ['--version'], clean, env, MINUTE);
  expect(version.status, `${AC8} the built deep-hook runs: ${shown(version)}`).toBe(0);

  const link = run(realNpm(), ['link'], clean, env, 10 * MINUTE);
  expect(link.status, `${AC8} npm link exits 0: ${shown(link)}`).toBe(0);
  const path = [join(prefix, 'bin'), dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter);
  const found = run('/bin/sh', ['-c', 'command -v deep'], box.home, { ...env, PATH: path }, MINUTE);
  expect(found.status === 0 && found.out.trim().startsWith(join(prefix, 'bin')), `${AC8} npm link puts deep on the PATH, in the npm prefix's bin: ${shown(found)}; ${shown(link)}`).toBe(true);
  const help = run('/bin/sh', ['-c', 'deep --help'], box.home, { ...env, PATH: path }, 2 * MINUTE);
  expect(help.status, `${AC8} deep --help from the PATH runs and exits 0: ${shown(help)}`).toBe(0);
  expect(help.out, `${AC8} deep --help prints its usage: ${shown(help)}`).toMatch(/Usage: deep/);
}, 45 * MINUTE);

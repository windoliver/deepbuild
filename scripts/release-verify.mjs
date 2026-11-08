#!/usr/bin/env node
// The release's package check (#41): one per-platform package's runtime files against the built tree they came from.
//   node scripts/release-verify.mjs --archive <package.tgz> --built <dir>
// Every regular file under the archive's bin/, extracted as npm extracts it, must be <dir>/<the same path under bin/>,
// byte for byte, with the same owner exec bit; on macOS every Mach-O among them must pass `codesign --verify --strict`.
// Each failure names the package and the file (bin/<path>); a codesign failure carries codesign's own message.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const flag = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? undefined : process.argv[at + 1];
};
const [archiveArg, builtArg] = [flag('archive'), flag('built')];
if (!archiveArg || !builtArg) {
  console.error('usage: release-verify.mjs --archive <package.tgz> --built <dir>');
  process.exit(2);
}
const archive = resolve(archiveArg);
const built = resolve(builtArg);
// Mach-O's magic numbers, either byte order, thin or universal.
const MACHO = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca']);

const work = mkdtempSync(join(tmpdir(), 'release-verify-'));
const failures = [];
let name = archive;
try {
  const untar = spawnSync('tar', ['-xzf', archive, '-C', work], { encoding: 'utf8' });
  if (untar.status !== 0) throw Error(`${archive} can't be extracted: ${untar.stderr || untar.error}`);
  name = JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8')).name;
  const bin = join(work, 'package', 'bin');
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  if (existsSync(bin)) walk(bin);
  if (!files.length) failures.push(`${name}: the package has no file under bin/`);
  for (const file of files) {
    const rel = relative(bin, file);
    const shown = `bin/${rel}`;
    const twin = join(built, rel);
    if (!existsSync(twin)) {
      failures.push(`${name}: ${shown} is not in the built tree ${built}`);
      continue;
    }
    const bytes = readFileSync(file);
    if (!bytes.equals(readFileSync(twin))) failures.push(`${name}: ${shown} differs from the built ${twin}`);
    const exec = (path) => (statSync(path).mode & 0o100) !== 0;
    if (exec(file) !== exec(twin)) failures.push(`${name}: ${shown} ${exec(file) ? 'is' : 'is not'} executable, and the built ${twin} ${exec(twin) ? 'is' : 'is not'}`);
    if (process.platform === 'darwin' && bytes.length >= 4 && MACHO.has(bytes.subarray(0, 4).toString('hex'))) {
      const check = spawnSync('codesign', ['--verify', '--strict', file], { encoding: 'utf8' });
      if (check.status !== 0) failures.push(`${name}: ${shown} fails codesign --verify --strict: ${(check.stderr || String(check.error)).trim()}`);
    }
  }
} catch (error) {
  failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`release-verify: FAIL\n  ${failures.join('\n  ')}`);
  process.exit(1);
}
console.log(`release-verify: ${name} matches ${built}`);

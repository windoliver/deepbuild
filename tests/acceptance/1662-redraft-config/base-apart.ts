import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { BASE, REPO, redact } from '../1662/helpers.ts';

function configsAbove(dir: string): string[] {
  const cargoHome = resolve(process.env.CARGO_HOME ?? join(homedir(), '.cargo'));
  const found: string[] = [];
  let at = resolve(dir);
  for (;;) {
    const up = dirname(at);
    if (up === at) break;
    at = up;
    for (const name of ['config.toml', 'config']) {
      const file = join(at, '.cargo', name);
      if (existsSync(file) && join(at, '.cargo') !== cargoHome) found.push(file);
    }
  }
  return found;
}

export function baseManifestsApart(): string {
  const src = join(tmpdir(), 'deepbuild-acceptance-1662', BASE.slice(0, 12));
  const above = configsAbove(src);
  if (above.length) throw Error(`BLOCKED: cargo would merge ${redact(above.join(', '))} into the pinned workspace's own .cargo/config.toml`);
  if (existsSync(join(src, 'Cargo.lock'))) return src;
  rmSync(src, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  const tar = execFileSync('git', ['-C', REPO, 'archive', '--format=tar', BASE, 'Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', '.cargo', 'crates', 'vendor'], { maxBuffer: 512 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', src], { input: tar, maxBuffer: 512 * 1024 * 1024 });
  return src;
}

// #2874: a package's digest names the bytes git can carry, so a checkout's umask doesn't change it. Mode counts as
// git records it, executable or not; a group-writable copy (umask 002) digests as the 644 one it was pinned at.
import { chmodSync, cpSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { packageDigest } from '../src/index.js';
import { cleanup, temp } from './package.js';

afterAll(cleanup);

const R1 = fileURLToPath(new URL('../../../contracts/fixtures/R1', import.meta.url));
/** A copy of the repo's R1 fixture package with every file at `mode`. */
function r1At(mode: number): string {
  const folder = temp();
  cpSync(R1, folder, { recursive: true });
  for (const name of readdirSync(folder)) chmodSync(join(folder, name), mode);
  return folder;
}

describe('#2874 a package digest is the same under any umask', () => {
  it('the R1 fixture at 664, as a umask-002 checkout writes it, digests to the digest its manifest pins', () => {
    const pinned = JSON.parse(readFileSync(join(R1, 'deepbuild.json'), 'utf8')).digest;
    expect(packageDigest(r1At(0o664))).toBe(pinned);
    expect(packageDigest(r1At(0o644))).toBe(pinned);
  });

  it('a file made executable still changes the digest', () => {
    expect(packageDigest(r1At(0o755))).not.toBe(packageDigest(r1At(0o644)));
    expect(packageDigest(r1At(0o775))).toBe(packageDigest(r1At(0o755)));
  });
});

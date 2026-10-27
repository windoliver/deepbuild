// A package folder's digest (#348), computed by the parent: every file's relative path, mode and SHA-256, in
// path order, refusing symlinks. deepbuild.json counts as its manifest without the `digest` and `signature` fields
// (#351), so a build can write the digest, and a publisher the signature over it, without changing it.
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalize, type JsonValue } from '@deepbuild/contracts';

const sha256 = (bytes: Uint8Array | string): string => createHash('sha256').update(bytes).digest('hex');

function manifestBytes(path: string): Uint8Array {
  const bytes = readFileSync(path);
  let manifest: unknown;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    return bytes;
  }
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) return bytes;
  const { digest: _digest, signature: _signature, ...rest } = manifest as Record<string, JsonValue>;
  return canonicalize(rest);
}

export function packageDigest(folder: string): string {
  const lines: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const relative = `${prefix}${name}`;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw Error(`${relative} is a symbolic link; a package holds files only`);
      if (stat.isDirectory()) walk(path, `${relative}/`);
      else if (stat.isFile()) lines.push(`${(stat.mode & 0o7777).toString(8)} ${sha256(relative === 'deepbuild.json' ? manifestBytes(path) : readFileSync(path))} ${relative}`);
      else throw Error(`${relative} is neither a file nor a folder`);
    }
  };
  walk(folder, '');
  return `d1:${sha256(lines.join('\n'))}`;
}

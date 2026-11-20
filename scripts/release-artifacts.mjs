// A release's artifacts by their own bytes (#1495; technical design: Cutting a release). The signed manifest lists, for
// each artifact, its sha256 and what it holds: every binary, bundled font and first-party pack file, by path and
// sha256. Verifying one reads its bytes back, compares their sha256 with the manifest's entry for the release commit,
// extracts it into a fresh folder and checks every listed entry against the extracted copy; a version string or a
// file name never stands in for a digest.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs';
import { join, relative } from 'node:path';

export const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Mach-O (either byte order, thin or universal), ELF and WebAssembly: the programs and modules a release ships. */
const PROGRAMS = ['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', '7f454c46', '0061736d'];
const FONT = /\.(?:ttf|otf|ttc|woff2?)$/i;
/** A first-party pack's file: under a packs/ folder, in a folder named <name>-<major.minor.patch>. */
const PACK = /(?:^|\/)packs\/[a-z0-9][a-z0-9-]*-\d+\.\d+\.\d+\//;

function head(file) {
  const fd = openSync(file, 'r');
  const bytes = Buffer.alloc(4);
  try { return bytes.subarray(0, readSync(fd, bytes, 0, 4, 0)).toString('hex'); } finally { closeSync(fd); }
}

/** What a manifest lists of an extracted artifact: each binary, font and first-party pack file, by path and sha256. */
export function contentsOf(dir) {
  const entries = [];
  const walk = (at) => {
    for (const name of readdirSync(at).sort()) {
      const path = join(at, name);
      const st = lstatSync(path);
      if (st.isDirectory()) walk(path);
      else if (st.isFile()) {
        const rel = relative(dir, path);
        if (PACK.test(rel) || FONT.test(rel) || PROGRAMS.includes(head(path))) entries.push({ path: rel, sha256: sha256(path) });
      }
    }
  };
  walk(dir);
  return entries;
}

/** Extracts an artifact into `into`, a fresh folder: a .zip with ditto (or unzip), anything else with tar. */
export function extract(file, into) {
  mkdirSync(into, { recursive: true });
  const zip = file.endsWith('.zip');
  const r = zip && process.platform === 'darwin' ? spawnSync('ditto', ['-x', '-k', file, into], { encoding: 'utf8' })
    : zip ? spawnSync('unzip', ['-q', file, '-d', into], { encoding: 'utf8' })
      : spawnSync('tar', ['-xzf', file, '-C', into], { encoding: 'utf8' });
  if (r.status !== 0) throw Error(`${file} can't be extracted: ${(r.stderr || String(r.error)).trim()}`);
}

/**
 * Why the artifact at `file` isn't the one `entry` names, checked in its bytes and then in a fresh extraction under
 * `work`, or null when it is: the first missing or changed entry stops the check, naming the entry and the artifact.
 */
export function refusal(file, entry, work) {
  const got = sha256(file);
  if (got !== entry.sha256) return `${entry.file} is not the artifact the manifest names: its bytes hash to ${got}, and the manifest's entry is ${entry.sha256}`;
  const into = join(work, `${entry.file}.extracted`);
  try {
    extract(file, into);
  } catch (error) {
    return error.message;
  }
  for (const want of entry.holds ?? []) {
    let have;
    try { have = sha256(join(into, want.path)); } catch { return `${entry.file} holds no ${want.path}, an entry its manifest lists (${want.sha256})`; }
    if (have !== want.sha256) return `${entry.file}'s ${want.path} hashes to ${have}, and its manifest's entry is ${want.sha256}`;
  }
  return null;
}

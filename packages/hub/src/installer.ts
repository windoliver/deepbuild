// Installs and updates (#41): each version in a folder of its own under <home>/versions/, checked against a manifest
// signed with an offline key, unpacked, then switched in atomically through the `current` link, with the newest three
// versions kept for rollback. Nothing under <home> changes until the signature and the archive's sha256 both check.
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Where an injected failure stops the install: tests only. */
export type FailAt = 'after-unpack' | 'before-switch' | 'during-switch';
export interface Release { home: string; archive: Buffer; manifest: Buffer; signature: Buffer; publicKey: string | Buffer; failAt?: FailAt }

const KEEP = 3;
const NAME = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/;

/** Version names compared part by part, numbers as numbers: 1.10.0 is newer than 1.9.0. */
function newer(a: string, b: string): number {
  const [x, y] = [a, b].map((v) => v.split(/[.+-]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p)));
  for (let i = 0; i < Math.max(x!.length, y!.length); i++) {
    const [p, q] = [x![i], y![i]];
    if (p === q) continue;
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    return typeof p === 'number' && typeof q === 'number' ? p - q : String(p) < String(q) ? -1 : 1;
  }
  return 0;
}

/** The version `current` names, or none before the first install. */
function currentVersion(versions: string): string | null {
  try {
    return readlinkSync(join(versions, 'current')).split('/').filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

export async function installVersion({ home, archive, manifest, signature, publicKey, failAt }: Release): Promise<{ version: string }> {
  // The checks first, before anything under home is touched.
  const key = typeof publicKey === 'string' && !publicKey.includes('BEGIN') ? createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' }) : createPublicKey(publicKey);
  if (!verify(null, manifest, key, signature)) throw Error('refused: the manifest\'s signature does not check against the release key, so nothing was installed');
  let meta: { version?: unknown; sha256?: unknown };
  try {
    meta = JSON.parse(manifest.toString('utf8')) as typeof meta;
  } catch {
    throw Error('refused: the signed manifest is not JSON');
  }
  const version = typeof meta.version === 'string' && NAME.test(meta.version) && meta.version !== 'current' ? meta.version : null;
  if (!version) throw Error(`refused: the manifest names no version folder: ${JSON.stringify(meta.version)}`);
  const digest = createHash('sha256').update(archive).digest('hex');
  if (digest !== meta.sha256) throw Error(`refused: the download's sha256 ${digest} is not the manifest's ${String(meta.sha256)}, so nothing was installed`);

  const versions = join(home, 'versions');
  mkdirSync(versions, { recursive: true });
  const previous = currentVersion(versions);
  if (version === previous) throw Error(`${version} is already the current version`);
  const staging = join(versions, `.staging-${version}-${process.pid}`);
  const folder = join(versions, version);
  const link = join(versions, `.current-${process.pid}`);
  let placed = false;
  try {
    mkdirSync(staging);
    const untar = spawnSync('tar', ['-xzf', '-', '-C', staging], { input: archive, stdio: ['pipe', 'ignore', 'pipe'] });
    if (untar.status !== 0) throw Error(`the archive won't unpack: ${untar.stderr.toString().trim()}`);
    if (failAt === 'after-unpack') throw Error('injected failure after the unpack');
    rmSync(folder, { recursive: true, force: true });
    renameSync(staging, folder);
    placed = true;
    if (failAt === 'before-switch') throw Error('injected failure before the switch');
    // The switch is one rename of a new link over the old: `current` names the previous version or this one, never neither.
    symlinkSync(version, link);
    if (failAt === 'during-switch') throw Error('injected failure during the switch');
    renameSync(link, join(versions, 'current'));
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(link, { force: true });
    if (placed) rmSync(folder, { recursive: true, force: true });
    throw error;
  }
  // The newest three stay for rollback; current is always among them.
  const kept = readdirSync(versions).filter((name) => NAME.test(name) && name !== 'current').sort(newer).reverse();
  for (const name of kept.slice(KEEP)) if (name !== version) rmSync(join(versions, name), { recursive: true, force: true });
  if (existsSync(join(versions, 'current')) === false) throw Error('the current link is missing after the switch');
  return { version };
}

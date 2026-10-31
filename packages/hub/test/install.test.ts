// `deep install <folder>` (#351) shows the package's source and permissions first, then installs it through the hub
// once the OS confirms you: a cancelled prompt installs nothing, and the installer's refusal comes back named.
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '@deepbuild/contracts';
import { packageDigest } from '@deepbuild/extension-host';
import { withHub } from './hub.js';

const CLI = fileURLToPath(new URL('../../cli/dist/main.js', import.meta.url));

/** A package that registers nothing, its manifest asking for the record and declaring a conflict. */
function pkg(home: string, id: string, extra: Record<string, unknown> = {}): string {
  const from = join(home, id.replace('/', '-'));
  mkdirSync(from, { recursive: true });
  writeFileSync(join(from, 'index.ts'), 'export default function (_deep: unknown): void {}\n');
  const manifest = { id, version: '1.2.0', access: { words: ['record'] }, conflicts: ['acme/rival'], ...extra };
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify(manifest));
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify({ ...manifest, digest: packageDigest(from) }));
  return from;
}
/** The package signed by a new Ed25519 key, which its envelope names: the key, as `ed25519:<hex>`. */
function signed(from: string): string {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const key = `ed25519:${publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('hex')}`;
  const m = JSON.parse(readFileSync(join(from, 'deepbuild.json'), 'utf8')) as Record<string, unknown>;
  m.publisher_key = key;
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify(m));
  m.digest = packageDigest(from);
  m.signature = sign(null, canonicalize({ id: m.id, version: m.version, digest: m.digest, publisher_key: key } as never), privateKey).toString('hex');
  writeFileSync(join(from, 'deepbuild.json'), JSON.stringify(m));
  return key;
}
const install = (home: string, from: string, ...flags: string[]) => spawnSync(process.execPath, [CLI, 'install', ...flags, from], { env: { ...process.env, HOME: home }, encoding: 'utf8', timeout: 60_000 });
const installed = (root: string): string[] => {
  const file = join(root, 'extensions', 'installed.json');
  return existsSync(file) ? Object.keys(JSON.parse(readFileSync(file, 'utf8')) as object) : [];
};

/** The holders of the leases on record, in order: each load of the leasing package below adds one. */
function leaseHolders(root: string): string[] {
  const db = new DatabaseSync(join(root, 'ledger.db'), { readOnly: true });
  try {
    return (db.prepare("SELECT json_extract(data, '$.holder') AS h FROM events WHERE kind = 'lease.acquired' ORDER BY log_pos").all() as { h: string }[]).map((r) => r.h);
  } finally {
    db.close();
  }
}

describe('deep install', () => {
  it('a package it installs passes conformance and loads at once, and loads again at the next start, without a step of yours between', async () => {
    const confirm = join('/tmp', `deep-install-load-${process.pid}`);
    writeFileSync(confirm, 'confirmed');
    try {
      await withHub(async (root, home, hub) => {
        // Each time it loads, it leases a key of its own kind: the record shows every load.
        const from = pkg(home, 'acme/leaser', { conflicts: [], access: { words: [] }, leases: [{ name: 'acme.rig', match: 'exact', cap: 100, cooldown: 0, cost: 0 }], requires: { preview: ['deep.lease'] } });
        writeFileSync(join(from, 'index.ts'), "export default async function (deep: any): Promise<void> {\n  await deep.lease({ kind: 'acme.rig', key: `rig-${Date.now()}` }, 'exclusive').catch(() => undefined);\n}\n");
        const m = JSON.parse(readFileSync(join(from, 'deepbuild.json'), 'utf8')) as Record<string, unknown>;
        writeFileSync(join(from, 'deepbuild.json'), JSON.stringify({ ...m, digest: packageDigest(from) }));
        const done = install(home, from);
        expect(done.stdout).toContain('Installed acme/leaser@1.2.0');
        expect(done.status, done.stderr).toBe(0);
        expect(leaseHolders(root), 'it loaded once installed').toEqual(['ext:acme/leaser']);
        await hub.restart();
        for (const until = Date.now() + 5000; Date.now() < until && leaseHolders(root).length < 2; await new Promise((r) => setTimeout(r, 50)));
        expect(leaseHolders(root), 'it loaded again at the start').toEqual(['ext:acme/leaser', 'ext:acme/leaser']);
      }, { DEEP_HUB_TEST_CONFIRM: confirm });
    } finally {
      rmSync(confirm, { force: true });
    }
  }, 120_000);

  it('a package installed before its conformance was kept is checked at the next start, and loads', async () => {
    const confirm = join('/tmp', `deep-install-unchecked-${process.pid}`);
    writeFileSync(confirm, 'confirmed');
    try {
      await withHub(async (root, home, hub) => {
        const from = pkg(home, 'acme/leaser', { conflicts: [], access: { words: [] }, leases: [{ name: 'acme.rig', match: 'exact', cap: 100, cooldown: 0, cost: 0 }], requires: { preview: ['deep.lease'] } });
        writeFileSync(join(from, 'index.ts'), "export default async function (deep: any): Promise<void> {\n  await deep.lease({ kind: 'acme.rig', key: `rig-${Date.now()}` }, 'exclusive').catch(() => undefined);\n}\n");
        const m = JSON.parse(readFileSync(join(from, 'deepbuild.json'), 'utf8')) as Record<string, unknown>;
        writeFileSync(join(from, 'deepbuild.json'), JSON.stringify({ ...m, digest: packageDigest(from) }));
        const done = install(home, from);
        expect(done.status, done.stderr).toBe(0);
        expect(leaseHolders(root)).toEqual(['ext:acme/leaser']);
        // Installed by a hub that kept no conformance result: the next start has none for it.
        await hub.restart(undefined, () => rmSync(join(root, 'extensions', 'checked.json'), { force: true }));
        for (const until = Date.now() + 5000; Date.now() < until && leaseHolders(root).length < 2; await new Promise((r) => setTimeout(r, 50)));
        expect(leaseHolders(root), 'the start ran its conformance and loaded it').toEqual(['ext:acme/leaser', 'ext:acme/leaser']);
        const checked = join(root, 'extensions', 'checked.json');
        const kept = JSON.parse(readFileSync(checked, 'utf8')) as Record<string, { passed: boolean }>;
        expect(Object.entries(kept).map(([k, v]) => [k, v.passed]), 'the result is kept for the next start').toEqual([['acme/leaser@1.2.0', true]]);
        // Once: the next start loads from the kept result and runs no conformance, so the file isn't written again.
        const written = statSync(checked).mtimeMs;
        await hub.restart();
        for (const until = Date.now() + 5000; Date.now() < until && leaseHolders(root).length < 3; await new Promise((r) => setTimeout(r, 50)));
        expect([leaseHolders(root).length, statSync(checked).mtimeMs], 'loaded again from the result kept, not checked again').toEqual([3, written]);
      }, { DEEP_HUB_TEST_CONFIRM: confirm });
    } finally {
      rmSync(confirm, { force: true });
    }
  }, 120_000);

  it('a package that fails conformance is installed but not loaded, and the reason is shown', async () => {
    const confirm = join('/tmp', `deep-install-fails-${process.pid}`);
    writeFileSync(confirm, 'confirmed');
    try {
      await withHub(async (_root, home) => {
        const from = pkg(home, 'acme/broken', { conflicts: [] });
        writeFileSync(join(from, 'index.ts'), "export default function (deep: any): void {\n  deep.registerCheck('ext.broken.undeclared', () => null);\n}\n");
        const m = JSON.parse(readFileSync(join(from, 'deepbuild.json'), 'utf8')) as Record<string, unknown>;
        writeFileSync(join(from, 'deepbuild.json'), JSON.stringify({ ...m, digest: packageDigest(from) }));
        const done = install(home, from);
        expect(done.stdout).toContain('Installed acme/broken@1.2.0');
        expect(done.stderr).toMatch(/not loaded: .*ext\.broken\.undeclared/);
        expect(done.status).toBe(1);
      }, { DEEP_HUB_TEST_CONFIRM: confirm });
    } finally {
      rmSync(confirm, { force: true });
    }
  }, 120_000);

  it('shows the source and permissions, and installs nothing until the OS confirms you; then it installs, and a refusal is named', async () => {
    const confirm = join('/tmp', `deep-install-confirm-${process.pid}`);
    writeFileSync(confirm, 'cancelled');
    try {
      await withHub(async (root, home) => {
        const from = pkg(home, 'acme/notes');
        const cancelled = install(home, from);
        expect(cancelled.stdout).toContain(`Source: ${from}`);
        expect(cancelled.stdout).toContain(`acme/notes@1.2.0, digest ${packageDigest(from)}, unsigned`);
        expect(cancelled.stdout).toContain('access: record');
        expect(cancelled.stdout).toContain('conflicts with: acme/rival');
        expect(cancelled.status, cancelled.stderr).toBe(3);
        expect(installed(root)).toEqual([]);

        writeFileSync(confirm, 'confirmed');
        const confirmed = install(home, from);
        expect(confirmed.stdout).toContain(`Source: ${from}`);
        expect(confirmed.stdout).toContain('Installed acme/notes@1.2.0');
        expect(confirmed.status, confirmed.stderr).toBe(0);
        expect(installed(root)).toEqual(['acme/notes']);

        const rival = install(home, pkg(home, 'acme/rival', { conflicts: [] }));
        expect(rival.status, rival.stderr).toBe(1);
        expect(rival.stderr).toMatch(/^REFUSED: acme\/rival conflicts with acme\/notes/);
        expect(installed(root)).toEqual(['acme/notes']);
      }, { DEEP_HUB_TEST_CONFIRM: confirm });
    } finally {
      rmSync(confirm, { force: true });
    }
  }, 120_000);

  it('an update signed by another key is refused naming it; --trust-key trusts it once the OS confirms you, and it installs', async () => {
    const confirm = join('/tmp', `deep-install-key-${process.pid}`);
    writeFileSync(confirm, 'confirmed');
    try {
      await withHub(async (root, home) => {
        const first = pkg(home, 'acme/signed', { conflicts: [] });
        signed(first);
        expect(install(home, first).status, 'the first signed install trusts its key').toBe(0);
        const update = join(home, 'update');
        mkdirSync(update);
        writeFileSync(join(update, 'index.ts'), readFileSync(join(first, 'index.ts')));
        writeFileSync(join(update, 'deepbuild.json'), JSON.stringify({ id: 'acme/signed', version: '1.3.0', conflicts: [] }));
        const key = signed(update);
        const refused = install(home, update);
        expect(refused.status, refused.stderr).toBe(1);
        expect(refused.stderr).toContain(key);

        writeFileSync(confirm, 'cancelled');
        expect(install(home, update, '--trust-key').status, 'a cancelled prompt trusts nothing').toBe(3);
        writeFileSync(confirm, 'confirmed');
        expect(install(home, update).status, 'the key is still not trusted').toBe(1);
        const trusted = install(home, update, '--trust-key');
        expect(trusted.stdout).toContain(`signed by ${key}`);
        expect(trusted.status, trusted.stderr).toBe(0);
        expect(JSON.parse(readFileSync(join(root, 'extensions', 'installed.json'), 'utf8'))['acme/signed'].version).toBe('1.3.0');
      }, { DEEP_HUB_TEST_CONFIRM: confirm });
    } finally {
      rmSync(confirm, { force: true });
    }
  }, 120_000);
});

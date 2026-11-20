// Criterion 2: docs/extension-guide.md is regenerated: an entry for deep.registerPort under the digest the contract
// publishes, the file is what `node scripts/guide.mjs` writes, and `node scripts/guide.mjs --check` prints no line
// naming deep.registerPort.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { entryOf, GUIDE, METHOD, readApi, runGuideCheck, writeGuide } from './helpers.ts';

describe('#2790.92d7996b docs/extension-guide.md is regenerated, with an entry for deep.registerPort, and its drift test names it nowhere', () => {
  it('#2790.92d7996b the guide has an entry for deep.registerPort under the digest the contract publishes', () => {
    const published = readApi().find((e) => e.method === METHOD);
    expect(published, `the contract publishes ${METHOD}`).toBeDefined();
    expect(existsSync(GUIDE), `the guide is at ${GUIDE}`).toBe(true);
    const entry = entryOf(readFileSync(GUIDE, 'utf8'), METHOD);
    expect(entry, `docs/extension-guide.md has a ### \`${METHOD}\` entry`).not.toBeNull();
    const release = entry!.split('\n\n')[1] ?? '';
    expect(release, `the entry's release line carries the contract's digest ${published!.digest}`).toContain(`\`${published!.digest}\``);
  }, 120_000);

  it('#2790.92d7996b docs/extension-guide.md is what node scripts/guide.mjs writes', () => {
    const w = writeGuide();
    expect(w.status, `node scripts/guide.mjs writes the guide:\n${w.stdout}\n${w.stderr}`).toBe(0);
    expect(w.text, 'node scripts/guide.mjs wrote a guide').not.toBeNull();
    expect(readFileSync(GUIDE, 'utf8') === w.text, 'docs/extension-guide.md is byte for byte what node scripts/guide.mjs writes').toBe(true);
  }, 120_000);

  it('#2790.92d7996b node scripts/guide.mjs --check prints no line that names deep.registerPort', () => {
    const r = runGuideCheck();
    const naming = `${r.stdout}\n${r.stderr}`.split('\n').filter((line) => line.includes(METHOD));
    expect(naming, `node scripts/guide.mjs --check printed:\n${r.stdout}\n${r.stderr}`).toEqual([]);
  }, 300_000);
});

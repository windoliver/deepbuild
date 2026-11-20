// Test-side tools for the #2790 acceptance tests. Nothing here stands in for the guide's generator or its drift test:
// the tests reach them only through the surfaces the README names (`node scripts/guide.mjs`, `docs/extension-guide.md`,
// `packages/contracts/extension-api.json` and the #351 drift case). #351's helpers give the repo's paths, the contract,
// temp folders under /tmp/dh351-* (removed after each file) and `node scripts/guide.mjs --check`.
//
// What `node scripts/guide.mjs` writes is read from a run of the checkout's own script in a temp copy of the files it
// reads (the contract, its slots, the panel catalog and the guide's example folders), with the checkout's built
// extension host linked in for the examples' digests, so a test never rewrites the repo's guide.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import { API_FILE, GUIDE_SCRIPT, NODE, REPO, TABLE_FILE, readApi, tempDir } from '../351/helpers.ts';

export { GUIDE, readApi, runGuideCheck, tempDir, REPO, NODE } from '../351/helpers.ts';

export const METHOD = 'deep.registerPort';
const HOST_DIST = join(REPO, 'packages/extension-host/dist');

export interface Written { status: number | null; stdout: string; stderr: string; text: string | null }
/** `node scripts/guide.mjs`, the checkout's script, run in a temp copy of what it reads: its status, output and the guide it wrote. */
export function writeGuide(): Written {
  expect(existsSync(GUIDE_SCRIPT), `the guide's generator is ${GUIDE_SCRIPT}`).toBe(true);
  expect(existsSync(join(HOST_DIST, 'index.js')), `BLOCKED: scripts/guide.mjs stamps the examples' digests with ${HOST_DIST}/index.js; run npm run build --workspaces first`).toBe(true);
  const root = tempDir('guide-root');
  const copy = (from: string, to: string): void => {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    cpSync(from, join(root, to), { recursive: true });
  };
  copy(GUIDE_SCRIPT, 'scripts/guide.mjs');
  copy(API_FILE, 'packages/contracts/extension-api.json');
  copy(TABLE_FILE, 'packages/contracts/hub-slots.json');
  copy(join(REPO, 'crates/deep-app/panel-catalog.json'), 'crates/deep-app/panel-catalog.json');
  copy(join(REPO, 'docs/extension-guide'), 'docs/extension-guide');
  mkdirSync(join(root, 'packages/extension-host'), { recursive: true });
  symlinkSync(HOST_DIST, join(root, 'packages/extension-host/dist'));
  const r = spawnSync(NODE, [join(root, 'scripts/guide.mjs')], {
    cwd: root, encoding: 'utf8', timeout: 120_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', NO_COLOR: '1' },
  });
  const out = join(root, 'docs/extension-guide.md');
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', text: existsSync(out) ? readFileSync(out, 'utf8') : null };
}

/** A method's entry in a guide's text: from its `### \`<method>\`` heading to the next entry or section; null when it has none. */
export function entryOf(text: string, method: string): string | null {
  const section = text.split(/^(?=### `)/m).find((s) => s.startsWith(`### \`${method}\``));
  return section === undefined ? null : section.split(/\n\n## /)[0]!.trimEnd();
}

/** The entry `node scripts/guide.mjs` writes for deep.registerPort, asserting the script ran and wrote one. */
export function writtenPortEntry(): string {
  const w = writeGuide();
  expect(w.status, `node scripts/guide.mjs writes the guide:\n${w.stdout}\n${w.stderr}`).toBe(0);
  expect(w.text, 'node scripts/guide.mjs wrote docs/extension-guide.md').not.toBeNull();
  const entry = entryOf(w.text!, METHOD);
  expect(entry, `the guide scripts/guide.mjs writes has an entry for ${METHOD}`).not.toBeNull();
  return entry!;
}

/** What an entry says a method is for: its text below the heading and the release line, with spaces and quotes made plain. */
export function purpose(entry: string): string {
  const prose = entry.split('\n\n').slice(2).filter((block) => !block.startsWith('| Parameter'));
  return prose.join(' ').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
}

/** The fields of `port` the contract publishes for deep.registerPort. */
export function portFields(): string[] {
  const entry = readApi().find((e) => e.method === METHOD);
  expect(entry, `${API_FILE} publishes ${METHOD}`).toBeDefined();
  const port = (entry!.params as { properties?: Record<string, { properties?: Record<string, unknown> }> }).properties?.port;
  return Object.keys(port?.properties ?? {});
}

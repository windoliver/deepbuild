// Makes the reference PNGs of #398 AC6's four pattern pairs (REDRAFT-AC6.md, Redraft 2): the pinned headless Chrome's
// render of each resvg SVG, unchanged, at 300 × 300 over white. The PNGs are checked in under fixtures/chrome/ and
// elements-redraft.test.ts holds their sha256; this script is how they were made, and how a reviewer remakes them.
// They are renders of resvg's SVGs under fixtures/resvg/ (Apache-2.0 or MIT; fixtures/resvg/NOTICE).
//
//   node tests/acceptance/398/chrome-reference.mjs          # CHROME_BIN overrides the path below
//
// BLOCKED (exit 2, nothing written) when the binary is missing or isn't Chrome for Testing 156.0.8078.4.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHROME_VERSION = 'Google Chrome for Testing 156.0.8078.4';
const CHROME = process.env.CHROME_BIN
  ?? join(process.env.HOME ?? '', '.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux-arm64/chrome-headless-shell');
const FOLDER = 'paint-servers/pattern';
const NAMES = ['with-x-and-y', 'patternUnits=objectBoundingBox', 'patternContentUnits=objectBoundingBox', 'with-viewBox'];

const HERE = dirname(fileURLToPath(import.meta.url));
const blocked = (why) => { console.error(`BLOCKED: ${why}`); process.exit(2); };

if (!existsSync(CHROME)) blocked(`no headless Chrome at ${CHROME} (set CHROME_BIN to ${CHROME_VERSION})`);
const version = spawnSync(CHROME, ['--version'], { encoding: 'utf8' });
const got = `${version.stdout ?? ''}`.trim();
if (version.status !== 0 || got !== CHROME_VERSION) blocked(`${CHROME} answers ${JSON.stringify((got || `${version.stderr ?? ''}`).split('\n')[0])}, not ${CHROME_VERSION}`);

const out = join(HERE, 'fixtures', 'chrome', FOLDER);
mkdirSync(out, { recursive: true });
for (const name of NAMES) {
  const svg = join(HERE, 'fixtures', 'resvg', FOLDER, `${name}.svg`);
  const png = join(out, `${name}.png`);
  rmSync(png, { force: true });
  const profile = mkdtempSync(join(tmpdir(), 'deep-398-chrome-'));
  try {
    const r = spawnSync(CHROME, [
      '--headless', '--disable-gpu', '--force-color-profile=srgb', '--force-device-scale-factor=1', '--hide-scrollbars',
      '--default-background-color=ffffffff', '--window-size=300,300', `--screenshot=${png}`, `--user-data-dir=${profile}`,
      pathToFileURL(svg).href,
    ], { encoding: 'utf8', timeout: 60_000 });
    if (r.status !== 0 || !existsSync(png)) blocked(`${CHROME} drew no ${name}.png: ${r.stderr}`);
  } finally { rmSync(profile, { recursive: true, force: true }); }
  console.log(`${createHash('sha256').update(readFileSync(png)).digest('hex')}  ${FOLDER}/${name}.png`);
}

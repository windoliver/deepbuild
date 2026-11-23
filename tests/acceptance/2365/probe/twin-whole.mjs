// AC1's planted archive, "an archive that reads the file whole": the archive under test, except that each pass first
// reads every Claude Code transcript under HOME whole, as one buffer and one string, and holds them until the pass
// ends. Loaded by pass.mjs with --archive in place of packages/archive/dist/index.js.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REAL = pathToFileURL(join(fileURLToPath(new URL('../../../../', import.meta.url)), 'packages/archive/dist/index.js')).href;

function whole(home) {
  const held = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) { const bytes = readFileSync(p); held.push(bytes, bytes.toString('utf8')); }
    }
  };
  walk(join(home, '.claude', 'projects'));
  return held;
}

export async function openArchive(options) {
  const archive = await (await import(REAL)).openArchive(options);
  return {
    async pass() { const held = whole(options.env.HOME); await archive.pass(); return void held.length; },
    async session(id) { const held = whole(options.env.HOME); await archive.session(id); return void held.length; },
    archived: () => archive.archived(),
  };
}

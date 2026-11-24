// Times the foley pack's check alone, in a new canvas core each time.
import { mkdtempSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
const repo = process.argv[2], tmp = process.argv[3];
const { Canvas, checkPacks } = await import(join(repo, 'packages/hub/dist/canvas.js'));
const { readPack, Packs } = await import(join(repo, 'packages/hub/dist/packs.js'));
const store = new Packs(mkdtempSync(join(tmp, 'pf-')));
const pack = readPack(join(repo, 'packs/foley-1.0.0'), true);
const dir = store.stage(pack);
for (let i = 0; i < 3; i++) { const c = new Canvas(mkdtempSync(join(tmp, 'pf-'))); const t = Date.now(); const r = await checkPacks(c, [{ id: pack.id, dir }]); console.log(`foley alone\t${Date.now() - t} ms\t${r[0].state}\tload ${loadavg()[0].toFixed(0)}`); c.close(); }

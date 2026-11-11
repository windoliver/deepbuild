import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, expect, it } from 'vitest';
import { CLI, NODE, yes } from '../../../tests/acceptance/1731/helpers.ts';
import { RED } from '../../../tests/acceptance/1820/export-redraft/png.ts';
import { addAsset, asks, CC0, fetchAfterYes, installOrBlock, LICENSE_TEXT, pictureDoc, scopedWorld, writePack, type Scoped } from '../../../tests/acceptance/1820/export-redraft/world.ts';
import { sha } from '../../../tests/acceptance/1820/scope/world.ts';
let w: Scoped;
const body = RED(8);
beforeAll(async () => {
  w = await scopedWorld();
  const a = { path: 'image.png', body, license: CC0, licenseText: LICENSE_TEXT.cc0 };
  addAsset(w.srv, 'fixture/export', '1.0.0', a, 'license');
  await installOrBlock(w, writePack(join(w.tmp, 'pack'), w.srv, 'fixture/export', '1.0.0', [{ a, tag: 'license' }]));
  expect((await fetchAfterYes(w, 'fixture/export@1.0.0', a.path, (ask) => yes(w, ask))).value.status).toBe('fetched');
}, 600_000);
it('#1820 a pack export reports an unwritable output as one CLI error, not an uncaught stack', async () => {
  const file = join(w.tmp, 'document.json');
  writeFileSync(file, JSON.stringify(pictureDoc('fixture/export@1.0.0', sha(body))));
  const before = (await asks(w)).length;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(DEEP_|XDG_|CLAUDE|CODEX|ANTHROPIC_|OPENAI_|GH_|GITHUB_|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)/.test(k)));
  const result = await new Promise<{ code: number | null; err: string }>((resolve, reject) => {
    const child = spawn(NODE, [CLI, 'export', '--document', file, '--still', '0', '--out', join(w.tmp, 'absent', 'still.png')], { cwd: w.work, env: { ...env, HOME: w.home }, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.setEncoding('utf8').on('data', (s: string) => { err += s; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, err }));
  });
  expect(result.code).toBe(1);
  expect(result.err).toMatch(/^deep export: .*ENOENT/m);
  expect(result.err).not.toMatch(/\n\s+at /);
  expect((await asks(w)).length).toBe(before);
  expect(readFileSync(file, 'utf8')).toContain('fixture/export@1.0.0');
}, 600_000);

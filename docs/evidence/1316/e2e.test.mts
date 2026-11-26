// Hand e2e for #1316: SheenChair and DispersionTest in the blind suite's scene (environment-lit sky@1 and a sun,
// 1280 x 800, frame 0), each drawn by 3 fresh `deep-gpu run` processes on the default path and 3 under
// `--planted environment_texture_race`. Writes each sample's default final frame here as <sample>.png.
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { khronos, requireReferenceMac, sameEveryRun, useGpu, type SampleName } from '../../../tests/acceptance/1316/helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const bin = useGpu();

it('#1316 e2e: the default path is byte-identical across fresh processes; the planted race is not', async () => {
  console.log(`machine: ${requireReferenceMac()}`);
  for (const name of ['SheenChair', 'DispersionTest'] as SampleName[]) {
    const out = mkdtempSync(join(tmpdir(), 'deep-1316-e2e-'));
    try {
      const f = await khronos(name, out);
      const held = new Set(readdirSync(out));
      const same = sameEveryRun(bin(), out, f, 3);
      const finals = readdirSync(out).filter((p) => p.endsWith('.png') && !held.has(p));
      console.log(`${name} default: ${same ?? 'byte-identical'}; final frames: ${finals.join(', ')}`);
      copyFileSync(join(out, finals[0]!), join(HERE, `${name}.png`));
      const planted = sameEveryRun(bin(), out, f, 3, 'environment_texture_race');
      console.log(`${name} planted: ${planted ?? 'byte-identical'}`);
      expect(same, `${name} default path`).toBeNull();
      expect(planted, `${name} planted race`).not.toBeNull();
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
}, 1_800_000);

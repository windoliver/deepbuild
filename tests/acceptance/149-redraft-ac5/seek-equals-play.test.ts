// AC5 #149.75d75ba2: seeking to any time equals playing to it by pixel hash for every field, and no field reseeds with
// playback. Each family of fixtures.ts, in 2D through `film2d` and in 3D through `view3d`.

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it, vi } from 'vitest';
import { answered, arr, none, obj, requireMetal, runGpu, str, useDir, useGpu, type JsonObject } from '../430/helpers.ts';
import { drawn, FAMILIES, FPS, framing, SIZE, type Dim, type Family } from './fixtures.ts';
import { judge, type Draw } from './holds.ts';

vi.setConfig({ testTimeout: 3_600_000, hookTimeout: 3_600_000 });

const AC5 = 'AC5 #149.75d75ba2';
const gpu = useGpu();
const dir = useDir();

const drawing = (fam: Family, dim: Dim): Draw => ({ from = 0, frames, fps = FPS }, plain = false) => {
  const { doc, look } = drawn(fam, dim, plain);
  const what = `${String(doc['id'])}, ${frames} frames from ${from} at ${fps} fps`;
  let call: JsonObject = { call: 'film2d', doc, look, fps, from, frames, hash: true };
  if (dim === '3d') {
    const path = join(dir(), `${String(doc['id'])}.json`);
    writeFileSync(path, JSON.stringify(doc));
    call = { call: 'view3d', doc: path, look, size: [...SIZE], fps, from, frames, capture: 'every', targets: ['final'] };
  }
  const reply = answered(runGpu(gpu(), dir(), [call])[0]!, what);
  const rows = arr(reply['frames'], `${what}: frames`).map((r) => str(obj(r, `${what}: a row`)['pixel_hash'], `${what}: a row's pixel_hash`));
  if (rows.length !== frames) throw Error(`${what}: ${rows.length} rows`);
  return rows;
};

function holds(dim: Dim): void {
  requireMetal();
  const failures = FAMILIES.flatMap((fam) => {
    const name = `${fam.name} in ${dim}`;
    const framed = framing(fam);
    if (framed.length > 0) return framed;
    try { return judge(name, drawing(fam, dim)); } catch (e) { return [`${name}: ${String(e).slice(0, 900)}`]; }
  });
  none(failures, `${AC5} in ${dim}`);
}

it(`${AC5}: every field family in a 2D drawing look`, () => holds('2d'));
it(`${AC5}: every field family in a 3D drawing look`, () => holds('3d'));

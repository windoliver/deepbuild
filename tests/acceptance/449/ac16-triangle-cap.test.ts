// AC16: "A mesh of 1,048,577 triangles named as a surface is refused at check, naming the item and the count"
//
// A still `fixture.skin@1` sheet `heavy` of 1,048,577 triangles (a 1,024 × 512 grid of quads, 1,048,576 triangles,
// and one more off to its side), whose surface the particles item `grit` names (`emit.shape: {surface: {of: "heavy"}}`).
// The `particles` call is asked for the check alone (no times): it must refuse the document with an error issue whose
// `ids` hold heavy and grit, at items/grit/params/emit/shape/surface/of, whose `actual` names the count, 1,048,577
// triangles (README: Criteria 12 to 16). The criterion names no planted program.

import { describe, expect, it } from 'vitest';
import {
  STILL, SPARK_LOOK, TIMEOUT, acSurface, camera, checkOf, isObject, particlesCall, particlesItem, refusalsNaming, runGpu, sessionDoc,
  show, skinItem, stillSkin, useBins, useDir, writeJson, type JsonObject, type Mesh, type Tri, type V3,
} from './helpers.ts';

const bins = useBins(['deep-gpu']);
const dir = useDir();
const TRIANGLES = 1_048_577;

/** A flat grid of `across` × `deep` unit quads in x and z, two triangles a quad, and one triangle above it. */
function sheet(across: number, deep: number): Mesh {
  const positions: V3[] = [];
  for (let i = 0; i <= across; i++) for (let j = 0; j <= deep; j++) positions.push([i, 0, j]);
  const at = (i: number, j: number): number => i * (deep + 1) + j;
  const triangles: Tri[] = [];
  for (let i = 0; i < across; i++) {
    for (let j = 0; j < deep; j++) triangles.push([at(i, j), at(i, j + 1), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i + 1, j)]);
  }
  const base = positions.length;
  positions.push([-2, 1, 0], [-2, 1, 1], [-1, 1, 0]);
  triangles.push([base, base + 1, base + 2]);
  return { positions, triangles };
}

function heavyDoc(): JsonObject {
  const mesh = sheet(1024, 512);
  expect(mesh.triangles.length, 'the sheet holds 1,048,577 triangles').toBe(TRIANGLES);
  return sessionDoc('Heavy surface', {
    cam: camera([512, 300, 900], [512, 0, 256], 50),
    heavy: skinItem(stillSkin(mesh), 'floor'),
    grit: particlesItem({
      count: 64, emit: { shape: { surface: { of: 'heavy' } }, bursts: [{ t: '0s', count: 64 }] }, life: [1, 1], motion: STILL,
      draw: 'dot', ...SPARK_LOOK,
    }),
  }, { transport: { span: '1s' } });
}

describe(`${acSurface(16)} a mesh past 1,048,576 triangles named as a surface is refused at check`, () => {
  it(`${acSurface(16)} a mesh of 1,048,577 triangles named as a surface is refused at check, naming the item and the count`, () => {
    const call = particlesCall({ doc: writeJson(dir(), 'heavy.json', heavyDoc()) });
    const [reply] = runGpu(bins.bin('deep-gpu'), dir(), [call], { backend: 'noop' });
    const c = checkOf(reply!, call, 'the heavy surface');
    expect(c.outcome, `a surface of 1,048,577 triangles is refused at check: ${show(c.raw)}`).toBe('refused');
    const named = refusalsNaming(c, 'heavy');
    const right = named.find((i) => i.ids.includes('grit') && i.path === 'items/grit/params/emit/shape/surface/of' && isObject(i.actual) && i.actual['triangles'] === TRIANGLES);
    expect(right, `an error issue names heavy and grit at items/grit/params/emit/shape/surface/of with actual.triangles 1,048,577: ${show(c.issues.map((i) => i.raw))}`).toBeDefined();
  }, TIMEOUT);
});

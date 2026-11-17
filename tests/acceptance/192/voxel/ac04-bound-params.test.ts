// #192.18162055: A provider whose param a document binds to t, to a control or to a logic array is refused at check,
// naming the param, while the same provider given a constant passes.
//
// The voxel mesher's `size`, which a document names at `items/vox/params/mesh/params/size`, bound by a driver (the
// design's binding: Driver `vars`) to time (`t`), to a document control's value (`controls/grain/value`) and to a
// logic item's array (`pilot.grain`, a logic program that writes 0.25 each step, kept in the evidence store). Each
// document is refused with an error `provider_param_bound` whose `actual.param` is `size` (README: The surface); the
// same document with `size` a constant 0.125 is presented, and the provider's mesh is the block at that size.
import { describe, expect, it } from 'vitest';
import {
  DOC, MESH_BUILD, deepShow, errors, installPack, meshOf, present, provided, rowOf, runShow, scenario, show, sub, useTemp, type JsonObject,
} from './helpers.ts';
import { SIZE, blockBounds, keepGrainLogic, voxPack, voxelDoc } from './programs.ts';

const ID = '#192.18162055';
const temp = useTemp();
const SEED = 192_004;
const TARGET = 'items/vox/params/mesh/params/size';
const driven = (expr: string, vars: JsonObject, extra: JsonObject = {}): JsonObject =>
  voxelDoc(SIZE.first, SEED, { drivers: { grain: { target: TARGET, expr, vars } }, ...extra });

describe(`${ID} a provider param bound to time, a control or a logic array is refused at check, naming the param`, () => {
  it(`${ID} a provider whose param a document binds to t, to a control or to a logic array is refused at check, naming the param, while the same provider given a constant passes`, () => {
    const root = temp();
    const evidence = sub(root, 'evidence');
    const program = keepGrainLogic(evidence);
    const bound: [string, JsonObject][] = [
      ['t', driven('0.25 + 0.001 * t', { t: 'time' })],
      ['a control', driven('g', { g: 'controls/grain/value' }, {
        controls: { grain: { kind: 'slider', class: 'document', label: 'Grain', role: 'slider', range: [0.0625, 1], default: 0.25, increment: 0.0625 } },
      })],
      ['a logic array', (() => {
        const d = driven('g', { g: 'pilot.grain' }, { requires: { modules: { logic: '^1' } } });
        (d['items'] as JsonObject)['pilot'] = { id: 'pilot', kind: 'logic@1', name: 'Pilot', order: 'b0', params: { program, step_rate: 60, writes: { grain: { type: 'f64' } } } };
        return d;
      })()],
    ];
    const docs = [DOC.a, DOC.b, DOC.c];
    const rs = runShow(deepShow(MESH_BUILD), scenario(evidence, [
      installPack(voxPack(sub(root, 'packs'))),
      ...bound.map(([, d], i) => present(docs[i]!, d)),
      present(DOC.d, voxelDoc(SIZE.constant, SEED)), provided(DOC.d),
    ]));
    expect(rs[0]!['outcome'], `test/voxpack@1.0.0 installs: ${show(rs[0])}`).toBe('installed');

    const failed = bound.flatMap(([how], i) => {
      const r = rs[1 + i]!;
      const named = errors(r, `size bound to ${how}`).filter((e) => e.code === 'provider_param_bound' && (e.actual as JsonObject | null)?.['param'] === 'size');
      return [
        ...(r['outcome'] === 'presented' ? [`size bound to ${how}: the document passed its check`] : []),
        ...(named.length ? [] : [`size bound to ${how}: no error provider_param_bound names the param size: ${show(r['issues'] ?? null)}`]),
      ];
    });
    expect(failed, 'each binding is refused at check, naming the param').toEqual([]);

    const [constant, out] = rs.slice(4);
    expect(constant!['outcome'], `the same provider given a constant size passes: ${show(constant)}`).toBe('presented');
    expect(errors(constant!, 'the constant').map((e) => e.raw), 'with no error').toEqual([]);
    const bounds = meshOf(rowOf(out!, 'vox', 'the constant'), 'its mesh').bounds;
    expect(bounds.every((c, i) => c.every((x, k) => Math.abs(x - blockBounds(SIZE.constant)[i]![k]!) <= 1e-6)), `its mesh is the block at size ${SIZE.constant}: ${show(bounds)}`).toBe(true);
  }, 3_600_000);
});

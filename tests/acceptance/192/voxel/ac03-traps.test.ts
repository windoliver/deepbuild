// #192.3a0faf7a: A provider that writes one vertex past its max_vertices traps with over_cap, and one that loops traps
// with fuel, each failing the check, naming the provider, the item and the kind, with no output kept; and a provider
// whose program imports a function is refused at check, naming the import.
//
// The fault provider (README: Fixtures) writes a 12-vertex tetrahedron under `max_vertices: 12`, unless the
// document gives its `fault` param 1 (a 13th vertex) or 2 (an endless loop); its pack's check, at the param's range
// ends and default, meets neither fault, so each reaches the document's check. Each fault fails that check with an
// error `provider_trap` naming the provider, the item and the trap's kind (#238's issue shape), and the item's
// `provided` row keeps no output. The importing provider sits in its own pack: its refusal may come at the pack's
// check or at the document's, and must name the import as `{module, name}` (#238's refusal field); the same fault
// provider at its default passes, so each failure is its fault's.
import { describe, expect, it } from 'vitest';
import {
  DOC, MESH_BUILD, deepShow, errors, installPack, meshOf, objectsIn, present, provided, providedRows, rowOf, runShow, scenario, show, sub, useTemp,
  type Issue, type JsonObject,
} from './helpers.ts';
import { IMPORT, board, clock, faultPack, importPack, meshItem, tetraVertexCounts } from './programs.ts';

const ID = '#192.3a0faf7a';
const temp = useTemp();

const faultDoc = (title: string, item: string, provider: string, params: JsonObject): JsonObject =>
  board(title, ['test/faultpack@1.0.0'], [meshItem(item, provider, params)], { seed: 192_003 });
/** The `provider_trap` errors naming `provider`, `item` and a trap of `kind`. */
const trapErrors = (list: Issue[], provider: string, item: string, kind: string): Issue[] => list.filter((i) => {
  const a = i.actual as JsonObject | null;
  return i.code === 'provider_trap' && a !== null && a['provider'] === provider && a['item'] === item
    && typeof a['trap'] === 'object' && a['trap'] !== null && (a['trap'] as JsonObject)['kind'] === kind;
});
const namesImport = (list: Issue[]): Issue[] => list.filter((i) => objectsIn(i.raw).some((o) => o['module'] === IMPORT.module && o['name'] === IMPORT.name));

describe(`${ID} over_cap and fuel traps fail the check, naming the provider, the item and the kind, and an import is refused`, () => {
  it(`${ID} a provider writing one vertex past max_vertices traps over_cap and one that loops traps fuel, each failing the check naming the provider, the item and the kind with no output kept; a provider whose program imports a function is refused at check, naming the import`, async () => {
    expect(await tetraVertexCounts(), 'fixture tetra_faults: 12 vertices at fault 0, 13 at fault 1').toEqual([12, 13]);
    expect(clock().bytes.length, 'fixture clock_import assembles').toBeGreaterThan(0);
    const root = temp();
    const faults = faultPack(sub(root, 'packs'));
    const imports = importPack(sub(root, 'packs'));
    const [install, importInstall, over, overOut, spin, spinOut, clocked, clockOut, plain, plainOut] = runShow(deepShow(MESH_BUILD), scenario(sub(root, 'evidence'), [
      installPack(faults), installPack(imports),
      present(DOC.a, faultDoc('Over cap', 'over-1', 'faultpack.overcap', { fault: 1 })), provided(DOC.a),
      present(DOC.b, faultDoc('Spin', 'spin-1', 'faultpack.spin', { fault: 2 })), provided(DOC.b),
      present(DOC.c, board('Clock', ['test/importpack@1.0.0'], [meshItem('clock-1', 'importpack.clock', {})], { seed: 192_003 })), provided(DOC.c),
      present(DOC.d, faultDoc('Plain', 'plain-1', 'faultpack.overcap', {})), provided(DOC.d),
    ]));
    expect(install!['outcome'], `test/faultpack@1.0.0 installs (its check meets neither fault): ${show(install)}`).toBe('installed');

    const failed: string[] = [];
    for (const [reply, out, item, provider, kind] of [[over, overOut, 'over-1', 'faultpack.overcap', 'over_cap'], [spin, spinOut, 'spin-1', 'faultpack.spin', 'fuel']] as const) {
      const what = `${provider} (${kind})`;
      if (reply!['outcome'] === 'presented') failed.push(`${what}: the document passed its check: ${show(reply)}`);
      if (trapErrors(errors(reply!, what), provider, item, kind).length === 0) failed.push(`${what}: no error provider_trap names the provider, item ${item} and kind ${kind}: ${show(reply!['issues'] ?? null)}`);
      const row = providedRows(out!, what).find((r) => r.item === item);
      if (row && row.out !== null) failed.push(`${what}: an output was kept: ${show(row.raw).slice(0, 300)}`);
    }
    // The import: refused at the pack's check (install) or at the document's, naming {module: "env", name: "now"}.
    const importErrors = [...(importInstall!['outcome'] === 'installed' ? [] : errors(importInstall!, 'test/importpack@1.0.0\'s install')), ...errors(clocked!, 'the importing provider\'s document')];
    if (clocked!['outcome'] === 'presented') failed.push(`importpack.clock: the document naming the importing provider passed its check: ${show(clocked)}`);
    if (namesImport(importErrors).length === 0) failed.push(`importpack.clock: no refusal names the import ${IMPORT.module}.${IMPORT.name} as {module, name}: ${show(importErrors.map((i) => i.raw))}`);
    if (providedRows(clockOut!, 'importpack.clock').some((r) => r.out !== null)) failed.push('importpack.clock: an output was kept');
    expect(failed, 'each fault fails the check as the criterion says').toEqual([]);

    expect(plain!['outcome'], `the same fault provider at its default passes: ${show(plain)}`).toBe('presented');
    expect(meshOf(rowOf(plainOut!, 'plain-1', 'the default fault provider'), 'its tetrahedron').positions.length, 'its 12 vertices').toBe(12);
  }, 3_600_000);
});

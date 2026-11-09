// Criterion 8 (no upstream test): "A pack whose library imports a host function is refused when its version is
// checked, naming the import, and one whose library fails a fixture is refused, naming the fixture; a planted pack
// check that skips the subset check for libraries installs the first and fails, naming the import"
//
// Through `deep-logic pack_check` (README: deep-logic, Pack). hostpack@1.0.0 carries a grid_path@1 that imports the host
// function env.now (never called, so its fixture would pass were the import let through); cutpack@1.0.0 carries the
// corner-cutting grid_path with grid_path@1's fixture; gridcore@1.0.0, the sound one, installs. The judgement of a
// pack check's reply fails when a pack holding a library that imports env.now installs, naming the import.
// `pack_check_skips_library_subset` checks no library against the one subset.
import { describe, expect, it } from 'vitest';
import { AC, TIMEOUT, fixtureId, importOf, logicBin, onHost, packCheckCall, prebuild, refusedOf, show, type JsonObject } from './helpers.ts';
import { gridPath1, pack } from './libs.ts';

prebuild(() => { logicBin(); });

const hostPack = () => pack('hostpack', [gridPath1({ hostImport: true })]);
/** The criterion over a pack check of hostpack: it must not install, and its refusal must name env.now. */
function judge(reply: JsonObject): string[] {
  if (reply['ok'] === true) return ['pack hostpack@1.0.0 installs, though its grid_path@1 imports env.now'];
  const r = refusedOf(reply, 'the pack check of hostpack@1.0.0');
  return r.refusals.map(importOf).includes('env.now') ? [] : [`hostpack@1.0.0 is refused without naming the import env.now: ${show(r.refusals as never)}`];
}

describe(`${AC[8]} checking a pack's version checks each library against the one subset and runs its fixtures`, () => {
  it(`${AC[8]} a pack whose library imports a host function is refused naming the import, one whose library fails a fixture is refused naming the fixture, and a sound pack installs`, () => {
    const cut = gridPath1({ cut: true });
    const [host, failing, sound] = onHost([packCheckCall(hostPack()), packCheckCall(pack('cutpack', [cut])), packCheckCall(pack('gridcore', [gridPath1()]))]);
    expect(sound!['ok'] === true && sound!['installed'] === true && sound!['pack'] === 'gridcore@1.0.0', `the sound pack installs: ${show(sound)}`).toBe(true);
    const h = refusedOf(host!, 'the pack check of hostpack@1.0.0');
    expect([h.code, h.pack], 'the pack is refused, naming it').toEqual(['pack_refused', 'hostpack@1.0.0']);
    expect(judge(host!), 'its refusal names the import env.now').toEqual([]);
    const f = refusedOf(failing!, 'the pack check of cutpack@1.0.0');
    expect([f.code, f.pack], 'the pack whose library fails its fixture is refused, naming it').toEqual(['pack_refused', 'cutpack@1.0.0']);
    expect(f.refusals.some((r) => r['fixture'] === fixtureId(cut, cut.fixtures[0]!) && r['library'] === 'grid_path@1'), `a refusal names the fixture: ${show(f.refusals as never)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[8]} a planted pack check that skips the subset check for libraries (pack_check_skips_library_subset) installs the first pack and fails, naming the import`, () => {
    const [reply] = onHost([packCheckCall(hostPack())], ['pack_check_skips_library_subset']);
    expect(reply!['ok'] === true && reply!['installed'] === true, `the planted pack check installs hostpack@1.0.0: ${show(reply)}`).toBe(true);
    const failures = judge(reply!);
    expect(failures.length === 1 && failures[0]!.includes('env.now'), `the criterion fails, naming the import: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);
});

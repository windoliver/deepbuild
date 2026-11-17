// #192.ac23e07b (criterion 11): a provider's pack check runs it at each numeric param's declared minimum and maximum
// (and at 3 fixed seeds); a planted provider that traps only at its param's maximum passes a defaults-only check and
// fails the pack check, naming the param and the value.
//
// The planted provider is trap_max.wat: param `n` (i32, default 4, range [1, 16]); it executes `unreachable` only when
// n is 16. Its pack test/trapmax is the plant; test/trapmaxok carries the same program with range [1, 15], so its pack
// check never reaches 16, and a document naming it with no params is the check at the defaults (README: Readings).
import { describe, expect, it } from 'vitest';
import {
  DOC, SHOW, TIMEOUT, deepShow, errors, hostReady, installPack, installShown, issuesAt, meshDoc, meshProvider, nodeRun, prebuild, present, program,
  provided, providedRow, providerPack, ranTheQuad, runShow, scenario, show, useTemp, type JsonObject,
} from './helpers.ts';

/** Criterion 11's ID: `#192.` and the first 8 hex digits of the SHA-256 of its text (scripts/proof-change.mjs). */
const ID = '#192.ac23e07b';
prebuild(() => { deepShow(SHOW); });
const temp = useTemp();

const schema = (max: number): JsonObject => ({ n: { type: 'i32', unit: '', default: 4, range: [1, max] } });

describe(`${ID} the pack check runs a provider at each numeric param's minimum and maximum`, () => {
  it(`${ID} a provider that traps only at its param's maximum passes the check at its defaults and fails the pack check, naming the param n and the value 16`, () => {
    hostReady();
    const edge = program('trap_max');
    // The fixture as written, in Node's engine: no trap at n = 1, 4 (the default) and 15; `unreachable` at 16.
    const at = (n: bigint): string | null => nodeRun(edge, { params: [n] }).trap;
    expect([at(1n), at(4n), at(15n)], 'trap_max.wat runs at its minimum, its default and 15').toEqual([null, null, null]);
    expect(at(16n), 'trap_max.wat traps at its maximum, 16').not.toBeNull();

    const dir = temp();
    const planted = providerPack(dir, 'trapmax', { edge: meshProvider(edge, { params: schema(16) }) }, { 'trap_max.wasm': edge.bytes }).pack;
    const twin = providerPack(dir, 'trapmaxok', { edge: meshProvider(edge, { params: schema(15) }) }, { 'trap_max.wasm': edge.bytes }).pack;
    const [twinInstall, shown, out, plantInstall] = runShow(deepShow(SHOW), scenario(dir, [
      installPack(twin), present(DOC.a, meshDoc(twin, 'trapmaxok.edge')), provided(DOC.a), installPack(planted),
    ]));

    // The check at the defaults passes: the program's pack, whose maximum is 15, installs, and the document that names
    // it with no params runs it at n = 4 to its quad, with no error.
    expect(twinInstall!['outcome'], `test/trapmaxok@1.0.0 (the same program, range [1, 15]) installs: ${installShown(twinInstall)}`).toBe('installed');
    expect([shown!['outcome'], errors(shown)], `the document naming trapmaxok.edge with its defaults is presented with no error: ${show(shown)}`).toEqual(['presented', []]);
    expect(ranTheQuad(providedRow(out)), `trapmaxok.edge ran at its defaults to its quad, with no trap: ${show(out)}`).toBe(true);

    // The pack check runs the plant at its maximum: refused, naming the param and the value.
    expect(plantInstall!['outcome'], `test/trapmax@1.0.0 (range [1, 16]) fails its pack check: ${installShown(plantInstall)}`).toBe('refused');
    const named = issuesAt(plantInstall, 'providers/edge/params/n').filter((i) => (i['actual'] as JsonObject | null)?.['value'] === 16);
    expect(named.length, `the refusal names the param n and the value 16 (an issue at providers/edge/params/n with actual.value 16): ${installShown(plantInstall)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});

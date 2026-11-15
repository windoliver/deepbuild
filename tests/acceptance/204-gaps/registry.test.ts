// A gap test for #204, past its criteria and inside its Scope: "a preset … is an entry of the synth.preset@1 registry
// (the registries task), filled by first-party packs and packs". `tests/acceptance/204/` checks a pack's presets at its
// install but never reads the registry, so this holds what `deep://registries` publishes: once a pack is installed,
// each of its presets is an entry of `synth.preset@1`, named as a document names it, with origin `pack` and its pack,
// and its kit passed; before the install, none is.
import { describe, expect, it } from 'vitest';
import { ENGINE, TIMEOUT, installCall, installed, isObject, runShow, useShow, useTemp, writePack, type JsonObject, type JsonValue } from '../204/helpers.ts';

const bin = useShow();
const temp = useTemp();

/** Every published entry of `synth.preset@1` in a `registries` reply: `{name, origin, pack, kit}`. */
function presetsOf(reply: JsonObject | undefined): JsonObject[] {
  const found: JsonObject[] = [];
  const walk = (v: JsonValue | undefined): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (isObject(v)) {
      if (v['registry'] === 'synth.preset@1' && typeof v['name'] === 'string' && v['name'] !== 'synth.preset@1') found.push(v);
      Object.values(v).forEach(walk);
    }
  };
  walk(reply as JsonValue | undefined);
  return found;
}

describe('#204 Scope: a pack\'s presets are entries of synth.preset@1', () => {
  it('after a pack is installed, `registries` lists each of its presets under synth.preset@1 as <pack>.<name>@<major>, origin pack, kit PASS; before, it lists none', () => {
    const pack = writePack(temp(), 'engines', { engine: ENGINE, idle: { ...ENGINE, params: { hz: { unit: 'Hz', range: [60, 180], default: 70 } } } });
    const [before, inst, after] = runShow(bin(), { evidence: temp(), calls: [{ call: 'registries' }, installCall(pack), { call: 'registries' }] }, 'registries around an install');
    installed(inst, 'the pack engines');
    expect(presetsOf(before), 'no preset is an entry before the pack is installed').toEqual([]);
    const listed = presetsOf(after).map((e) => ({ name: e['name'], origin: e['origin'], pack: e['pack'], kit: isObject(e['kit']) ? e['kit']['verdict'] : null }));
    expect(listed.sort((a, b) => String(a.name).localeCompare(String(b.name))), 'the pack\'s two presets are entries of synth.preset@1').toEqual([
      { name: 'engines.engine@1', origin: 'pack', pack: 'test/engines@1.0.0', kit: 'PASS' },
      { name: 'engines.idle@1', origin: 'pack', pack: 'test/engines@1.0.0', kit: 'PASS' },
    ]);
  }, TIMEOUT);
});

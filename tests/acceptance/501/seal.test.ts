// AC6 #501.bf5a3338: "export.target@1, which the core declares in the core's crate, holds the media module's video and
// png after the seal; a planted target whose reader is its own writer is refused at the seal, naming the target; and a
// build without the media module seals export.target@1 with a test module's target, where a planted declaration in the
// media module's crate is refused at that build's seal, naming media"
//
// Through `deep-show run` in three builds (README: Cargo features): `full`; `full,test-leave-out-media,test-export-target`,
// the full set without media and with the test module `test.export`, whose entry `test.raw` fills export.target@1; and
// the same with `test-export-target-in-media`, the planted layout that declares export.target@1 in the media module's
// crate. The registry is read from #200's `registries` listing; the planted reader is `--planted target_reader_is_writer`
// (media's png entry with its fidelity reader set to its own writer). A refusal is #305's startup line, exit 2.
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, NO_MEDIA, NO_MEDIA_PLANTED, TIMEOUT, arr, none, obj, runShow, scenario, show, startupRefusal, str, useShow, useTemp,
  type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL, NO_MEDIA, NO_MEDIA_PLANTED]);
const temp = useTemp();
const REGISTRY = 'export.target@1';

interface Target { name: string; module: string; writer: string; reader: string; fidelity: string[] }
/** export.target@1 in a `registries` reply: its owner and its entries (README: `registries`). */
function exportTargets(reply: JsonObject): { owner: string; entries: Target[] } {
  const all = arr(reply['registries'], 'registries: registries').map((v, i) => obj(v, `registries[${i}]`));
  const o = all.find((x) => x['kind'] === 'registry' && x['name'] === REGISTRY);
  expect(o, `deep://registries lists ${REGISTRY}; it lists ${all.map((x) => String(x['name'])).join(', ')}`).toBeDefined();
  return {
    owner: str(o!['owner'], `${REGISTRY}.owner`),
    entries: arr(o!['entries'], `${REGISTRY}.entries`).map((e, i) => {
      const x = obj(e, `${REGISTRY}.entries[${i}]`); const w = `${REGISTRY}.entries[${i}]`;
      return { name: str(x['name'], `${w}.name`), module: str(x['module'], `${w}.module`), writer: str(x['writer'], `${w}.writer`), reader: str(x['reader'], `${w}.reader`), fidelity: arr(x['fidelity'], `${w}.fidelity`).map((f, j) => str(f, `${w}.fidelity[${j}]`)) };
    }),
  };
}
/** Each entry's reader is independent of its writer, and each names a fidelity check. */
const entryFailures = (entries: Target[]): string[] => entries.flatMap((t) => [
  ...(t.reader === t.writer ? [`${t.name}: its reader is its own writer (${t.writer})`] : []),
  ...(t.fidelity.length === 0 ? [`${t.name}: it names no fidelity check`] : []),
]);
const mentions = (v: unknown, word: string): boolean => new RegExp(`"${word.replace(/\./g, '\\.')}"`).test(JSON.stringify(v));

describe(`${AC[6]} export.target@1 is the core's, filled by canvas modules at the seal`, () => {
  it(`${AC[6]} in the full build export.target@1 is declared by the core and holds media's video and png, each with a reader independent of its writer`, () => {
    const [reply] = runShow(shows.bin(FULL), scenario(temp(), [{ call: 'registries' }]), 'the full build\'s registries');
    const r = exportTargets(reply!);
    expect(r.owner, `${REGISTRY} is declared by the core`).toBe('core');
    for (const name of ['video', 'png']) expect(r.entries.find((t) => t.name === name)?.module, `${REGISTRY} holds ${name}, filled by media`).toBe('media');
    none(entryFailures(r.entries), `${REGISTRY}'s entries`);
  }, TIMEOUT);

  it(`${AC[6]} a planted target whose reader is its own writer is refused at the seal, naming the target`, () => {
    const raw = startupRefusal(shows.bin(FULL), 'target_reader_is_writer');
    expect(mentions(raw['registry'] ?? raw, REGISTRY), `the refusal names ${REGISTRY}: ${show(raw)}`).toBe(true);
    expect(mentions(raw['entries'] ?? null, 'png'), `the refusal names the target png in its entries: ${show(raw)}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[6]} a build without the media module seals export.target@1, still the core's, with the test module's target test.raw and no media entry`, () => {
    const [registry, registries] = runShow(shows.bin(NO_MEDIA), scenario(temp(), [{ call: 'registry' }, { call: 'registries' }]), 'the build without media');
    const modules = arr(registry!['modules'], 'registry: modules');
    expect(modules, 'the build holds no media module').not.toContain('media');
    expect(modules, 'the build holds the test module test.export').toContain('test.export');
    const r = exportTargets(registries!);
    expect(r.owner, `${REGISTRY} is the core's in the build without media`).toBe('core');
    expect(r.entries.map((t) => `${t.name} (${t.module})`), `${REGISTRY} holds the test module's target and nothing of media's`).toEqual(['test.raw (test.export)']);
    none(entryFailures(r.entries), `${REGISTRY}'s entries without media`);
  }, TIMEOUT);

  it(`${AC[6]} in that build, a planted declaration of export.target@1 in the media module's crate is refused at the seal, naming media`, () => {
    const raw = startupRefusal(shows.bin(NO_MEDIA_PLANTED));
    const modules = Array.isArray(raw['modules']) ? raw['modules'] : [];
    expect(modules.includes('media') || mentions(raw['module'] ?? null, 'media'), `the refusal names media: ${show(raw)}`).toBe(true);
    expect(mentions(raw, REGISTRY), `the refusal names ${REGISTRY}: ${show(raw)}`).toBe(true);
  }, TIMEOUT);
});

// Criterion 7: a character body with a box shape, two capsules or a follow channel is refused at check, naming the
// field; on a test backend whose caps() lists no character controller, a world with one is refused, naming the body and
// the backend; and no Rapier type appears in the physics crate's public items.
//
// "Naming the field" is an error issue whose path is the field's (`bodies/hero/shapes…`, `bodies/hero/follow`), while
// the same body with one capsule and no follow is admitted, so the refusal is the field's and not the kind's. The test
// backend is `--backend no_character_controller`. The public items are rustdoc's JSON of `deep-canvas-physics` and
// `deep-physics-rapier`, walked as #2009's suite walks them, which must reach the character body (its document field
// `slope_limit` a public struct field, as #2009 required of the world's fields); the twin feature `test-leaks-rapier`
// must be caught.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { fieldNames, leaks, type Doc } from './api.ts';
import {
  AC, HERO, TARGET, TIMEOUT, arr, box, caught, cargoError, characterWorld, check, heroBody, isObject, none, physics, prebuild,
  show, slab, standing, use, type JsonObject,
} from './helpers.ts';

prebuild(['shipped', 'test']);
const BACKEND = 'no_character_controller';
const DOC_TARGET = join(TARGET, 'acceptance-182-doc');

function heroWorld(hero: JsonObject): JsonObject {
  return characterWorld({ statics: { floor: slab(-5, 5, -1, 0) }, movers: { [HERO]: hero }, shapes: { crate: box([0.3, 0.9, 0.3]) } });
}
const ok = (): JsonObject => heroBody([0, standing(0), 0]);
interface Issue { code: string; severity: string; path: string; ids: string[]; raw: JsonObject }
function issuesOf(reply: JsonObject, what: string): Issue[] {
  expect(reply['ok'], `${what}: check answers: ${show(reply)}`).toBe(true);
  return arr(reply['issues'] ?? [], `${what}: issues`).filter(isObject).map((i) => ({
    code: String(i['code']), severity: String(i['severity']), path: String(i['path']), ids: Array.isArray(i['ids']) ? i['ids'].map(String) : [], raw: i,
  }));
}
const errors = (list: Issue[]): Issue[] => list.filter((i) => i.severity === 'error');

/** rustdoc's JSON of `crate`'s library on the stable toolchain (RUSTC_BOOTSTRAP=1 admits `--output-format json`). */
function rustdoc(crate: string, features: string[] = []): Doc {
  const error = cargoError(['rustdoc', '--locked', '-p', crate, '--lib', ...(features.length ? ['--features', features.join(',')] : []), '--', '-Z', 'unstable-options', '--output-format', 'json'],
    { RUSTC_BOOTSTRAP: '1', CARGO_TARGET_DIR: DOC_TARGET });
  expect(error, `rustdoc JSON of ${crate}${features.length ? ` with ${features.join(',')}` : ''}`).toBe('');
  const file = join(DOC_TARGET, 'doc', `${crate.replace(/-/g, '_')}.json`);
  expect(existsSync(file), `rustdoc wrote ${file}`).toBe(true);
  return JSON.parse(readFileSync(file, 'utf8')) as Doc;
}

describe(`${AC[7]} a character body's shape, follow channel and backend are checked, and no Rapier type crosses the interface`, () => {
  test(`${AC[7]} a box shape, two capsules or a follow channel is refused at check naming the field; one capsule is admitted`, () => {
    const cases: [string, JsonObject, RegExp][] = [
      ['a box shape', { ...ok(), shapes: [use('crate')] }, /^bodies\/hero\/shapes/],
      ['two capsules', { ...ok(), shapes: [use('capsule'), use('capsule')] }, /^bodies\/hero\/shapes/],
      ['a follow channel', { ...ok(), follow: 'items/hero_mark/at/pos' }, /^bodies\/hero\/follow/],
    ];
    const replies = physics([check(heroWorld(ok())), ...cases.map(([, b]) => check(heroWorld(b)))]);
    const out: string[] = [];
    const admitted = errors(issuesOf(replies[0]!, 'one capsule'));
    if (admitted.length) out.push(`one capsule with no follow is refused: ${show(admitted.map((i) => i.raw))}`);
    cases.forEach(([label, , path], n) => {
      const errs = errors(issuesOf(replies[n + 1]!, label));
      if (!errs.some((i) => path.test(i.path))) out.push(`${label}: no error issue names the field (${path.source}); issues ${show(errs.map((i) => i.raw))}`);
      const kind = errs.filter((i) => i.path === 'bodies/hero/kind');
      if (kind.length) out.push(`${label}: the body's kind is refused (${show(kind.map((i) => i.raw))}), not the field`);
    });
    none(out, 'the character body\'s checks');
  }, TIMEOUT);

  test(`${AC[7]} on a test backend whose caps() list no character controller (--backend ${BACKEND}) a world with one is refused, naming the body and the backend`, () => {
    const [onRapier] = physics([check(heroWorld(ok()))], { build: 'test' });
    expect(errors(issuesOf(onRapier!, 'Rapier (test build)')), 'Rapier admits the world').toEqual([]);
    const [reply] = physics([check(heroWorld(ok()))], { backend: BACKEND });
    const errs = errors(issuesOf(reply!, BACKEND));
    const naming = errs.filter((i) => (i.ids.includes(HERO) || i.path.startsWith(`bodies/${HERO}`)) && JSON.stringify(i.raw).includes(BACKEND));
    expect(naming.length, `an error issue names the body ${HERO} (ids or path) and the backend ${BACKEND}: ${show(errs.map((i) => i.raw))}`).toBeGreaterThan(0);
  }, TIMEOUT);

  test(`${AC[7]} no public item of the physics crates names a Rapier type; the twin feature test-leaks-rapier is caught`, () => {
    const found: string[] = [];
    const fields = new Set<string>();
    for (const crate of ['deep-canvas-physics', 'deep-physics-rapier']) {
      const doc = rustdoc(crate);
      for (const l of leaks(doc)) found.push(`${crate}: public ${l.kind} ${l.item} names ${l.names}`);
      for (const f of fieldNames(doc)) fields.add(f);
    }
    expect(fields.has('slope_limit'), 'the scan reaches the character body: its document field slope_limit is a public field of the physics crates').toBe(true);
    none(found, 'no public item of deep-canvas-physics or deep-physics-rapier names a Rapier type');
    caught(leaks(rustdoc('deep-physics-rapier', ['test-leaks-rapier'])).map((l) => `${l.kind} ${l.item}`), 'test-leaks-rapier\'s public items naming Rapier types');
  }, TIMEOUT);
});

// AC2 #1781.e091f892: "A point attribute given 7 values is refused, naming the attribute, `point`, 7 and 8. An
// attribute named `position`, `normal`, `uv0`, `id` or `index` is refused, naming it. A `store` whose domain is
// `edge`, `curve` or `instance`, or whose type is `bool`, `i32`, `u32` or `quat`, is refused at check, naming the
// field"
//
// Thirteen documents, each presented by alpha in one process, each holding the one item `box`:
//   - a `test.attrs@1` whose one attribute `seven` is a point f32 with 7 values (a box has 8 points);
//   - five `test.attrs@1` boxes whose one point f32 attribute, with 8 values, is named `position`, `normal`, `uv0`,
//     `id` and `index` in turn;
//   - three slab boxes with one `mod.store@1 {name: s, domain, type: f32, field: position.x}` whose domain is `edge`,
//     `curve` and `instance` in turn;
//   - four slab boxes with one `mod.store@1 {name: s, domain: point, type, field}` whose type is `bool`, `i32`, `u32`
//     and `quat` in turn (the field `position.x`, and `vec4(0, 0, 0, 1)` for quat, so only the type is at fault).
//
// asserts, each revision refused (`outcome: refused`) by an error issue:
//   - `attribute.length` under items/box, naming attribute `seven`, domain `point`, length 7 and count 8;
//   - `attribute.reserved` under items/box, naming the attribute, for each of the five names;
//   - an error at items/box/modifiers/0/params/domain for each of the three domains (the field it names; its code
//     isn't pinned);
//   - an error at items/box/modifiers/0/params/type for each of the four types.
// No planted program is named; the base lacks `test.attrs@1` and its test build (BASE-FAILURE.txt).
import { describe, it } from 'vitest';
import { ATTRS, BOX, TIMEOUT, attrsBox, none, present, refusalProblems, sceneDoc, slabBox, store, useFolders, useShow, type JsonObject } from './helpers.ts';

/** The criterion: its number, and `#1781.` with the first 8 hex digits of SHA-256 of its text (scripts/proof-change.mjs). */
const ID = 'AC2 #1781.e091f892';
const bin = useShow(ATTRS);
const folder = useFolders();

const EIGHT = [1, 2, 3, 4, 5, 6, 7, 8];
const RESERVED = ['position', 'normal', 'uv0', 'id', 'index'];
const DOMAINS = ['edge', 'curve', 'instance'];
const TYPES = ['bool', 'i32', 'u32', 'quat'];
const withAttribute = (name: string, values: number[]): JsonObject =>
  sceneDoc(`A box with the attribute ${name}`, { [BOX]: attrsBox([{ name, domain: 'point', type: 'f32', values }]) });
const withStore = (domain: string, type: string): JsonObject =>
  sceneDoc(`A box with a store on ${domain} as ${type}`, { [BOX]: slabBox([store('s', domain, type, type === 'quat' ? 'vec4(0, 0, 0, 1)' : 'position.x')]) });

describe(`${ID} what an attribute and a store refuse`, () => {
  it(`${ID} a point attribute given 7 values is refused, naming the attribute, point, 7 and 8; an attribute named position, normal, uv0, id or index is refused, naming it; a store on edge, curve or instance, or as bool, i32, u32 or quat, is refused at check, naming the field`, () => {
    const replies = present(bin(), folder(), [
      withAttribute('seven', EIGHT.slice(0, 7)),
      ...RESERVED.map((name) => withAttribute(name, EIGHT)),
      ...DOMAINS.map((domain) => withStore(domain, 'f32')),
      ...TYPES.map((type) => withStore('point', type)),
    ]);
    const at = (k: number): JsonObject => replies[k]!;
    none([
      ...refusalProblems(at(0), 'a point attribute given 7 values', { code: 'attribute.length', at: `items/${BOX}`, names: { attribute: 'seven', domain: 'point', length: 7, count: 8 } }),
      ...RESERVED.flatMap((name, k) => refusalProblems(at(1 + k), `an attribute named ${name}`, { code: 'attribute.reserved', at: `items/${BOX}`, names: { attribute: name } })),
      ...DOMAINS.flatMap((domain, k) => refusalProblems(at(6 + k), `a store whose domain is ${domain}`, { code: null, at: `items/${BOX}/modifiers/0/params/domain` })),
      ...TYPES.flatMap((type, k) => refusalProblems(at(9 + k), `a store whose type is ${type}`, { code: null, at: `items/${BOX}/modifiers/0/params/type` })),
    ], 'each of the thirteen is refused, naming what the criterion says');
  }, TIMEOUT);
});

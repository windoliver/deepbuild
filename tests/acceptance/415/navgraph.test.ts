// #415.99838793: nav.graph@1's and @2's validators treat the graph as untrusted input: each field that sizes or
// indexes another is checked against what it points into, and a refusal names the field; 10,000 seeded
// truncations and bit flips of the fixture level end refused or admitted, never in a trap or a crash; a planted
// validator that trusts the header's link count reads past the asset.
import { describe, expect, it } from 'vitest';
import {
  LEVEL, LONG, NAV_VERTEX_CAP, mutate, navGraph, offsetOf, prebuild, runShow, seeded, sha256, show, useTemp, validate, verdict, writeAsset,
  type Built, type JsonObject,
} from './helpers.ts';

const ID = '#415.99838793';
prebuild();
const temp = useTemp();

const N = LEVEL.nodes.length;
const u32 = (v: number) => (b: Buffer, at: number): void => { b.writeUInt32LE(v >>> 0, at); };
const u8 = (v: number) => (b: Buffer, at: number): void => { b.writeUInt8(v, at); };
const f32 = (v: number) => (b: Buffer, at: number): void => { b.writeFloatLE(v, at); };
interface Case { name: string; field: string; write: (b: Buffer, at: number) => void }
/** Each malformed field the criterion names, in both versions; tags and faces exist only in nav.graph@2. */
function cases(version: 1 | 2): Case[] {
  const list: Case[] = [
    { name: 'a node count past the bytes that follow', field: 'header.node_count', write: u32(0x00ff_ffff) },
    { name: 'a link count one link past the bytes that follow', field: 'header.link_count', write: u32(LEVEL.links.length + 1) },
    { name: 'a link whose a is the node count', field: 'links[5].a', write: u32(N) },
    { name: 'a link whose b is past the node count', field: 'links[5].b', write: u32(N + 2) },
    { name: 'a NaN floor', field: 'nodes[2].floor', write: f32(Number.NaN) },
    { name: 'a floor of minus infinity', field: 'nodes[3].floor', write: f32(Number.NEGATIVE_INFINITY) },
    { name: 'a polygon of 0 vertices', field: 'nodes[1].vertex_count', write: u32(0) },
    { name: `a polygon of ${NAV_VERTEX_CAP + 1} vertices, past its cap`, field: 'nodes[1].vertex_count', write: u32(NAV_VERTEX_CAP + 1) },
  ];
  if (version === 2) {
    list.push(
      { name: `a node tag bit ${LEVEL.tags.length}, past the ${LEVEL.tags.length} tags`, field: 'nodes[2].tags', write: u32(1 << LEVEL.tags.length) },
      { name: 'a wall link face 6, past 0 to 5', field: 'links[5].face', write: u8(6) },
    );
  }
  return list;
}

describe(`${ID} nav.graph@1 and @2 refuse each malformed field by name, survive 10,000 mutations, and catch a validator trusting the link count`, () => {
  it(`${ID} nav.graph@1's and nav.graph@2's validators admit the fixture level and refuse each malformed count, index, floor, polygon, tag and face, naming the field`, () => {
    const dir = temp();
    const calls: JsonObject[] = [];
    const want: { what: string; reply: JsonObject }[] = [];
    for (const version of [1, 2] as const) {
      const g = navGraph(version);
      const layout = `nav.graph@${version}`;
      calls.push(validate(layout, writeAsset(dir, `level.nav${version}`, g.bytes).path));
      want.push({ what: `${layout}: the fixture level`, reply: { outcome: 'admitted', code: null, offset: null, field: null, trap: null } });
      cases(version).forEach((c, i) => {
        calls.push(validate(layout, writeAsset(dir, `case-${version}-${i}.nav`, mutate(g, c.field, c.write)).path));
        want.push({ what: `${layout}: ${c.name}`, reply: { outcome: 'refused', code: 'layout_refused', offset: offsetOf(g, c.field), field: c.field, trap: null } });
      });
    }
    const got = runShow(dir, calls).map(verdict).map((v) => ({ outcome: v.outcome, code: v.code, offset: v.offset, field: v.field, trap: v.trap }));
    const wrong = want.map((w, i) => ({ ...w, got: got[i] })).filter((w) => show(w.got) !== show(w.reply));
    expect(wrong, 'every case answered as expected (listed: the cases that weren\'t)').toEqual([]);
  }, LONG);

  it(`${ID} 10,000 seeded truncations and bit flips of the fixture level's nav.graph@2 each end refused or admitted, never in a trap or a crash, every refusal inside the asset`, () => {
    const dir = temp();
    const g = navGraph(2).bytes;
    const next = seeded(415);
    const calls: JsonObject[] = [];
    const made: { kind: 'truncation' | 'flip'; size: number; sha: string }[] = [];
    for (let i = 0; i < 10_000; i++) {
      let bytes: Buffer;
      let kind: 'truncation' | 'flip';
      if (i % 2 === 0) {
        kind = 'truncation';
        bytes = Buffer.from(g.subarray(0, Math.floor(next() * g.length)));
      } else {
        kind = 'flip';
        bytes = Buffer.from(g);
        const flips = 1 + Math.floor(next() * 3);
        for (let f = 0; f < flips; f++) {
          const bit = Math.floor(next() * g.length * 8);
          bytes.writeUInt8(bytes.readUInt8(bit >> 3) ^ (1 << (bit & 7)), bit >> 3);
        }
      }
      calls.push(validate('nav.graph@2', writeAsset(dir, `m${i}.nav`, bytes).path));
      made.push({ kind, size: bytes.length, sha: sha256(bytes) });
    }
    const replies = runShow(dir, calls).map(verdict);
    const bad = replies.map((v, i) => ({ i, ...made[i]!, v })).filter(({ kind, size, sha, v }) => {
      if (v.asset !== sha || v.trap !== null) return true;
      if (v.outcome === 'admitted') return kind === 'truncation' || v.offset !== null || v.field !== null;
      if (v.outcome !== 'refused' || v.code !== 'layout_refused') return true;
      return !(Number.isInteger(v.offset) && (v.offset as number) >= 0 && (v.offset as number) <= size && typeof v.field === 'string' && v.field !== '');
    });
    expect(bad.slice(0, 10).map((b) => ({ case: b.i, kind: b.kind, size: b.size, reply: b.v })), `${bad.length} of 10,000 mutations ended otherwise than refused (at an offset inside the asset, naming a field) or admitted (a truncation never), with no trap`).toEqual([]);
  }, LONG);

  it(`${ID} a planted validator that trusts the header's link count reads past the asset instead of refusing the count`, () => {
    const dir = temp();
    const calls: JsonObject[] = [];
    const graphs: Built[] = [];
    for (const version of [1, 2] as const) {
      const g = navGraph(version);
      graphs.push(g);
      calls.push(validate(`nav.graph@${version}`, writeAsset(dir, `huge-count.nav${version}`, mutate(g, 'header.link_count', (b, at) => b.writeUInt32LE(0x0fff_ffff, at))).path));
    }
    const shipped = runShow(dir, calls).map(verdict);
    const planted = runShow(dir, calls, 'nav_graph_trusts_link_count').map(verdict);
    graphs.forEach((g, i) => {
      const layout = `nav.graph@${i + 1}`;
      const s = shipped[i]!;
      expect({ outcome: s.outcome, offset: s.offset, field: s.field, trap: s.trap }, `${layout}: the shipped validator refuses the count, naming it`)
        .toEqual({ outcome: 'refused', offset: offsetOf(g, 'header.link_count'), field: 'header.link_count', trap: null });
      const p = planted[i]!;
      expect(p.field === 'header.link_count' && p.trap === null, `${layout}: the planted validator doesn't refuse the count: ${show(p)}`).toBe(false);
      expect(p.trap !== null || (typeof p.offset === 'number' && p.offset >= g.bytes.length),
        `${layout}: the planted validator reads past the asset (a trap, or a refusal at an offset past its ${g.bytes.length} bytes): ${show(p)}`).toBe(true);
    });
  }, LONG);
});

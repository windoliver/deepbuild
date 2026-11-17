// AC5 #192.59d34e71: "A dungeon provider writes a tile graph for a 40 × 40 floor from its seed as a data asset, a
// header of its width, height and node count, then its nodes and links; a logic item that names it among its data
// assets reads width 40 and height 40 from it at step 0; the same seed gives the same bytes on macOS arm64 and Linux
// x86_64, and another seed gives other bytes under another key"
//
// The pack test/dungeon@1.0.0 carries the provider dungeon.floor (programs.ts: the dungeon generator) writing its
// floor in the layout dungeon.tiles@1, which the pack declares with a validator and a malformed twin. Two boards,
// seeds A and B, each hold the logic item `reader`, which names {gen: dungeon.floor, params: {floor: 1, height: 40,
// width: 40}} among its data assets and writes `head`: the asset's length, width, height and node count. In one
// deep-show process: the pack installs; both boards are presented with no error; `provided` holds each board's
// asset, in dungeon.tiles@1, under its content key, its ID the sha256 of the bytes the program itself writes for that
// seed (run in Node's WebAssembly: 40 × 40, n rooms inside the floor, n links between rooms); the keys and the assets
// differ between the seeds; deep_query's logic read gives `reader.head` = [length, 40, 40, n] at step 0. Then
// deep-sandbox's `provide` runs the same provider with each seed on this Mac (arm64) and in a linux/amd64 container
// (x86_64): every host's bytes hash to the asset deep-show keeps for that seed.
//
// Wrong programs it fails on: an asset that isn't the program's bytes (params laid out another way, a seed not
// passed), a logic item that doesn't get the provider's asset before step 0, a key that leaves out the seed (one key
// for both seeds), and a host whose run gives other bytes.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ABOUT, DOC, dataOf, intParams, logicRead, onLinux, onMac, onMacOS, presented, provideCall, provided, providedBytes, providedInNode,
  providedRow, putEvidence, queryLogic, runShow, scenario, sha256, show, showDoc, installPack, str, useTemp, type JsonObject,
} from './helpers.ts';
import { DUNGEON_PARAMS, FLOOR_1, SEED_A, SEED_B, board, dungeonOut, dungeonPack, program, readerItem, tilesLayout } from './fixtures.ts';

const ID = '#192.59d34e71';
/** deep-show and deep-sandbox here, and deep-sandbox for Linux x86_64 under emulation: a cold run takes long. */
const TIMEOUT = 3 * 3_600_000;
const dir = useTemp();

/** What the criterion asks of a tile graph's bytes: a 40 × 40 header and its node count n, then n nodes and links. */
function tileGraphProblems(b: Buffer): string[] {
  if (b.length < 12) return [`${b.length} bytes, shorter than a header`];
  const n = b.readUInt32LE(8);
  const out: string[] = [];
  if (b.readUInt32LE(0) !== 40 || b.readUInt32LE(4) !== 40) out.push(`the header's width and height are ${b.readUInt32LE(0)} × ${b.readUInt32LE(4)}, not 40 × 40`);
  if (n < 1 || b.length !== 12 + 12 * n) return [...out, `node count ${n} in ${b.length} bytes: not n nodes of 8 bytes and n links of 4`];
  for (let i = 0; i < n; i++) {
    const [x, y, w, h] = [0, 2, 4, 6].map((k) => b.readUInt16LE(12 + 8 * i + k)) as [number, number, number, number];
    if (w < 1 || h < 1 || x + w > 40 || y + h > 40) out.push(`node ${i} (${x}, ${y}, ${w} × ${h}) isn't a room inside the floor`);
  }
  for (let j = 0; j < n; j++) {
    const [a, c] = [0, 2].map((k) => b.readUInt16LE(12 + 8 * n + 4 * j + k)) as [number, number];
    if (a >= n || c >= n) out.push(`link ${j} (${a}, ${c}) names no node`);
  }
  return out;
}

describe(`${ID} the dungeon provider's tile graph as a data asset`, () => {
  it(`${ID} a 40 × 40 floor's tile graph from the seed: read by a logic item at step 0, the same bytes on macOS arm64 and Linux x86_64, another seed's other bytes under another key`, () => {
    onMacOS(true);
    const root = dir();
    const evidence = join(root, 'evidence');
    mkdirSync(evidence, { recursive: true });
    const pack = dungeonPack(root, 'dungeon');
    putEvidence(evidence, program.reader().bytes);
    // The bytes the program itself writes for each seed: what the asset must be.
    const want = { A: providedInNode(program.dungeon(), BigInt(SEED_A), intParams(FLOOR_1)), B: providedInNode(program.dungeon(), BigInt(SEED_B), intParams(FLOOR_1)) };
    for (const [seed, b] of Object.entries(want)) expect(tileGraphProblems(b), `this suite's dungeon generator writes a 40 × 40 tile graph for seed ${seed} (a fixture fault, not the implementation's)`).toEqual([]);

    const docs = { A: DOC(1), B: DOC(2) };
    const boardOf = (seed: number): JsonObject => board('Dungeon floor', seed, [pack], { reader: readerItem('dungeon', FLOOR_1) }, ['logic']);
    const r = runShow(scenario(evidence, [docs.A, docs.B], [
      installPack(pack),
      showDoc(docs.A, boardOf(SEED_A)), showDoc(docs.B, boardOf(SEED_B)),
      provided(docs.A), provided(docs.B),
      queryLogic(docs.A, ['reader'], [0]), queryLogic(docs.B, ['reader'], [0]),
    ]));
    expect(r[0]!['outcome'], `test/dungeon@1.0.0 installs: ${show(r[0])}`).toBe('installed');
    presented(r[1]!, 'the board of seed A');
    presented(r[2]!, 'the board of seed B');

    const got = {} as Record<'A' | 'B', ReturnType<typeof dataOf>>;
    (['A', 'B'] as const).forEach((s, i) => {
      const row = providedRow(r[3 + i]!, 'reader', `provided (seed ${s})`);
      expect(row?.['provider'], `seed ${s}: reader's asset comes from the provider dungeon.floor: ${show(r[3 + i])}`).toBe('dungeon.floor');
      const d = dataOf(row, `seed ${s}: reader's asset`);
      expect(d.layout, `seed ${s}: the asset is in the layout ${tilesLayout('dungeon')}`).toBe(tilesLayout('dungeon'));
      expect(d.key, `seed ${s}: the asset's content key`).toMatch(/^[0-9a-f]{64}$/);
      expect(d.asset, `seed ${s}: the asset is the bytes the program writes for its seed: a 40 × 40 header, its node count, its nodes and links (${want[s].length} bytes)`).toBe(sha256(want[s]));
      expect(d.size, `seed ${s}: the asset's size`).toBe(want[s].length);
      got[s] = d;

      const read = logicRead(r[5 + i]!, 'reader', `seed ${s}: deep_query's logic read`);
      expect(read.trap, `seed ${s}: reader runs step 0 without a trap`).toBeNull();
      expect(read.steps.get(0)?.arrays['reader.head'], `seed ${s}: reader reads the asset's length, width 40, height 40 and node count at step 0`)
        .toEqual([want[s].length, 40, 40, want[s].readUInt32LE(8)]);
    });
    expect(got.B.key, 'another seed gives another content key').not.toBe(got.A.key);
    expect(got.B.asset, 'another seed gives other bytes').not.toBe(got.A.asset);

    // The same seed on two machines: the sandbox module's runner on this Mac and on Linux x86_64.
    const provider: JsonObject = { program: program.dungeon().b64, params: DUNGEON_PARAMS, out: dungeonOut('dungeon') };
    const calls = [ABOUT, provideCall(provider, FLOOR_1, SEED_A), provideCall(provider, FLOOR_1, SEED_B)];
    const hosts = [{ name: 'macOS arm64', arch: 'aarch64', os: 'macos', replies: onMac(calls) }, { name: 'Linux x86_64', arch: 'x86_64', os: 'linux', replies: onLinux(calls) }];
    for (const h of hosts) {
      expect([str(h.replies[0]!['arch'], `${h.name}: about.arch`), str(h.replies[0]!['os'], `${h.name}: about.os`)], `${h.name}: the runner reports its host`).toEqual([h.arch, h.os]);
      (['A', 'B'] as const).forEach((s, i) => {
        const bytes = providedBytes(h.replies[1 + i]!, `${h.name}, seed ${s}`);
        expect(sha256(bytes), `${h.name}, seed ${s}: the provider's bytes are those deep-show keeps as the asset for seed ${s}`).toBe(got[s].asset);
      });
    }
  }, TIMEOUT);
});

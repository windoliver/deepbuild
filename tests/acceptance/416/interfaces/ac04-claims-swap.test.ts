// Criterion 4 (no upstream test): "A claim that rests on an interface from an outside pack the working agent wrote stays
// INCONCLUSIVE with one ask, as its own checks do, while the same interface installed from a first-party pack counts;
// and swapping one fsm@1 library for another links the program again, reruns exactly fsm@1's fixtures, and changes the
// bake key and deep_query's library hash, while a piece that links neither keeps its own; and a planted resolver that
// lets an outside pack's interface bind every claim passes the agent's claim and fails, naming the interface"
//
// Through `deep-logic claim`, `check`, `query` and `bake` (README: The surface). "The same interface" is fsm@1's entry
// (exports, fixtures, planted library, digest) copied into `mine@1.0.0`, a pack the working agent wrote (origin agent),
// where it is `mine.fsm@1`. The library is fsm_table@1 from an installed pack in both claims, so only where the
// interface comes from differs. The swap: the door program, importing fsm@1's functions as `lib:fsm@1`, links
// fsm_table@1 (doors@1.0.0), then fsm_switch@1 (doors@1.0.1), beside a brain item linking mlp@1 (nn.mlp@1) that stays;
// `plain`, a counter that links nothing, is baked beside each. `outside_interface_binds_all` is the planted resolver.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, admitted, arr, bakeCall, bakeOf, checkCall, logicBin, obj, onHost, prebuild, queriedOf, queryCall, show, type JsonObject } from '../../190/helpers.ts';
import { AC, claimCall, countLayout, doorItem, firstParty, fsmLib, interfaceRuns, netItem, nnLib, onHostPlanted, pack, piece, type PackSpec } from './helpers.ts';
import { COUNT_WRITES, counter, f32Bytes, netBytes, ownNet } from './programs.ts';

prebuild(() => { logicBin(); });

/** The two claims: fsm_table@1 implements mine.fsm@1 (the agent's copy) and fsm@1 (the first-party pack's). */
function claims(): JsonObject[] {
  const fp = firstParty();
  const fsm = fp.iface('fsm@1');
  const mine = pack('mine', [], '1.0.0', 'agent', { 'fsm@1': { exports: fsm.exports, ...(fsm.layout ? { layout: fsm.layout } : {}), fixtures: fsm.fixtures, planted: fsm.planted, digest: fsm.digest } });
  const outside = fsmLib('table', ['mine.fsm@1']);
  const counted = fsmLib('table', ['fsm@1']);
  return [
    claimCall(piece(4161, { door: doorItem('lib:fsm_table', [outside]) }, [mine, pack('doors', [outside], '1.0.0')], fp.assets), 'fsm_table@1', 'mine.fsm@1'),
    claimCall(piece(4161, { door: doorItem('lib:fsm_table', [counted]) }, [pack('doors', [counted], '1.0.1')], fp.assets), 'fsm_table@1', 'fsm@1'),
  ];
}
/** The criterion over the two claims' replies, each failure naming the interface it rests on. */
function judge([own, counted]: JsonObject[]): string[] {
  const failures: string[] = [];
  const asks = Array.isArray(own!['asks']) ? own!['asks'] : [];
  const ask = asks[0];
  if (own!['ok'] !== true || own!['verdict'] !== 'INCONCLUSIVE') failures.push(`interface mine.fsm@1, from mine@1.0.0, which the working agent wrote, decided the claim: ${show(own)}`);
  else if (asks.length !== 1 || !ask || typeof ask !== 'object' || Array.isArray(ask) || ask['kind'] !== 'approval' || ask['interface'] !== 'mine.fsm@1') failures.push(`the claim resting on interface mine.fsm@1 isn't INCONCLUSIVE with one approval ask naming it: ${show(own)}`);
  if (counted!['ok'] !== true || counted!['verdict'] !== 'PASS' || JSON.stringify(counted!['asks']) !== '[]') failures.push(`interface fsm@1, from a first-party pack, doesn't count for the claim: ${show(counted)}`);
  return failures;
}

describe(`${AC[4]} an outside pack's interface binds only its author's claims, and swapping a library by interface keeps the rest`, () => {
  it(`${AC[4]} a claim resting on an interface from a pack the working agent wrote stays INCONCLUSIVE with one ask, while the same interface from a first-party pack counts`, () => {
    const calls = claims();
    const failures = judge(onHost(calls));
    expect(failures, `the claims:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[4]} a planted resolver that lets an outside pack's interface bind every claim (outside_interface_binds_all) passes the agent's claim and fails, naming the interface`, () => {
    const replies = onHostPlanted(claims(), ['outside_interface_binds_all']);
    expect([replies[0]!['verdict'], replies[0]!['asks']], `the planted resolver passes the agent's claim: ${show(replies[0])}`).toEqual(['PASS', []]);
    const failures = judge(replies);
    expect(failures.length === 1 && failures[0]!.includes('mine.fsm@1'), `the criterion fails, naming the interface: ${failures.join('; ')}`).toBe(true);
  }, TIMEOUT);

  it(`${AC[4]} swapping one fsm@1 library for another links the program again, reruns exactly fsm@1's fixtures and changes the bake key and deep_query's library hash, while a piece that links neither keeps its own`, () => {
    const fp = firstParty();
    const fsm = fp.iface('fsm@1');
    const brain = nnLib();
    const own = ownNet();
    const net = netBytes(own.net), input = f32Bytes(own.input);
    const swapped = (lib: ReturnType<typeof fsmLib>, version: string): { door: JsonObject; plain: JsonObject } => {
      const packs: PackSpec[] = [pack('doors', [lib], version), pack('nets', [brain])];
      return {
        door: piece(4162, { door: doorItem('lib:fsm@1', [lib]), brain: netItem('lib:nn.mlp@1', net, input, 2, [brain]) }, packs, fp.assets),
        plain: piece(4163, { plain: { program: counter(countLayout()), writes: COUNT_WRITES } }, packs),
      };
    };
    const a = fsmLib('table'), b = fsmLib('switch');
    const before = swapped(a, '1.0.0'), after = swapped(b, '1.0.1');
    const [ca, cb, qa, qb, ba, bb, pa, pb] = onHost([
      checkCall(before.door), checkCall(after.door), queryCall(before.door), queryCall(after.door),
      bakeCall(before.door, 60), bakeCall(after.door, 60), bakeCall(before.plain, 30), bakeCall(after.plain, 30),
    ]);
    const ra = admitted(ca!, 'check before the swap'), rb = admitted(cb!, 'check after the swap');
    expect(rb['door']!.program, 'the same program').toBe(ra['door']!.program);
    expect(rb['door']!.libraries.map((l) => [l.name, l.hash]), 'links fsm_switch@1 in place of fsm_table@1').toEqual([['fsm_switch@1', b.program.sha]]);
    expect(rb['door']!.linked?.sha256, 'the program is linked again: its merged module differs').not.toBe(ra['door']!.linked?.sha256);
    // Exactly fsm@1's fixtures run again: all of them, on fsm_switch@1; nn.mlp@1's, on the unchanged mlp@1, don't.
    const ranAfter = (c: JsonObject): string[] => Object.entries(obj(c['items'], 'items')).flatMap(([item, receipt]) =>
      arr(obj(receipt, item)['libraries'], `${item}.libraries`).flatMap((l) => {
        const name = String(obj(l, 'a library')['name']);
        return Object.entries(interfaceRuns(c, item, name)).flatMap(([iface, runs]) => runs.filter((r) => r.ran).map((r) => `${item} ${name} ${iface} ${r.fixture} ${r.verdict}`));
      }));
    expect(ranAfter(cb!).sort(), 'after the swap, the fixtures run are exactly fsm@1\'s, on fsm_switch@1, and they pass').toEqual(fsm.fixtures.map((f) => `door fsm_switch@1 fsm@1 ${f} PASS`).sort());
    expect(ranAfter(ca!).filter((r) => r.startsWith('brain ')).length, 'nn.mlp@1\'s fixtures had run on mlp@1 before the swap').toBeGreaterThan(0);
    const keyA = bakeOf(ba!, 'the bake before the swap').keys['door'], keyB = bakeOf(bb!, 'the bake after the swap').keys['door'];
    expect(keyB, 'the swap changes the door\'s bake key').not.toBe(keyA);
    const rowA = queriedOf(qa!, 'deep_query before the swap')['door'], rowB = queriedOf(qb!, 'deep_query after the swap')['door'];
    expect([rowA?.libraries, rowB?.libraries], 'and deep_query\'s library hash').toEqual([[{ name: 'fsm_table@1', hash: a.program.sha }], [{ name: 'fsm_switch@1', hash: b.program.sha }]]);
    const x = bakeOf(pa!, 'the plain piece beside doors@1.0.0'), y = bakeOf(pb!, 'the plain piece beside doors@1.0.1');
    expect([y.items?.['plain']?.hash, y.keys['plain']], 'a piece that links neither keeps its rewritten program hash and bake key').toEqual([x.items?.['plain']?.hash, x.keys['plain']]);
  }, TIMEOUT);
});

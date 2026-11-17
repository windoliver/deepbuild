// Criterion 2 (no upstream test): "fsm@1's fixture, a three-state door (closed, opening, open) fed open at step 10 and
// a 30-step timer, expects state open from step 40; a library that implements it links, and the interface's own planted
// library, which takes the timer from the step it was read rather than the step it was armed, reaches open at step 41
// and must fail; an outside pack whose fsm-like interface ships a planted library that passes every fixture is
// refused, naming the interface"
//
// Through `deep-logic first_party`, `check`, `bake` and `pack_check` (README: The surface). The door's states are worked
// here from fsm@1's rule (programs.ts: fsmRun): closed before step 10, opening from 10, open from 10 + 30 = 40; the
// planted rule arms the timer at step 11, the first step that reads it, so 41. `fsm_table@1` is this suite's fsm@1
// library. The interface's planted library is the first-party pack's own asset, read through `first_party`; carried as
// a library of its own (`planted_fsm@1`, implementing nothing) with the door worked by the planted rule as its fixture,
// it links and its states are read; claiming fsm@1 it is refused. The outside pack doorlike declares `door@1` with
// fsm@1's exports, fixtures and digest, and a planted library that is fsm_table@1, which passes every fixture.
import { describe, expect, it } from 'vitest';
import { TIMEOUT, admitted, bakeCall, bakeOf, checkCall, int, logicBin, onHost, prebuild, refusedOf, show } from '../../190/helpers.ts';
import { AC, byName, doorItem, expectedAt, firstParty, fixturePiece, fsmLib, interfaceRuns, pack, packCheckCall, piece, plantedFsm, refusalWhere, type Interface } from './helpers.ts';
import { CLOSED, DOOR_STEPS, FSM_EXPORTS, OPEN, OPENING, doorRun } from './programs.ts';

prebuild(() => { logicBin(); });

/** fsm@1 and its door fixture, which expects the door's states by fsm@1's rule, opening at 39 and open at 40. */
function door() {
  const honest = doorRun(DOOR_STEPS);
  expect([honest[9], honest[10], honest[39], honest[40]], 'by fsm@1\'s rule the door is closed at 9, opening at 10 and 39, open at 40').toEqual([CLOSED, OPENING, OPENING, OPEN]);
  expect(honest.slice(40).every((s) => s === OPEN), 'and open from step 40 on').toBe(true);
  const fp = firstParty();
  const iface = fp.iface('fsm@1');
  expect(byName(iface.exports), 'fsm@1 declares the exports README: The surface gives it').toEqual(byName(FSM_EXPORTS));
  const fixture = fp.fixture(iface, 'door');
  expect(fixture.tolerance, 'the door fixture compares exactly').toBe('exact');
  const expected = expectedAt(fixture, 'state');
  expect(expected.map(([k]) => k), 'it expects the state at steps 39 and 40').toEqual(expect.arrayContaining([39, 40]));
  for (const [k, values] of expected) expect(values, `at step ${k} it expects the door's state by fsm@1's rule`).toEqual([doorRun(k + 1)[k]]);
  expect(iface.planted.length, 'fsm@1 ships a planted library').toBeGreaterThan(0);
  return { fp, iface, fixture };
}

describe(`${AC[2]} fsm@1's door fixture holds a state machine library to its timer rule`, () => {
  it(`${AC[2]} the door fixture expects state open from step 40, and a library that implements fsm@1 links and opens the door at step 40`, () => {
    const { fp, iface, fixture } = door();
    const lib = fsmLib('table');
    const p = fixturePiece(fixture, lib, [pack('doors', [lib])], fp.assets);
    const [check, bake] = onHost([checkCall(p), bakeCall(p, fixture.steps, fixture.track as never)]);
    const receipt = admitted(check!, 'check of the door fixture\'s item linking fsm_table@1')['fixture']!;
    expect(receipt.libraries.map((l) => [l.name, l.hash]), 'fsm_table@1 links').toEqual([['fsm_table@1', lib.program.sha]]);
    const runs = interfaceRuns(check!, 'fixture', 'fsm_table@1')['fsm@1'];
    expect(runs?.map((r) => [r.fixture, r.verdict]).sort(), 'every fixture of fsm@1 ran on it and passed').toEqual(iface.fixtures.map((f) => [f, 'PASS']).sort());
    const b = bakeOf(bake!, 'the door fixture\'s bake');
    const states = b.steps.map((s) => int(s.arrays['fixture.state']?.[0], `the state at step ${s.step}`));
    expect(states.slice(0, 41), 'the door is opening at step 39 and open at step 40, as fsm@1\'s rule gives').toEqual(doorRun(41));
    expect(states.slice(40).every((s) => s === OPEN), 'and open from step 40 on').toBe(true);
  }, TIMEOUT);

  it(`${AC[2]} the interface's own planted library, which takes the timer from the step it was read, reaches open at step 41 and must fail`, () => {
    const { fp, iface, fixture } = door();
    const lazy = doorRun(DOOR_STEPS, true);
    expect([lazy[40], lazy[41]], 'by the planted rule the door is still opening at step 40 and open at 41').toEqual([OPENING, OPEN]);
    // Each planted library of fsm@1, as a library of its own: the one whose door opens at 41 is the timer's.
    const found = iface.planted.map((id) => {
      const own = plantedFsm(fp.program(id));
      const [reply] = onHost([bakeCall(piece(410, { door: doorItem('lib:planted_fsm', [own]) }, [pack('plants', [own])], fp.assets), DOOR_STEPS)]);
      if (reply!['ok'] !== true) return { id, states: null, reply };
      return { id, states: bakeOf(reply!, `the door on planted library ${id}`).steps.map((s) => int(s.arrays['door.state']?.[0], 'state')), reply };
    });
    const timer = found.find((f) => f.states !== null && f.states.join() === lazy.join());
    expect(timer, `a planted library of fsm@1 opens the door at step 41, not 40: ${show(found.map((f) => ({ id: f.id, states: f.states, reply: f.states ? 'ok' : f.reply })) as never)}`).toBeDefined();
    expect([timer!.states![40], timer!.states![41]], 'it reaches open at step 41').toEqual([OPENING, OPEN]);
    const claiming = plantedFsm(fp.program(timer!.id), ['fsm@1']);
    const [reply] = onHost([checkCall(fixturePiece(fixture, claiming, [pack('plants', [claiming], '1.0.1')], fp.assets))]);
    const r = refusedOf(reply!, 'check of the door fixture\'s item linking the planted library as fsm@1');
    expect([r.code, r.item], 'it fails: refused at link, naming the item').toEqual(['link_refused', 'fixture']);
    const named = refusalWhere(r.refusals, (x) => x['interface'] === 'fsm@1' && x['fixture'] === fixture.id, 'a refusal names fsm@1 and the door fixture');
    expect([named['array'], named['step'], named['expected'], named['actual']], 'it names the state array at step 40: open expected, opening found').toEqual(['state', 40, OPEN, OPENING]);
  }, TIMEOUT);

  it(`${AC[2]} an outside pack whose fsm-like interface ships a planted library that passes every fixture is refused, naming the interface`, () => {
    const { fp, iface } = door();
    const passing = fsmLib('table');
    const like = (planted: string[]): Interface => ({ exports: iface.exports, ...(iface.layout ? { layout: iface.layout } : {}), fixtures: iface.fixtures, planted, digest: iface.digest });
    const carried = { ...fp.assets, [passing.program.sha]: passing.program.b64 };
    const [refused, sound] = onHost([
      packCheckCall(pack('doorlike', [], '1.0.0', 'installed', { 'door@1': like([passing.program.sha]) }), carried),
      packCheckCall(pack('doorlike', [], '1.0.1', 'installed', { 'door@1': like(iface.planted) }), carried),
    ]);
    const r = refusedOf(refused!, 'the pack check of doorlike@1.0.0');
    expect([r.code, r.pack], 'the pack is refused, naming it').toEqual(['pack_refused', 'doorlike@1.0.0']);
    const named = refusalWhere(r.refusals, (x) => x['interface'] === 'door@1' || x['interface'] === 'doorlike.door@1', 'a refusal names the interface door@1');
    expect(named['planted'], 'and the planted library that passes every fixture').toBe(passing.program.sha);
    expect([sound!['ok'], sound!['installed'], sound!['pack']], `the same interface whose planted library fails installs: ${show(sound)}`).toEqual([true, true, 'doorlike@1.0.1']);
  }, TIMEOUT);
});

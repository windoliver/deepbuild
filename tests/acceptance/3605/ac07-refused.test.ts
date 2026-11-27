// AC7 #3605.50677298: "A control that sets `custom.volts` on a shell that declares only `mains` is refused at check
// with `shell.setting`, naming the control. A level whose logic reads `<shell ID>.custom` by path is still refused with
// `shell.reads`, naming the level and the array."
//
// Two planted documents through shell.journeys' `layout` journey (the cheapest: one play) with keys at the reference
// window, each of which the shell's check refuses, so the journey fails with the refusal's code ("A shell its check
// refuses fails every journey with the refusal's code"): `setsVolts`, whose settings screen also holds volts_choice
// (`does: {set: custom.volts}`), fails with a failure starting `shell.setting` that names volts_choice; `readsCustom`,
// whose level 2 (earthing) reads `game.custom` by path, fails with a failure starting `shell.reads` that names level 2
// (earthing, or "level 3" as the shell counts) and `game.custom`. The replica's own reply says the same in `refused`.
// The wrong programs: the base (it refuses custom.volts as `shell.control`, since it has no custom settings), a check
// that takes an undeclared name as 0, and a shell that lets a level read its custom array.
import { describe, expect, it } from 'vitest';
import { AC, DOC, TIMEOUT, failed, failuresOf, hubOnce, journeysInput, macOnly, namesLevel, onePlay, putShell, rest, runJourneys, show, shown, word } from './helpers.ts';
import { LEVEL_NAMES, READS_CUSTOM_LEVEL, SHELL_ID, allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();

describe(`${AC[7]} a control that sets an undeclared name is refused with shell.setting; a level that reads the shell's custom array with shell.reads`, () => {
  it(`${AC[7]} custom.volts on a shell that declares only mains is refused with shell.setting naming volts_choice, and a level reading game.custom with shell.reads naming the level and the array`, async () => {
    macOnly();
    const p = programs();
    const h = await hub();
    const volts = putShell(DOC.setsVolts, shellDocument(p, { setsVolts: true }), allPrograms(p));
    const r1 = await runJourneys(h, journeysInput(volts, { journeys: ['layout'] }));
    failed(r1, 'the shell whose control sets custom.volts');
    const setting = failuresOf(r1, 'shell.setting').map((f) => rest(f.message, 'shell.setting'));
    expect(setting.some((m) => word('volts_choice').test(m)), `a failure starting shell.setting names volts_choice: ${shown(r1)}`).toBe(true);
    const refused1 = onePlay(h.pool, volts, 'layout', 'keys', 'the custom.volts shell').refused;
    expect(refused1?.code, `the replica refuses the shell at check with shell.setting: ${show(refused1)}`).toBe('shell.setting');

    const reads = putShell(DOC.readsCustom, shellDocument(p, { readsCustom: true }), allPrograms(p));
    const r2 = await runJourneys(h, journeysInput(reads, { journeys: ['layout'] }));
    failed(r2, 'the shell whose level reads game.custom');
    const array = `${SHELL_ID}.custom`;
    const read = failuresOf(r2, 'shell.reads').map((f) => rest(f.message, 'shell.reads'));
    expect(read.some((m) => namesLevel(m, READS_CUSTOM_LEVEL, LEVEL_NAMES[READS_CUSTOM_LEVEL]) && m.includes(array)),
      `a failure starting shell.reads names level ${READS_CUSTOM_LEVEL} (${LEVEL_NAMES[READS_CUSTOM_LEVEL]}) and ${array}: ${shown(r2)}`).toBe(true);
  }, TIMEOUT);
});

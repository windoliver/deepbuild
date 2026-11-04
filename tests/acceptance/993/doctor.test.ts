// AC1 #993.8355427d: with the deep-hook program removed after setup, `deep doctor` fails `claude.hooks` with
// `hook_program_missing`, naming the entry and the path; on the merge base it reports healthy and the test fails.
//
// DeepBuild is set up by `deep setup` from a copy of this checkout (README: The copy of the checkout), so its entries
// in Claude Code's settings run the copy's deep-hook, which the test may remove. The doctor first runs with the
// program there (the twin: no hook_program_missing), then with it gone, then with it there but not executable (the
// issue's scope: "gone or not executable").

import { chmodSync, existsSync, rmSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, cleanup, doctor, doctorCodes, entriesRunning, itemsShown, itemText, makeHome, setUp, shown, type DoctorItem, type Home } from './helpers.ts';

afterAll(cleanup, 60_000);

const CODE = 'hook_program_missing';
/** The command a fix names: `deep setup`, as written, up to the end of its clause. */
const fixCommand = (fix: string): string | undefined => /`(deep setup[^`]*)`/.exec(fix)?.[1] ?? /\b(deep setup(?: --?[a-z][\w-]*)*)/.exec(fix)?.[1];

/** The doctor's claude.hooks items, and its verdict on the hook program, once the program is in `state`. */
async function brokenProgram(h: Home, state: string): Promise<void> {
  const program = h.copy.deepHook;
  const entries = entriesRunning(h, program);
  const d = await doctor(h);
  const hooks = d.items.filter((i) => i.item === 'claude.hooks');
  const missing = hooks.filter((i) => i.code === CODE);
  expect(missing.length, `${AC1} with the deep-hook program ${state} (${program}), deep doctor must fail claude.hooks with ${CODE}; its claude.hooks items were:\n${itemsShown(hooks)}\n${shown(d.ran)}`).toBeGreaterThan(0);
  expect(doctorCodes(), `${AC1} ${CODE} is a code of the doctor family, listed in doctor.item@1`).toContain(CODE);
  expect(missing.every((i) => i.level === 'fail' && i.agent === 'claude-code'), `${AC1} ${CODE} is a failed claude-code item: ${itemsShown(missing)}`).toBe(true);
  const text = missing.map(itemText).join(' ');
  expect(text, `${AC1} the item must name the path of the program the entries run, ${program}: ${itemsShown(missing)}`).toContain(program);
  const named = entries.filter((e) => text.includes(e.event) || text.includes(e.command));
  expect(named.map((e) => e.event), `${AC1} the item must name the entry that runs the program (one of ${entries.map((e) => e.event).join(', ')}, or its command): ${itemsShown(missing)}`).not.toEqual([]);
  const fix = missing.map((i: DoctorItem) => fixCommand(i.fix)).find((c) => c !== undefined);
  expect(fix, `${AC1} the fix must be \`deep setup\`: ${itemsShown(missing)}`).toBeDefined();
  expect(fix, `${AC1} the fix is setup, never its undo`).not.toMatch(/--undo/);
  expect(d.ran.code, `${AC1} deep doctor exits 1 with a failed item: ${shown(d.ran)}`).toBe(1);
}

describe(`${AC1} deep doctor checks the program each DeepBuild hook entry runs`, () => {
  it(`${AC1} with the deep-hook program removed after setup, deep doctor fails claude.hooks with ${CODE}, naming the entry and the path, with deep setup as the fix`, async () => {
    const h = await makeHome();
    await setUp(h);
    expect(entriesRunning(h, h.copy.deepHook).length, 'setup wrote entries that run the copy\'s deep-hook').toBeGreaterThan(0);

    // The twin: the program is there, so nothing reads it missing.
    const before = await doctor(h);
    expect(before.items.filter((i) => i.code === CODE), `${AC1} with the program in place, no item reads ${CODE}: ${shown(before.ran)}`).toEqual([]);
    expect(before.items.some((i) => i.item === 'claude.hooks'), `${AC1} deep doctor lists claude.hooks: ${shown(before.ran)}`).toBe(true);

    rmSync(h.copy.deepHook);
    expect(existsSync(h.copy.deepHook), 'the program is gone').toBe(false);
    await brokenProgram(h, 'removed');
  }, 600_000);

  it(`${AC1} with the deep-hook program there but not executable, deep doctor fails claude.hooks with ${CODE} the same way`, async () => {
    const h = await makeHome();
    await setUp(h);
    chmodSync(h.copy.deepHook, 0o644);
    await brokenProgram(h, 'not executable');
  }, 600_000);
});

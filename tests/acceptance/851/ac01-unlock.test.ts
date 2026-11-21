// AC1 #851.9ac2fbcf: "A fixture game shell with a title, settings, a level select over three levels, pause, game over
// and credits plays in a replica: the title's Start enters level 1; completing level 1 unlocks level 2 in the level
// select; a planted shell that unlocks every level at start fails the unlock journey, naming level 3"
//
// The fixture shell (shell.ts) through the playtest plug-in's shell.journeys in a hub whose replica is deep-drive's
// play mode, with keys at the reference window. Its title_to_level and unlock journeys pass, and the replica's rows
// show it: title_to_level starts on the title and the first level it loads is level 1 (index 0), entered from the
// title with no other screen shown first; in the unlock run only level 1 is open until level 1 has played, the first
// screen after the step level 2 opens is the level select with [true, true, false], and level 3 opens only after level
// 2 has played. The twin whose `unlocked` is [0, 1, 2] starts with all three open, and its unlock journey fails
// shell.unlock, naming level 3 (its `name`).
// The wrong programs: the base (no shell.journeys), a shell that unlocks on entering a level rather than completing it,
// and a journey that reads only the end state.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, REFERENCE, TIMEOUT, devicePlays, failuresOf, hubOnce, journeysInput, macOnly, none, passed, putShell, rest, runJourneys, shown, stepped, word,
} from './helpers.ts';
import { LEVEL_NAMES, allPrograms, programs, shellDocument } from './shell.ts';

const hub = hubOnce();
const keysAtReference = { devices: ['keys' as const], sizes: [REFERENCE] };

describe(`${AC[1]} the fixture shell plays in a replica, and a shell that unlocks every level at start fails the unlock journey`, () => {
  it(`${AC[1]} the title's Start enters level 1, and completing level 1 unlocks level 2 in the level select`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.shell, shellDocument(p), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['title_to_level', 'unlock'], ...keysAtReference }));
    passed(result, 'the fixture shell\'s title_to_level and unlock journeys with keys');
    const gaps: string[] = [];

    const toLevel = stepped(devicePlays(h.pool, piece, 'title_to_level', ['keys'], REFERENCE).get('keys')![0]!, 'title_to_level');
    if (toLevel[0]!.screen !== 'title') gaps.push(`title_to_level starts on ${String(toLevel[0]!.screen)}, not the title`);
    const entered = toLevel.findIndex((r) => r.level >= 0);
    if (entered < 0) gaps.push('title_to_level never loads a level');
    else {
      if (toLevel[entered]!.level !== 0) gaps.push(`the first level title_to_level loads is index ${toLevel[entered]!.level}, not level 1 (index 0)`);
      const before = new Set(toLevel.slice(0, entered).map((r) => r.screen).filter((s) => s !== null));
      if ([...before].join() !== 'title') gaps.push(`before level 1 loads, title_to_level shows ${[...before].join(', ')}, not the title alone`);
    }

    const unlock = stepped(devicePlays(h.pool, piece, 'unlock', ['keys'], REFERENCE).get('keys')![0]!, 'unlock');
    const was = (r: { unlocked: boolean[] }): string => JSON.stringify(r.unlocked);
    if (was(unlock[0]!) !== '[true,false,false]') gaps.push(`the unlock run starts with ${was(unlock[0]!)} open, not [true,false,false]`);
    const opens2 = unlock.findIndex((r) => r.unlocked[1] === true);
    if (opens2 < 0) gaps.push('level 2 never opens in the unlock run');
    else {
      if (!unlock.slice(0, opens2).some((r) => r.level === 0)) gaps.push(`level 2 opens at step ${unlock[opens2]!.step}, before level 1 has played`);
      if (unlock.slice(0, opens2).some((r) => r.level === 1 || r.level === 2)) gaps.push('a level other than level 1 loads before level 2 opens');
      const next = unlock.slice(opens2).find((r) => r.screen !== null);
      if (next?.screen !== 'levels' || was(next) !== '[true,true,false]') gaps.push(`after level 1 is completed the first screen is ${String(next?.screen)} with ${next ? was(next) : 'nothing'}, not the level select with [true,true,false]`);
    }
    const opens3 = unlock.findIndex((r) => r.unlocked[2] === true);
    if (opens3 >= 0 && !unlock.slice(0, opens3).some((r) => r.level === 1)) gaps.push(`level 3 opens at step ${unlock[opens3]!.step}, before level 2 has played`);
    none(gaps, 'the replica\'s rows of title_to_level and unlock');
  }, TIMEOUT);

  it(`${AC[1]} a planted shell that unlocks every level at start fails the unlock journey with shell.unlock, naming level 3`, async () => {
    macOnly();
    const h = await hub();
    const p = programs();
    const piece = putShell(DOC.unlockAll, shellDocument(p, { unlockAll: true }), allPrograms(p));
    const result = await runJourneys(h, journeysInput(piece, { journeys: ['unlock'], ...keysAtReference }));
    const first = stepped(devicePlays(h.pool, piece, 'unlock', ['keys'], REFERENCE).get('keys')![0]!, 'the twin\'s unlock')[0]!;
    expect(first.unlocked, 'the twin starts with every level open').toEqual([true, true, true]);
    expect(result.outcome, `the twin's unlock journey fails: ${shown(result)}`).toBe('failed');
    const f = failuresOf(result, 'shell.unlock');
    expect(f.length, `a failure starting shell.unlock (${shown(result)})`).toBeGreaterThan(0);
    expect(f.some((x) => word(LEVEL_NAMES[2]).test(rest(x.message, 'shell.unlock'))), `a shell.unlock failure names ${LEVEL_NAMES[2]}: ${shown(result)}`).toBe(true);
  }, TIMEOUT);
});

// #2573: a hub told to stop just after its start, whose exit is then held 10 s. Through a real dev hub
// (`deep hub run --root`), the `hub.stop` call on its socket, the exit code of its process and its logs/hub.log.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, CLOSED, ended, play, runHub, world, type Ended } from './helpers.ts';

afterEach(cleanup);

/** The issue's hold: the stopping hub's exit held 10 s. */
const HOLD_MS = 10_000;
/** The issue's late stop: 20 s after the start. */
const LATE_MS = 20_000;
/** How often the early scene is played: (1/4)^4 = 1/256 that a broken hub passes every play (README, The arithmetic). */
const PLAYS = 4;

const closedLines = (end: Ended) => end.log.split('\n').filter((l) => l.includes(CLOSED));
const told = (ends: Ended[]) => ends.map((e, i) => `play ${i + 1}: exit ${e.code ?? e.signal}, ${closedLines(e).length} log lines with "${CLOSED}"`).join('; ');

describe('a hub whose exit is held after hub.stop', () => {
  it(`#2573.ac0329fc stopped as soon as it answers after its start and held 10 s, it ends with exit 0 and a log without "${CLOSED}" (${PLAYS} plays)`, async () => {
    const ends: Ended[] = [];
    for (let i = 0; i < PLAYS; i++) ends.push(await play('early', HOLD_MS));
    for (const end of ends) expect(end.heldMs, 'BLOCKED: the hold let go early').toBeGreaterThanOrEqual(HOLD_MS);
    expect.soft(ends.map((e) => e.code), `the exit code of each hub stopped just after its start and held ${HOLD_MS / 1000} s (${told(ends)})`).toEqual(ends.map(() => 0));
    expect.soft(ends.flatMap(closedLines), `the hub.log lines that read the closed record (${told(ends)})`).toEqual([]);
  }, PLAYS * 120_000);

  it(`#2573.ac0329fc control: stopped ${LATE_MS / 1000} s after its start, once it reported ready, and held the same way, it ends with exit 0 and a clean log`, async () => {
    const end = await play('late', HOLD_MS, LATE_MS);
    expect(end.heldMs, 'BLOCKED: the hold let go early').toBeGreaterThanOrEqual(HOLD_MS);
    expect(end.code, `the hold alone ends a hub with exit 0 (${told([end])})`).toBe(0);
    expect(closedLines(end), 'the hold alone leaves no read of the closed record in hub.log').toEqual([]);
    expect(end.log, 'and no core failure').not.toContain('the core stopped');
  }, 300_000);
});

describe('a core that stops by a real failure', () => {
  it('#2573.4982dfe8 a core that cannot open its evidence store ends the hub with exit 1 and "deep hub: the core stopped"', async () => {
    const w = world();
    // The real failure: the root's evidence folder is a file, so the core's start can't make its store there.
    writeFileSync(join(w.root, 'evidence'), 'a file where the evidence folder goes\n');
    const end = await ended(runHub(w), 120_000);
    const log = readFileSync(w.log, 'utf8');
    expect(end, `BLOCKED: the hub was still running after 120 s:\n${log}`).toBeDefined();
    expect(end!.code, `the hub's exit code after its core failed:\n${log}`).toBe(1);
    expect(log, 'hub.log names the core as what stopped').toMatch(/^deep hub: the core stopped: .*evidence/m);
  }, 180_000);
});

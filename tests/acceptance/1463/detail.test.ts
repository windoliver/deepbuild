// AC9 #1463.03f69be1: with ten finished sessions of 30 calls each and two open asks, the last line of `deep status` is
// the count sentence and the output is under 40 lines. On the merge base it's over 200 lines and ends on a tool call.
// The sessions' hooks go through the hub as an agent's would, so their calls and stops are the adapter's own events.
import { afterAll, describe, expect, test } from 'vitest';
import { cleanup, deep, endFailures, ID, makeWorld, shown, type SessionSpec } from './helpers.ts';

afterAll(cleanup, 60_000);

const SPECS: SessionSpec[] = [
  ...Array.from({ length: 10 }, (_, n): SessionSpec => ({ key: `done${n}`, repo: n % 2 ? 'shop' : 'docs', title: `Finished task ${n + 1}`, calls: 30, failed: 2, stop: true })),
  { key: 'asks-a', repo: 'shop', title: 'Cart totals', calls: 1, stop: true, asks: [{ kind: 'taste', question: 'Which header colour on the login page?', options: [['blue', 'Blue header'], ['green', 'Green header']], default: 'blue', deadline: (at) => at + 86_400_000 }] },
  { key: 'asks-b', repo: 'docs', title: 'Release notes', calls: 1, stop: true, asks: [{ kind: 'choice', question: 'Keep the changelog as a list or as prose?', options: [['list', 'A list'], ['prose', 'Prose']], default: 'list', deadline: (at) => at + 86_400_000 }] },
];

describe(ID.detail, () => {
  test(`${ID.detail}: with ten finished sessions of 30 calls each and two open asks, the last line of deep status is the count sentence and the output is under 40 lines`, async () => {
    const w = await makeWorld(SPECS);
    const r = await deep(w, ['status']);
    const lines = r.stdout.replace(/\n$/, '').split('\n');
    console.log(`deep status: ${lines.length} lines, ending on ${JSON.stringify(lines.at(-1))}\n${r.stdout.slice(0, 3000)}`);
    expect(r.code, `deep status exits 0: ${shown(r)}`).toBe(0);
    expect(endFailures(r.stdout, 2, 40), 'the end of deep status').toEqual([]);
  }, 900_000);
});

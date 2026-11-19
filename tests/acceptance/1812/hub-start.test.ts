// #1812 AC8 (README): `deep hub start` on a stopped hub prints one line that says the hub is up. The home is set up by
// `deep setup`, its hub stopped by PID; `deep hub start` hands the hub's service definition to the login service
// stand-in, which starts the hub. Then a hub answers on the home's socket, and the command printed exactly one line,
// naming the hub and saying it is up (up, running, started or answers, with no negation such as not or isn't).
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, answers, cleanup, deep, needBuild, setUp, shown, socketOf, stopHubs, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1812.a9d7101d';
/** A line that says the hub is up: it names the hub and says it is up, running, started or answers, and negates nothing. */
const UP = (line: string) => /\bhub\b/i.test(line) && /\b(?:up|running|started|answers|answering)\b/i.test(line) && !/\b(?:not|isn't|isn’t|wasn't|wasn’t|didn't|didn’t|can't|can’t|couldn't|couldn’t|won't|won’t)\b/i.test(line);

describe(`${ID} deep hub start says the hub is up`, () => {
  it(`${ID} deep hub start on a stopped hub prints one line that says the hub is up`, async () => {
    needBuild();
    const w = world();
    await setUp(w);
    await stopHubs(w);
    if (await answers(socketOf(w))) throw Error('BLOCKED: a hub still answers in the home after its hub was stopped by PID');
    const r = await deep(w, ['hub', 'start'], { hub: 'starts', timeoutMs: 180 * SECOND });
    expect(r.code, `deep hub start starts the stopped hub: ${shown(r)}`).toBe(0);
    expect(await answers(socketOf(w)), `a hub answers once deep hub start returns: ${shown(r)}`).toBe(true);
    const lines = `${r.stdout}\n${r.stderr}`.split('\n').filter((line) => line.trim());
    expect(lines, `deep hub start prints one line; it printed ${lines.length}: ${shown(r)}`).toHaveLength(1);
    expect(UP(lines[0]!), `deep hub start's line must say the hub is up: ${shown(r)}`).toBe(true);
  }, 600 * SECOND);
});

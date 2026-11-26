// #3250, a Claude Code stop through a real hub: the session's hooks reach `deep hub run` from the agent stand-in, its
// transcript under the fake home's ~/.claude/projects is written as Claude Code 2.1.299 and later write it, and what the
// hub recorded and reads is seen from outside, through events.read, numbers.read and `deep numbers` (README, Surfaces).
// Needs `npm run build`; a hub that can't start is BLOCKED, never a pass.
import { afterEach, expect, it } from 'vitest';
import { close, tidy, FIVE_MINUTE, numbersIn, numbersText, ONE_HOUR, rows, saysAtLeast, sessionLine, sessionRow, TIMEOUT, turn, usages, versionOf, world, type World } from './world.ts';

afterEach(tidy, 60_000);
const show = (v: unknown): string => JSON.stringify(v).slice(0, 2000);

it('#3250.1334628e a stop whose transcript gave a write total and no split records a turn.usage@2 whose cost reads "at least", and the session\'s spend.usd and its deep numbers line both say "at least"', async () => {
  let w: World | undefined;
  try {
    w = await world();
    // 1,000,000 write tokens with no split: priced at the five-minute rate, the least they can have cost (#3158).
    const usage = await turn(w, [{ input: 10, output: 200, read: 5000, total: 1_000_000 }]);
    expect(usage, 'the hub records the stop\'s turn.usage').toBeDefined();
    expect(versionOf(usage), `the hub writes turn.usage@2 for a Claude Code stop; it wrote ${show(usage)}`).toBe(2);
    expect((usage!.data.cost as { basis?: unknown } | undefined)?.basis, 'the cost is an estimate from the rate card').toBe('estimated');
    expect(saysAtLeast(usage!.data.cost), `the recorded cost reads "at least": ${show(usage!.data.cost)}`).toBe(true);

    const spend = sessionRow(await rows(w.hub), 'spend.usd', w.session.id);
    expect(spend, 'numbers.read has the session\'s spend.usd').toBeDefined();
    expect(saysAtLeast(spend), `the session's spend.usd sums an "at least" cost, so it reads "at least": ${show(spend)}`).toBe(true);

    const text = await numbersText(w.home);
    const line = sessionLine(text, 'spend.usd', w.session.id);
    expect(line, `deep numbers has the session's spend.usd line: ${text.slice(0, 2000)}`).toBeDefined();
    expect(line, 'and the line says "at least"').toMatch(/at least/i);
  } finally {
    await close(w);
  }
}, TIMEOUT);

it('#3250.060b349a a stop whose transcript wrote 300,000 one-hour and 800,000 five-minute tokens records both parts in its turn.usage@2, and its input is what turn.usage@1 recorded', async () => {
  let w: World | undefined;
  try {
    w = await world();
    const usage = await turn(w, [{ input: 10, output: 200, read: 5000, oneHour: 300_000 }, { input: 10, output: 200, read: 5000, fiveMinute: 800_000 }]);
    expect(usage, 'the hub records the stop\'s turn.usage').toBeDefined();
    const tokens = usage!.data.tokens as Record<string, unknown> | undefined;
    // turn.usage@1's input takes the writes in whole: 10 + 10 input tokens and 300,000 + 800,000 written.
    expect(tokens?.input, `input is what turn.usage@1 recorded, 1,100,020: ${show(tokens)}`).toBe(1_100_020);
    expect(versionOf(usage), `the hub writes turn.usage@2 for a Claude Code stop; it wrote ${show(usage)}`).toBe(2);
    const counted = numbersIn(tokens);
    expect(counted.filter((c) => c.n === 300_000 && ONE_HOUR.test(c.path)).length, `the tokens hold the 300,000 one-hour writes as a part: ${show(tokens)}`).toBeGreaterThan(0);
    expect(counted.filter((c) => c.n === 800_000 && FIVE_MINUTE.test(c.path)).length, `the tokens hold the 800,000 five-minute writes as a part: ${show(tokens)}`).toBeGreaterThan(0);
  } finally {
    await close(w);
  }
}, TIMEOUT);

it('#3250.639cf1ce a session whose every record gives its split never reads "at least" anywhere', async () => {
  let w: World | undefined;
  try {
    w = await world();
    const first = await turn(w, [{ input: 10, output: 200, read: 5000, oneHour: 300_000 }]);
    expect(first, 'the hub records the first stop\'s turn.usage').toBeDefined();
    const second = await turn(w, [{ input: 10, output: 200, read: 5000, fiveMinute: 800_000 }, { input: 5, output: 100, read: 9000, oneHour: 1000, fiveMinute: 2000 }], [first!]);
    expect(second, 'the hub records the second stop\'s turn.usage').toBeDefined();
    const all = await usages(w.hub, w.session.id);
    expect(all.length, 'one turn.usage per stop').toBeGreaterThanOrEqual(2);
    // The record the criterion speaks of is the one this issue makes: turn.usage@2.
    for (const e of all) expect(versionOf(e), `the hub writes turn.usage@2 for a Claude Code stop; it wrote ${show(e)}`).toBe(2);
    for (const e of all) expect(saysAtLeast(e.data), `a turn.usage of a session whose every record gives its split reads "at least": ${show(e.data)}`).toBe(false);

    const read = await rows(w.hub);
    expect(sessionRow(read, 'spend.usd', w.session.id), 'numbers.read has the session\'s spend.usd').toBeDefined();
    expect(read.filter((r) => saysAtLeast(r)).map(show), 'no reading says "at least"').toEqual([]);
    const text = await numbersText(w.home);
    expect(sessionLine(text, 'spend.usd', w.session.id), `deep numbers has the session's spend.usd line: ${text.slice(0, 2000)}`).toBeDefined();
    expect(text.split('\n').filter((l) => /at[ _-]?least/i.test(l)), 'no deep numbers line says "at least"').toEqual([]);
  } finally {
    await close(w);
  }
}, TIMEOUT);

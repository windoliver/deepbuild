// #2654 criterion 2: "A request of exactly the cap is answered, and one byte more is refused. A planted reader that
// keeps the dropped bytes fails the memory bound, naming the peak"
//
// "A request of exactly the cap" is read as the request line's bytes without the newline that ends it, 16 MiB (the
// issue's draft); one byte more is 16 MiB + 1. Both are JSON-RPC pings, padded in a params field ping ignores.
// The second test is the memory bound a reader that keeps the dropped bytes fails: criterion 1's bound, 96 MB resident
// since the Nov 22 amendment ("on Nov 22 the owner set it to 96 MB"). One line 256 MiB long (the cap and 240 MiB more)
// with no newline until its end, deep mcp's resident memory sampled by its PID.
import { expect, test } from 'vitest';
import { AC, CAP, LONG, Mcp, NAMES_CAP, RSS_LIMIT, SHORT, isError, mb, pingOf, request, tempHome } from './helpers.ts';

test(`${AC.exact} a request of exactly the 16 MiB cap is answered, and one byte more is refused with an error naming the cap`, async () => {
  const { dir, home } = tempHome();
  const mcp = new Mcp(home, dir);
  await mcp.write(`${pingOf(1, CAP)}\n`);
  const exact = await mcp.waitFor((l) => l.id === 1, 120_000);
  await mcp.write(`${pingOf(2, CAP + 1)}\n`);
  await mcp.write(request(3, 'ping'));
  const after = await mcp.waitFor((l) => l.id === 3, 120_000);
  await mcp.end();

  expect(exact?.result, `the ${CAP}-byte request (id 1) is answered: ${mcp.shown()}`).toEqual({});
  const over = mcp.lines.find((l) => l.id === 2);
  expect(over?.result, `the ${CAP + 1}-byte request (id 2) is refused, not answered: ${mcp.shown()}`).toBeUndefined();
  const errors = mcp.lines.filter(isError);
  expect(errors.length, `one error, for the ${CAP + 1}-byte request: ${mcp.shown()}`).toBe(1);
  expect(String(errors[0]?.error?.message ?? ''), `the error names the cap: ${JSON.stringify(errors[0])}`).toMatch(NAMES_CAP);
  expect(after?.result, `the line after the refused one is served: ${mcp.shown()}`).toEqual({});
}, SHORT);

test(`${AC.exact} the bytes dropped past the cap aren't kept: a 256 MiB line leaves deep mcp under 96 MB resident, refused naming the cap, the next line served`, async () => {
  const { dir, home } = tempHome();
  const mcp = new Mcp(home, dir);
  mcp.startSampling();
  const total = 256 * 1024 * 1024;
  const sent = await mcp.stream(total);
  await mcp.write('\n');
  await mcp.write(request(9, 'ping'));
  const after = await mcp.waitFor((l) => l.id === 9, 120_000);
  await mcp.end();
  const errors = mcp.lines.filter(isError);

  expect(mcp.samples, `setup: deep mcp's resident memory was sampled (${mcp.shown()})`).toBeGreaterThan(0);
  expect(mcp.peak, `deep mcp's peak resident memory, fed one ${mb(sent)} line, was ${mb(mcp.peak)}; ${mcp.shown()}`).toBeLessThan(RSS_LIMIT);
  expect(errors.length, `one error for the overlong line: ${mcp.shown()}`).toBe(1);
  expect(String(errors[0]?.error?.message ?? ''), `the error names the cap: ${JSON.stringify(errors[0])}`).toMatch(NAMES_CAP);
  expect(after?.result, `the line after is served: ${mcp.shown()}`).toEqual({});
}, LONG);

// #3503 criterion 2: "A request of exactly the cap is answered, and one byte more is refused. A planted reader that
// keeps the dropped bytes fails the memory bound, naming the peak"
//
// "Exactly the cap" is the request line's bytes without its newline, 16,777,216 (Scope); one byte more is 16,777,217.
// Both are JSON-RPC pings, padded in a params field ping ignores. The second test is the memory bound a reader that keeps
// the dropped bytes fails: criterion 1's bound, the only one the issue states, held over one 256 MiB line (the cap and
// 240 MiB more) that ends with a newline and is followed by a ping.
import { expect, test } from 'vitest';
import { AC, CAP, LONG, MIB, NAMES_CAP, RSS_LIMIT, SHORT, isError, mb, pingOf, request, startActions, tempHome } from './helpers.ts';

test(`${AC.exact} a request of exactly the 16 MiB cap is answered, and one byte more is refused with an error naming the cap, the next line served`, async () => {
  const { dir, home } = tempHome();
  const server = startActions(home, dir);
  await server.write(`${pingOf(1, CAP)}\n`);
  const exact = await server.waitFor((l) => l.id === 1, 120_000);
  await server.write(`${pingOf(2, CAP + 1)}\n`);
  await server.write(request(3, 'ping'));
  const after = await server.waitFor((l) => l.id === 3, 120_000);
  await server.end();

  expect(exact?.result, `the ${CAP}-byte request (id 1) is answered: ${server.shown()}`).toEqual({});
  expect(server.lines.find((l) => l.id === 2)?.result, `the ${CAP + 1}-byte request (id 2) is refused, not answered: ${server.shown()}`).toBeUndefined();
  const errors = server.lines.filter(isError);
  expect(errors.length, `one error, for the ${CAP + 1}-byte request: ${server.shown()}`).toBe(1);
  expect(String(errors[0]?.error?.message ?? ''), `the error names the cap: ${JSON.stringify(errors[0])}`).toMatch(NAMES_CAP);
  expect(after?.result, `the line after the refused one is served: ${server.shown()}`).toEqual({});
}, SHORT);

test(`${AC.exact} the bytes dropped past the cap aren't kept: a 256 MiB line leaves deep-hook mcp actions under 32 MB resident, refused naming the cap, the next line served`, async () => {
  const { dir, home } = tempHome();
  const server = startActions(home, dir);
  const sent = await server.stream(256 * MIB, RSS_LIMIT);
  await server.write('\n');
  await server.write(request(9, 'ping'));
  const after = await server.waitFor((l) => l.id === 9, 120_000);
  await server.end();
  const errors = server.lines.filter(isError);

  expect(server.maxrss, `setup: time reported the server's peak resident memory (${server.shown()})`).toBeGreaterThan(0);
  expect(server.peak, `deep-hook mcp actions' peak resident memory, fed ${mb(sent)} of one line, was ${mb(server.peak)}, past ${mb(RSS_LIMIT)}; ${server.shown()}`).toBeLessThan(RSS_LIMIT);
  expect(sent, `the whole 256 MiB line went in (${server.shown()})`).toBe(256 * MIB);
  expect(errors.length, `one error for the overlong line: ${server.shown()}`).toBe(1);
  expect(String(errors[0]?.error?.message ?? ''), `the error names the cap: ${JSON.stringify(errors[0])}`).toMatch(NAMES_CAP);
  expect(after?.result, `the line after is served: ${server.shown()}`).toEqual({});
}, LONG);

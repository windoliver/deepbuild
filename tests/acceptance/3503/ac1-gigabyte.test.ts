// #3503 criterion 1: "Fed 1 GB with no newline, `deep-hook mcp actions` stays under 32 MB resident (drafted), writes
// one error that names the cap, and answers the `tools/list` on the line after. The merge base holds what it is fed and
// fails, naming the peak"
//
// 1 GiB of 'a' is streamed to the server's stdin a MiB at a time (this process never holds more than a MiB of it), then
// the newline that ends that line, then a tools/list on the next line. Its resident memory is read by its PID every
// 16 MiB, and its peak by time once it exits. A server that passes the bound gets 64 MiB more and no more, so a server
// that holds what it is fed fails without taking the whole gigabyte; the test then fails naming the peak.
import { expect, test } from 'vitest';
import { AC, CAP, LONG, NAMES_CAP, RSS_LIMIT, isError, mb, request, startActions, tempHome } from './helpers.ts';

const GIGABYTE = 1024 * 1024 * 1024;

test(`${AC.gigabyte} fed 1 GB with no newline, deep-hook mcp actions stays under 32 MB resident, writes one error naming the 16 MiB cap, and answers the tools/list on the line after`, async () => {
  const { dir, home } = tempHome();
  const server = startActions(home, dir);
  const sent = await server.stream(GIGABYTE, RSS_LIMIT);
  await server.write('\n');
  await server.write(request(7, 'tools/list'));
  const listed = await server.waitFor((l) => l.id === 7, 120_000);
  await server.end();
  const errors = server.lines.filter(isError);

  expect(server.maxrss, `setup: time reported the server's peak resident memory (${server.shown()})`).toBeGreaterThan(0);
  expect(server.peak, `deep-hook mcp actions' peak resident memory, fed ${mb(sent)} of one line with no newline, was ${mb(server.peak)}, past ${mb(RSS_LIMIT)}; ${server.shown()}`).toBeLessThan(RSS_LIMIT);
  expect(sent, `the whole gigabyte went in (${server.shown()})`).toBe(GIGABYTE);
  expect(errors.length, `one error for the overlong line: ${server.shown()}`).toBe(1);
  expect(String(errors[0]?.error?.message ?? ''), `the error names the cap (${CAP} bytes, 16 MiB): ${JSON.stringify(errors[0])}`).toMatch(NAMES_CAP);
  expect(Array.isArray(listed?.result?.tools) && listed.result.tools.length > 0, `the tools/list on the line after is answered with its tools: ${server.shown()}`).toBe(true);
  expect(server.lines.indexOf(errors[0]!), 'the error comes before the tools/list answer').toBeLessThan(server.lines.indexOf(listed!));
}, LONG);

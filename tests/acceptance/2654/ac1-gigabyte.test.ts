// #2654 criterion 1: "Fed 1 GB with no newline, `deep mcp`'s resident memory stays under 96 MB, it writes
// one error that names the cap, and it answers the `tools/list` on the line after. On the merge base its heap passes
// 196 MB within 3 s, and the test fails, naming the peak"
//
// 1 GiB of 'a' is streamed to deep mcp's stdin a MiB at a time (this process never holds more than one MiB of it), then
// the newline that ends that line, then a tools/list on the next line. Its resident memory is sampled by its PID
// throughout. Once the bound is broken the feed goes on at most 3 s more, so a wrong program's peak is shown without
// feeding it the whole gigabyte; the test then fails naming the peak.
import { expect, test } from 'vitest';
import { AC, CAP, LONG, Mcp, NAMES_CAP, RSS_LIMIT, isError, mb, request, tempHome } from './helpers.ts';

const GIGABYTE = 1024 * 1024 * 1024;

test(`${AC.gigabyte} fed 1 GB with no newline, deep mcp stays under 96 MB resident, writes one error naming the 16 MiB cap, and answers the tools/list on the line after`, async () => {
  const { dir, home } = tempHome();
  const mcp = new Mcp(home, dir);
  mcp.startSampling();
  let brokeAt = 0;
  const started = Date.now();
  const sent = await mcp.stream(GIGABYTE, () => {
    if (!brokeAt && mcp.peak >= RSS_LIMIT) brokeAt = Date.now();
    return brokeAt > 0 && Date.now() - brokeAt > 3_000;
  });
  const fed = Date.now() - started;
  await mcp.write('\n');
  await mcp.write(request(7, 'tools/list'));
  const listed = await mcp.waitFor((l) => l.id === 7, 120_000);
  await mcp.end();
  const errors = mcp.lines.filter(isError);

  expect(mcp.samples, `setup: deep mcp's resident memory was sampled (${mcp.shown()})`).toBeGreaterThan(0);
  expect(mcp.peak, `deep mcp's peak resident memory, fed ${mb(sent)} with no newline in ${(fed / 1000).toFixed(1)} s, was ${mb(mcp.peak)}${brokeAt ? `, past ${mb(RSS_LIMIT)} after ${((brokeAt - started) / 1000).toFixed(1)} s` : ''}; ${mcp.shown()}`).toBeLessThan(RSS_LIMIT);
  expect(sent, `the whole gigabyte went in (${mcp.shown()})`).toBe(GIGABYTE);
  expect(errors.length, `deep mcp writes one error for the overlong line: ${mcp.shown()}`).toBe(1);
  expect(String(errors[0]?.error?.message ?? ''), `the error names the cap (${CAP} bytes, 16 MiB): ${JSON.stringify(errors[0])}`).toMatch(NAMES_CAP);
  expect(Array.isArray(listed?.result?.tools) && listed.result.tools.length > 0, `deep mcp answers the tools/list on the line after with its tools: ${mcp.shown()}`).toBe(true);
  expect(mcp.lines.indexOf(errors[0]!), 'the error comes before the tools/list answer').toBeLessThan(mcp.lines.indexOf(listed!));
}, LONG);

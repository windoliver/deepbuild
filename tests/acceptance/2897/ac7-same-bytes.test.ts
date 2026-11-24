// #2897 AC7: "Two sessions started a minute apart receive byte-identical `instructions` and tool lists, and each tool's
// name, description and input schema are the merge base's bytes. A planted text that holds a clock time fails, naming it"
//
// Each of the four servers is started fresh and initialized as Claude Code, then again 61 seconds later. Both starts must
// receive instructions, the same characters both times, and the same tool list; each tool's name, description and input
// schema must be the bytes base-tools.json holds, each server's tools/list at the merge base (README: The base). Then
// the planted text: deep's instructions with the clock time of each start in them, through the same check, which must
// fail naming the time it read.
import { expect, test } from 'vitest';
import { AC, DEEP, SERVERS, base, baseFailures, baseKey, instructionsOf, sameFailures, startSession, type Session } from './helpers.ts';

const MINUTE_MS = 61_000;
const clock = (at: Date): string => at.toISOString().slice(11, 19);

test(`${AC.sameBytes} two starts a minute apart receive byte-identical instructions and tool lists from each server, each tool's name, description and input schema the merge base's bytes; the same check fails a planted text that holds a clock time, naming it`, { timeout: 300_000 }, async () => {
  const first: Session[] = [];
  for (const server of SERVERS) first.push(await startSession(server));
  const firstAt = new Date();
  await new Promise((resolve) => setTimeout(resolve, MINUTE_MS));
  const second: Session[] = [];
  for (const server of SERVERS) second.push(await startSession(server));
  const secondAt = new Date();

  const was = base();
  const failures = SERVERS.flatMap((server, i) => [
    ...sameFailures(server.label, first[i]!, second[i]!),
    ...baseFailures(server.label, second[i]!.tools ?? [], was.servers[baseKey(server)]!),
  ]);
  expect(failures, 'each server\'s two starts, against each other and the merge base').toEqual([]);

  const deep = SERVERS.indexOf(DEEP);
  const own = instructionsOf(first[deep]!) ?? '';
  const stamped = (session: Session, at: Date): Session => ({ ...session, initialize: { ...(session.initialize ?? {}), instructions: `${own} Started at ${clock(at)}.` } });
  const planted = sameFailures(DEEP.label, stamped(first[deep]!, firstAt), stamped(second[deep]!, secondAt));
  const named = clock(secondAt).split('').findIndex((c, i) => c !== clock(firstAt)[i]);
  expect(planted.some((line) => line.includes(clock(secondAt).slice(named))), `the planted text holding the clock time fails, naming it (${clock(firstAt)} then ${clock(secondAt)}): ${planted.join(' | ') || 'it passed'}`).toBe(true);
});

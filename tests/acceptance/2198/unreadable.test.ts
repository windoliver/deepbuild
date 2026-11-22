// #2198 AC2: asks settings that can't be read are no argument either. A repo whose done.yaml holds an asks block that
// doesn't parse (an unclosed flow map on its deadline line); a session's deep_ask is refused naming the file and the line,
// with a path that is not under the call's arguments. Today, read from packages/asks/src/index.ts: path /params/asks.
import { afterEach, describe, expect, it } from 'vitest';
import { AC2, call, cleanup, refusalOf, tasteArgs, underParams, UNREADABLE_LINE, world } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC2} The same for asks settings that can't be read`, () => {
  // "Given a repo whose done.yaml holds an asks block that doesn't parse, when a session calls `deep_ask`, then the refusal
  // names the file and line and no argument."
  it(`${AC2} deep_ask in a repo whose done.yaml asks block doesn't parse: the refusal names done.yaml and line ${UNREADABLE_LINE}, and its path is not under /params`, async () => {
    const w = await world('unreadable-asks');
    const r = refusalOf(await call(w, 'deep_ask', tasteArgs()), 'deep_ask with an asks block that does not parse');
    const said = JSON.stringify(r);
    expect(said, `the refusal names the file, done.yaml: ${said}`).toMatch(/done\.yaml/);
    expect(said, `the refusal names the line that doesn't parse, ${UNREADABLE_LINE}: ${said}`).toMatch(new RegExp(`\\bline ${UNREADABLE_LINE}\\b|done\\.yaml:${UNREADABLE_LINE}\\b`));
    expect(underParams(r.path), `the refusal's path ${JSON.stringify(r.path)} is under the call's parameters, naming an argument: ${said}`).toBe(false);
  }, 240_000);
});

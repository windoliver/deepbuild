// #2218 AC4: a spec whose check has `dedline: 30m` makes the claim BLOCKED, naming `dedline` and its line, and so does
// a top-level `chekcs:` block. A hub that ignores either judges the claim (issue: Scope, "A key the hub doesn't read, at
// the top of `done.yaml` or on a check, makes the claim BLOCKED, naming the key and its line, with you as owner. It is
// never ignored"; design: How runs become one of five verdicts, BLOCKED names its cause and its owner; First-party
// extensions, "A value nobody declared makes whatever depends on it BLOCKED, and the reason names the value").
//
// Each fixture spec is whole but for one misspelled key, and everything else about the claim passes: the spec's
// `suite` check, three tests that pass, and the handed definition's one requirement. So a hub that ignores the key
// judges the claim on the rest, and one that refuses it has nothing above BLOCKED to say. The key's line is read from
// the fixture's own text (fixtures/dedline.yaml, fixtures/chekcs.yaml), 1-based, as an editor counts it.
import { afterEach, describe, expect, it } from 'vitest';
import { AC4, SPEC_FILE, claimed, cleanup, fixture, lineOf, names, namesLine, ownerIsYou, shop, shownClaim, wordsOf } from './helpers.ts';

afterEach(cleanup, 60_000);

/** The claim of a session in a repo whose spec holds `key`, which no reader takes, judged against the criterion and then the Scope's owner. */
async function refused(file: string, key: string, where: string): Promise<void> {
  const spec = fixture(file);
  const line = lineOf(spec, key);
  const who = `${AC4} [${key}]`;
  const c = await claimed(who, await shop({ spec }), { done: (r) => r.outcome === 'BLOCKED', unlocked: true });
  expect(c.outcome, `${who} ${where} is \`${key}\`, on line ${line} of ${SPEC_FILE}, a key the hub doesn't read, so the claim must be BLOCKED, naming ${key} and its line; the hub ignored ${key} and judged the claim ${c.outcome ?? 'with no verdict'}: ${shownClaim(c)}`).toBe('BLOCKED');
  const said = wordsOf(c.last).filter((text) => names(text, key));
  expect(said.length, `${who} the BLOCKED verdict must name the key, ${key}: ${JSON.stringify(wordsOf(c.last))}`).toBeGreaterThan(0);
  expect(said.some((text) => namesLine(text, line)), `${who} the BLOCKED verdict must name ${key}'s line, ${line} of ${SPEC_FILE}: ${JSON.stringify(said)}`).toBe(true);
  // The Scope's owner, read wherever the record says whose the cause is: the verdict, the record of a run of the claim, or an ask raised for the key, which is yours to answer.
  const asks = c.events.filter((e) => e.kind === 'ask.created' && e.log_pos > c.since && names(JSON.stringify(e.data), key));
  const owned = [JSON.stringify(c.last!.data), ...c.runs.map((r) => JSON.stringify(r.finished?.data ?? {}))];
  expect(owned.some(ownerIsYou) || asks.length > 0, `${who} (Scope) the claim is BLOCKED with you as owner: neither its verdict nor its runs' records say so, and no ask names ${key}: ${JSON.stringify(c.last!.data).slice(0, 1500)}`).toBe(true);
}

describe(`${AC4} a key the hub doesn't read makes the claim BLOCKED`, () => {
  it(`${AC4} a spec whose check has dedline: 30m makes the claim BLOCKED, naming dedline and its line, with you as owner`, async () => {
    await refused('dedline.yaml', 'dedline', "one key of the spec's suite check");
  }, 1_800_000);

  it(`${AC4} a spec with a top-level chekcs: block makes the claim BLOCKED, naming chekcs and its line, with you as owner`, async () => {
    await refused('chekcs.yaml', 'chekcs', 'one block at the top of the spec');
  }, 1_800_000);
});

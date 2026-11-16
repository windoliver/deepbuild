// AC2 #2362.9bb19ae2: a release `deep-show` with the full set seals: the release-build case of
// `tests/acceptance/855/hash.test.ts` passes on main, unchanged.
//
// That case is the criterion's proof, and the implementer runs it unchanged (README); it takes hours, so this is its
// fastest faithful check through the same surface: the release build it makes (`cargo build --locked --release --bin
// deep-show --no-default-features --features full`, embedding the committed kit ledger) starts instead of refusing at
// the seal, and every fixture its `fixtures` call lists is presented by `deep_show` and evaluated clean at 0.5 s under
// hash@2 in that build, as the case shows and evaluates each one before it compares keys. The keys' equality across
// builds is #855's property, which this issue doesn't touch, and stays with the named case.
//
// The wrong programs: the base (the seal refuses motion and text, `kit_failed`, from the ledger it embeds, and five
// fixtures the full build lists are refused by deep_show, README: What the base does); a ledger whose records the kit
// doesn't back is AC1's; a planted document left in the listing fails here as it would there.
import { describe, expect, it } from 'vitest';
import {
  AC2, FIXTURES, buildCommand, doc, evalClean, fixtureName, fixturesOf, isObject, notPresented, obj, run, scenario, show, start, useBuild, useTemp,
  type Fixture, type JsonObject,
} from './helpers.ts';

const release = useBuild('release');
const temp = useTemp();

/** What `eval` answered for a fixture, when it isn't an evaluation under hash@2. */
function notEvaluated(reply: JsonObject): string | null {
  if (reply['outcome'] === 'evaluated' && reply['hash'] === 'hash@2' && Array.isArray(reply['nodes'])) return null;
  return `eval answers ${JSON.stringify({ outcome: reply['outcome'] ?? null, hash: reply['hash'] ?? null, code: reply['code'] ?? null })}`;
}

describe(`${AC2} a release deep-show with the full set seals`, () => {
  it(`${AC2} the release build of the full set starts instead of refusing at the seal, and every fixture it lists is presented and evaluated clean at 0.5 s under hash@2, as #855's release-build case reads them`, () => {
    const bin = release();
    const started = start(bin, scenario(temp(), [FIXTURES]));
    expect(started.timedOut, 'the release build answers within its timeout').toBe(false);
    expect(started.status, `${buildCommand('release')} starts and answers the fixtures call instead of refusing: exit ${started.status}, ${started.stdout.slice(0, 1500)} ${started.stderr.slice(-1500)}`).toBe(0);
    const answer = obj(started.lines[0], 'the release build\'s answer');
    expect(answer['ok'], `the release build accepts the scenario: ${JSON.stringify(answer).slice(0, 1500)}`).toBe(true);
    const listing = fixturesOf(obj((answer['replies'] as JsonObject[] | undefined)?.[0], 'the fixtures reply'));
    expect(listing.length, 'the release build lists fixtures').toBeGreaterThan(0);

    const problems: string[] = [];
    const judge = (f: Fixture, shown: JsonObject, evaluated: JsonObject): void => {
      if (shown['outcome'] !== 'presented') problems.push(`${fixtureName(f)}: ${notPresented(shown)}`);
      else {
        const why = notEvaluated(evaluated);
        if (why) problems.push(`${fixtureName(f)}: ${why}`);
      }
    };
    const plain = listing.filter((f) => !f.record);
    if (plain.length) {
      const calls = plain.flatMap((f, i) => [show(f.document, doc(i + 1)), evalClean(doc(i + 1))]);
      const replies = run(bin, scenario(temp(), calls, plain.length), 'every listed fixture without a record, shown and evaluated in the release build');
      plain.forEach((f, i) => judge(f, replies[2 * i]!, replies[2 * i + 1]!));
    }
    for (const f of listing.filter((x) => isObject(x.record))) {
      const [shown, evaluated] = run(bin, scenario(temp(), [show(f.document, doc(1)), evalClean(doc(1))], 1, f.record), `${fixtureName(f)} with its record, in the release build`);
      judge(f, shown!, evaluated!);
    }
    expect(problems, 'every fixture the release build lists presents and evaluates').toEqual([]);
  }, 3_600_000);
});

// AC1 #1968.4bf4e5fe: "A text_diff over 1 s with linear progress, from a 3-line function to a 4-line one with a line
// inserted above the last two, moves the kept tokens of the last two lines down by exactly one line height (10 u at
// 0.5 s and 20 u at 1 s for a 20 u line), fades in only the inserted line's tokens and cross-fades the one changed
// argument, and seeking to any time inside it equals playing"
//
// Through `deep-show run` (the full build set): the film `moving-diff` (README: The moving diff) holds two code items at
// one place, `before` (`def greet(user):` / `send(user, out)` / `return user`) and `after` (`assert ready` inserted above
// the last two lines, whose argument `out` becomes `err`), 20 u lines, and the transition `td` from one to the other
// (`kind: text_diff`, `at: 0.5s`, `span: 1s`, `progress: linear`: the window [0 s, 1 s]). `eval {t, film: true}` reads
// the film block's `diffs.td` (README: The surface under test): each token of either item once, with the token it comes
// from and goes to, its box and its opacity at t. The play reads every 60 fps frame of the window and seven times off that grid in
// order, in one session; the seek reads the same times last to first, in another. Positions and opacities are judged as
// numbers; no picture is read. Each judge first fails its planted wrong programs and passes the clean model (README:
// Wrong programs); the base refuses the film (`transition_kind`), so each test fails at presenting it.
import { describe, expect, it } from 'vitest';
import {
  AC, AFTER, AFTER_TOKENS, ARG_IN, ARG_OUT, BEFORE, BEFORE_TOKENS, DIFF, FRAMES_60, INSERTED, KEPT, PLANTS, TIMEOUT, binOf, diffFilm, diffOf, failsNaming,
  fadeFailures, filmsAt, fl, memo, modelAt, motionFailures, none, prebuild, seekFailures, tokensOf, useTemp, type Diff, type JsonObject, type Timed,
} from './helpers.ts';

prebuild(['full']);
const temp = useTemp();
const ID = AC[1];
/** Seven times inside the window off the 60 fps grid, whole flicks. */
const OFF_GRID = [0.013, 0.177, 0.333, 0.499, 0.501, 0.777, 0.987].map(fl);
const TIMES = [...FRAMES_60, ...OFF_GRID].sort((a, b) => a - b);
/** A planted (or the clean) answer at every time read. */
const model = (f: (t: number) => Diff): Timed[] => TIMES.map((t) => ({ t, diff: f(t) }));

/** The play (every time in order) and the seek (every time last to first): each time's raw `diffs.td` JSON and its
 * reading, once per file. */
const read = (films: JsonObject[], times: readonly number[], what: string): { json: Map<number, string>; timed: Timed[] } => {
  const json = new Map<number, string>(); const timed: Timed[] = [];
  films.forEach((f, i) => {
    const t = times[i]!;
    timed.push({ t, diff: diffOf(f, DIFF, 'before', 'after', `${what} at ${t} flicks`) });
    json.set(t, JSON.stringify((f['diffs'] as JsonObject)[DIFF]));
  });
  return { json, timed };
};
const play = memo(() => read(filmsAt(binOf(), temp(), diffFilm(), TIMES, 'the moving diff, played'), TIMES, 'the play'));
const seek = memo(() => {
  const back = [...TIMES].reverse();
  return read(filmsAt(binOf(), temp(), diffFilm(), back, 'the moving diff, sought last to first'), back, 'the seek');
});

describe(`${ID} a text_diff from a 3-line function to a 4-line one`, () => {
  it(`${ID} moves the kept tokens of the last two lines down by exactly one line height, 20 u times the linear progress (10 u at 0.5 s, 20 u at 1 s), never sideways, while the first line's kept tokens stay`, () => {
    expect(tokensOf(BEFORE).map((t) => BEFORE.slice(t.from, t.to)), 'the fixture: before\'s tokens').toEqual(BEFORE_TOKENS);
    expect(tokensOf(AFTER).map((t) => AFTER.slice(t.from, t.to)), 'the fixture: after\'s tokens').toEqual(AFTER_TOKENS);
    expect(KEPT.filter(([o, n]) => BEFORE_TOKENS[o] !== AFTER_TOKENS[n]), 'the fixture: each kept pair is one token on both sides').toEqual([]);
    expect([...INSERTED.map((k) => AFTER_TOKENS[k]), BEFORE_TOKENS[ARG_OUT], AFTER_TOKENS[ARG_IN]], 'the fixture: the inserted line and the changed argument').toEqual(['assert', 'ready', 'out', 'err']);
    none(motionFailures(model(modelAt)), 'the judge passes the clean model');
    failsNaming(motionFailures(model(PLANTS.eased)), [/^at 0\.25 s .*last two lines/], 'planted: kept tokens on an eased progress');
    failsNaming(motionFailures(model(PLANTS.allSlide)), [/first line/], 'planted: the first line slides down too');
    failsNaming(motionFailures(model(PLANTS.pairedByPosition)), [/before#tok:6 \(send/], 'planted: the changed line paired with the inserted one, by position');
    failsNaming(motionFailures(model(PLANTS.jump)), [/last two lines/], 'planted: kept tokens jump halfway');

    none(motionFailures(play().timed), 'the kept tokens\' boxes at every time read');
  }, TIMEOUT);

  it(`${ID} fades in only the inserted line's tokens and cross-fades the one changed argument, while every kept token stays drawn whole`, () => {
    none(fadeFailures(model(modelAt)), 'the judge passes the clean model');
    failsNaming(fadeFailures(model(PLANTS.wholeCrossFade)), [/kept tokens/], 'planted: the whole item cross-fades, no token kept');
    failsNaming(fadeFailures(model(PLANTS.insertedAtOnce)), [/inserted line.*fade in/], 'planted: the inserted line shows at once');
    failsNaming(fadeFailures(model(PLANTS.insertedAtEnd)), [/inserted line.*never partly drawn/], 'planted: the inserted line appears as the window ends');
    failsNaming(fadeFailures(model(PLANTS.swappedAtHalf)), [/never both partly drawn/], 'planted: the argument swaps halfway');
    failsNaming(fadeFailures(model(PLANTS.dips)), [/don't sum to 1/], 'planted: the argument dips through nothing');
    failsNaming(fadeFailures(model(PLANTS.argumentKept)), [/kept tokens/], 'planted: the changed argument kept as if equal');

    none(fadeFailures(play().timed), 'the pieces at every time read');
  }, TIMEOUT);

  it(`${ID} seeking to any time inside the window equals playing: every time read last to first answers the same diffs as read in order, bit for bit`, () => {
    const json = (f: (t: number) => Diff): Map<number, string> => new Map(TIMES.map((t) => [t, JSON.stringify(f(t))]));
    none(seekFailures(json(modelAt), json(modelAt)), 'the judge passes a seek equal to the play');
    failsNaming(seekFailures(json(modelAt), json((t) => modelAt(Math.max(0, t - FRAMES_60[1]!)))), [/the seek reads/], 'planted: a seek one frame behind');

    none(seekFailures(play().json, seek().json), 'seeking against playing');
  }, TIMEOUT);
});

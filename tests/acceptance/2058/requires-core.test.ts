// #2058: a document's `requires.core` and a pack's `requires.core` range are compared with the build's own core.
// One test per criterion, each `deep-show run` its own process with its own store (README: Criteria to tests). The
// build's core is read from the build (`registry`: `core`), never written here: 0.0.0 today, so "one patch above" is
// 0.0.1 and the pack's range `>=0.0.1`.
//
// #2058.e29d9bdc "A new fixture document whose requires.core is one patch above the build's own core (0.0.1 on today's
//   core 0.0.0) is refused with out_of_range at requires/core, and the message holds both versions. The same document
//   at the build's own core checks clean. …"
//   asserts: fixtures/documents/board.json with requires.core one patch above the build's core is refused by an error
//   out_of_range at requires/core whose message (`what`) holds that version and the build's core; with requires.core
//   at the build's core it is presented with no error.
// #2058.3cf1dddc "The same document with requires.core of soon is refused at requires/core as not a version, and one
//   with no requires.core checks clean. …"
//   asserts: the board with requires.core "soon" is refused by an error out_of_range at requires/core whose message
//   says "not a version" (what a value that is no text gets today); with no requires.core it is presented with no error.
// #2058.729deb44 "A new fixture pack whose requires.core is >= one patch above the build's core (>=0.0.1 today) is
//   refused by the pack check with out_of_range at its requires/core, and the message names the pack, the range and
//   the build's core. The same pack with >=0.0.0 checks clean. …"
//   asserts: fixtures/packs/ahead-1.0.0 (acme/ahead@1.0.0) with requires.core `>=<one patch above>` has a `packs` row
//   `refused` with an error out_of_range at requires/core whose message holds `ahead`, the range and the build's core;
//   with `>=<the build's core>` its row is `installed` with no error.
// #2058.d337dccb "A new fixture document that lists that pack is refused on load, naming the pack and its range. …"
//   asserts: fixtures/documents/lists-pack.json, which lists acme/ahead@1.0.0 while the store was offered that pack
//   with `>=<one patch above>`, is refused by an error that names `ahead` and the range.
// Wrong programs: the merge base, where each refused fixture checks clean, and the planted ones each criterion names
// (the implementer's twins): every test fails them at the assertion that the document or the pack is refused, with a
// message naming it.

import { expect, it } from 'vitest';
import {
  AHEAD, CLEAN, PACKS, aheadRequiring, boardListingAhead, boardRequiring, checked, coreOf, errors, holdsVersion, issues, mentions, packRow,
  present, run, scenario, show, useBuild, useTemp,
} from './helpers.ts';

const bin = useBuild();
const temp = useTemp();
/** One `deep show` of `document` in a fresh store offered `packs`: its reply. */
const shown = (document: Parameters<typeof present>[0], packs: Parameters<typeof scenario>[1] = []): ReturnType<typeof run>[number] =>
  run(bin(), scenario(temp('evidence'), packs, [present(document)]))[0]!;

it('#2058.e29d9bdc a document whose requires.core is one patch above the build\'s core is refused out_of_range at requires/core, its message holding both versions; at the build\'s core it checks clean', () => {
  const core = coreOf(bin(), temp('evidence'));
  const name = `fixtures/documents/board.json with requires.core ${core.above}, one patch above the build's core ${core.text}`;

  const newer = shown(boardRequiring(core.above));
  const got = checked(newer);
  expect(got.outcome, `${name}, is refused; the document check's answer: ${show(newer)}`).toBe('refused');
  const at = errors(issues(newer)).filter((i) => i.code === 'out_of_range' && i.path === 'requires/core');
  expect(at.length, `${name}, is refused by an error out_of_range at requires/core; its errors: ${show(got.errors)}`).toBeGreaterThan(0);
  const messages = at.map((i) => i.what);
  expect(messages.some((m) => holdsVersion(m, core.above) && holdsVersion(m, core.text)), `the message of ${name}, holds the core the document needs (${core.above}) and the build's core (${core.text}); the message: ${JSON.stringify(messages)}`).toBe(true);

  const same = shown(boardRequiring(core.text));
  expect(checked(same), `fixtures/documents/board.json with requires.core ${core.text}, the build's own core, checks clean; the document check's answer: ${show(same)}`).toEqual(CLEAN);
}, 1_100_000);

it('#2058.3cf1dddc the same document with requires.core of soon is refused at requires/core as not a version; with no requires.core it checks clean', () => {
  const name = 'fixtures/documents/board.json with requires.core "soon"';

  const soon = shown(boardRequiring('soon'));
  const got = checked(soon);
  expect(got.outcome, `${name} is refused; the document check's answer: ${show(soon)}`).toBe('refused');
  const at = errors(issues(soon)).filter((i) => i.code === 'out_of_range' && i.path === 'requires/core');
  expect(at.length, `${name} is refused by an error out_of_range at requires/core; its errors: ${show(got.errors)}`).toBeGreaterThan(0);
  const messages = at.map((i) => i.what);
  expect(messages.some((m) => m.includes('not a version')), `${name} is refused as not a version, as a value that is no text is; the message: ${JSON.stringify(messages)}`).toBe(true);

  const none = shown(boardRequiring(null));
  expect(checked(none), `fixtures/documents/board.json with no requires.core checks clean; the document check's answer: ${show(none)}`).toEqual(CLEAN);
}, 1_100_000);

it('#2058.729deb44 a pack whose requires.core is >= one patch above the build\'s core is refused by the pack check out_of_range at its requires/core, its message naming the pack, the range and the build\'s core; with >= the build\'s core it checks clean', () => {
  const core = coreOf(bin(), temp('evidence'));
  const range = `>=${core.above}`;
  const name = `the pack ${AHEAD.id}@${AHEAD.version} (fixtures/packs/ahead-1.0.0) with requires.core ${range}, on the build's core ${core.text}`;

  const ahead = aheadRequiring(range, temp('pack'));
  const row = packRow(run(bin(), scenario(temp('evidence'), [ahead], [PACKS]))[0]!, ahead);
  expect(row.state, `${name}, is refused by the pack check; its row: ${show(row.raw)}`).toBe('refused');
  const at = errors(row.issues).filter((i) => i.code === 'out_of_range' && i.path === 'requires/core');
  expect(at.length, `${name}, is refused by an error out_of_range at requires/core; its row: ${show(row.raw)}`).toBeGreaterThan(0);
  const messages = at.map((i) => i.what);
  expect(
    messages.some((m) => m.includes(AHEAD.name) && m.includes(range) && holdsVersion(m.split(range).join(' '), core.text)),
    `the message of ${name}, names the pack (${AHEAD.name}), the range (${range}) and the build's core (${core.text}); the message: ${JSON.stringify(messages)}`,
  ).toBe(true);

  const within = aheadRequiring(`>=${core.text}`, temp('pack'));
  const clean = packRow(run(bin(), scenario(temp('evidence'), [within], [PACKS]))[0]!, within);
  expect(
    { state: clean.state, errors: errors(clean.issues).map((i) => i.raw) },
    `the pack ${AHEAD.id}@${AHEAD.version} with requires.core >=${core.text}, the build's own core, checks clean; its row: ${show(clean.raw)}`,
  ).toEqual({ state: 'installed', errors: [] });
}, 1_100_000);

it('#2058.d337dccb a document that lists that pack is refused on load, naming the pack and its range', () => {
  const core = coreOf(bin(), temp('evidence'));
  const range = `>=${core.above}`;
  const name = `fixtures/documents/lists-pack.json, which lists the pack ${AHEAD.id}@${AHEAD.version} whose requires.core is ${range} on the build's core ${core.text}`;

  const listing = shown(boardListingAhead(), [aheadRequiring(range, temp('pack'))]);
  const got = checked(listing);
  expect(got.outcome, `${name}, is refused on load; the load's answer: ${show(listing)}`).toBe('refused');
  const naming = errors(issues(listing)).filter((i) => mentions(i.raw, AHEAD.name) && mentions(i.raw, range));
  expect(naming.length, `an error of the load of ${name}, names the pack (${AHEAD.name}) and its range (${range}); its errors: ${show(got.errors)}`).toBeGreaterThan(0);
}, 1_100_000);

// AC9 #1040.055bc0b1: "Two launches that come to the same picture at the same step, one ball at rest and one still
// moving, export as two states whose next frames differ; a page keyed by the picture and the logic alone fails this
// fixture"
//
// The piece (helpers.ts `dropDoc`): a ball inside an opaque chimney, launched up at 1 m/s (soft) or 11 m/s (hard) by the
// waited choice `pick`; at the stage `look` the soft ball has landed and rests while the hard one still rises inside
// the chimney, both hidden; after `go`, at the stage `after`, the hard ball shows above the chimney. No logic item.
// asserts:
//   - the fixture, in the app (png_seq stills on each path's input track): at marker `look` the two launches draw the
//     same picture; at marker `after` they draw apart;
//   - the piece exported as a page (#169's, 480 × 360 at 30 fps): from its start, pick = soft and pick = hard lead to
//     two different states, whose stills decode to the same raw frame hash, the app's at `look`; their successors by
//     go = on are two different states whose stills differ, each the app's at `after` on its path;
//   - the planted `page_keys_by_picture_and_logic` (states keyed by the picture and the logic module's carried state
//     alone) merges the two and fails this judgement, naming the world drop_world.
// Wrong program: the planted page (the merge base's planted name answers bad_input; BASE-FAILURE.txt says what the
// base's own page may already do).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AC, DROP, TIMEOUT, appStills, dropDoc, entry, exportPage, failsNaming, follow, none, pageExported, stillHash, useShow, useTemp, FULL, type JsonObject } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const PLANTED = 'page_keys_by_picture_and_logic';
const pick = (v: string): JsonObject => entry(0.15, 'pick', v);
const go = entry(0.6, 'go', 'on');
const PATHS: Record<string, { track: JsonObject[]; marker: string }> = {
  'soft, at look': { track: [pick('soft')], marker: 'look' },
  'hard, at look': { track: [pick('hard')], marker: 'look' },
  'soft, after': { track: [pick('soft'), go], marker: 'after' },
  'hard, after': { track: [pick('hard'), go], marker: 'after' },
};

let fixture: Map<string, string> | null = null;
/** The app's stills of the four paths, once the fixture holds. */
function app(): Map<string, string> {
  if (fixture) return fixture;
  const stills = appStills(shows(FULL), temp(), dropDoc(), Object.entries(PATHS).map(([name, p]) => ({ name, track: p.track, range: { still: { marker: p.marker } } })),
    { size: DROP.size, rate: DROP.rate }, temp(), 'the chimney');
  expect(stills.get('soft, at look'), 'the fixture: at look the soft and the hard launch draw the same picture').toBe(stills.get('hard, at look'));
  expect(stills.get('soft, after'), 'the fixture: at after the hard ball shows above the chimney and the soft one doesn\'t').not.toBe(stills.get('hard, after'));
  fixture = stills;
  return stills;
}

/** What is wrong with the chimney's page, following its manifest from its start. */
function pageFailures(planted?: string): string[] {
  const stills = app();
  const what = planted ? `the chimney's page (planted ${planted})` : "the chimney's page";
  const out = join(temp(), 'page');
  const m = pageExported(exportPage(shows(FULL), temp(), dropDoc(), out, { size: DROP.size, rate: DROP.rate }, what, planted), out, what);
  const [soft, hard] = [follow(m, m.start, 'pick', 'soft'), follow(m, m.start, 'pick', 'hard')];
  if (soft === null || hard === null) return [`${what}: no edge pick = ${soft === null ? 'soft' : 'hard'} from its start ${m.start}`];
  const f: string[] = [];
  if (soft === hard) f.push(`${what}: pick = soft and pick = hard lead to one state ${soft}: the page merges two states whose world ${DROP.world} differs (one ball at rest, one still moving)`);
  const [softAfter, hardAfter] = [follow(m, soft, 'go', 'on'), follow(m, hard, 'go', 'on')];
  if (softAfter === null || hardAfter === null) return [...f, `${what}: no edge go = on from ${softAfter === null ? soft : hard}`];
  const got = (id: string): string => stillHash(out, m.byId.get(id)!.still, `${what}: state ${id}`);
  if (soft !== hard && got(soft) !== got(hard)) f.push(`${what}: the two launches' states ${soft} and ${hard} draw different pictures at look`);
  if (got(softAfter) === got(hardAfter)) f.push(`${what}: the next frames of the two launches are the same (${softAfter}, ${hardAfter}), though the world ${DROP.world} holds one ball at rest and one still moving`);
  const ends: [string, string][] = [['soft, at look', soft], ['hard, at look', hard], ['soft, after', softAfter], ['hard, after', hardAfter]];
  for (const [name, id] of ends) if (got(id) !== stills.get(name)) f.push(`${what}: state ${id} (${name}) has a still that decodes to ${got(id)}; the app draws ${String(stills.get(name))} (${DROP.world})`);
  return f;
}

describe(`${AC[9]} two launches alike in picture, one ball at rest and one moving, are two states`, () => {
  it(`${AC[9]} the two launches export as two states whose stills match at look and whose next frames differ, each the app's`, () => {
    none(pageFailures(), "the chimney's page");
  }, TIMEOUT);

  it(`${AC[9]} a page keyed by the picture and the logic alone (${PLANTED}) merges the two and fails, naming the world ${DROP.world}`, () => {
    failsNaming(pageFailures(PLANTED), DROP.world, 'the page keyed by the picture and the logic alone');
  }, TIMEOUT);
});

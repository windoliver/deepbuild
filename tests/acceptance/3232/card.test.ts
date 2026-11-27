// AC6: a presented card whose pinned revision moves adds one entry saying the question changed, and the card arms
// again; redrawing the same card adds none.
//
// The world is #3234's redraft's (by import): a real hub's record with one taste call pinned to a document revision,
// `doc:<id>@1`, whose canonical document lists one picture. The replica on a copy of it at the reference window, the
// call's card presented and armed; then the document's next revision, `doc.patched`, with the picture replaced, fed as
// the hub records one (README, The fixtures: the card). One run, read twice: at the move, and after the redraws.
import { afterAll, describe, expect, it } from 'vitest';
import { shared } from '../16/helpers.ts';
import { ACCEPT, askOf, fedRevision, makeWorld } from '../3234-redraft-ac6/helpers.ts';
import { byId, cleanup, MIN, SECOND, Stage } from './helpers.ts';
import { armedAgain, ID, noneAdded, questionChanged, said, type Read } from './judges.ts';

afterAll(cleanup, 5 * MIN);
const LIMIT = 180 * MIN;
const QUESTION = 'Does the new header look right?';
/** `arm_after` (design: Question card). */
const ARM_AFTER_MS = 500;

interface Run { who: string; before: Read; moved: Read; redrawn: Read; armedBefore: unknown; armedAfter: unknown[] }
async function run(): Promise<Run> {
  const w = await makeWorld([{ key: 'header', title: 'Header layout', asks: [{ key: 'one', question: QUESTION, pictures: [[400, 300]], spare: [[400, 300]] }] }]);
  const ask = askOf(w, 'one');
  const who = `the card for ${ask.handle} ("${ask.question}")`;
  const stage = await Stage.on(w);
  try {
    const address = `ask/${ask.handle.slice('ask:'.length)}`;
    // Armed: the card reads armed (#1462's `question-card`) and so does its accepting option (#3234's `card-option:<id>`).
    const card = async (): Promise<unknown> => {
      const s = (await stage.d.see()).snapshot;
      const [whole, option] = [byId(s, 'question-card')?.value, byId(s, `card-option:${ACCEPT}`)?.value];
      return whole === 'armed' && option === 'armed' ? 'armed' : `the card ${said(whole)}, its accepting option ${said(option)}`;
    };
    await stage.d.open(address);
    // The card arms once it has been presented and still for the interval; up to 5 s of the replica's clock.
    for (let waited = 0; waited < 5 * SECOND && (await card()) !== 'armed'; waited += 250) await stage.d.wait(250);
    await stage.d.wait(3 * SECOND);
    const [armedBefore, before] = [await card(), await stage.read()];
    // The pinned revision moves: the document's revision 2, its one picture replaced by a new hash.
    await stage.feed(ask.session, fedRevision(ask, 2, ask.replaced[0]!, Date.now()));
    const armedAfter = [await card()];
    for (let waited = 0; waited < 3 * SECOND; waited += ARM_AFTER_MS / 10) {
      await stage.d.wait(ARM_AFTER_MS / 10);
      armedAfter.push(await card());
    }
    const moved = await stage.read();
    // The same card, drawn again: every view rendered again three times, 2.5 s of frames, and its page opened again.
    for (let i = 0; i < 3; i++) await stage.d.refresh();
    await stage.d.wait(2500);
    await stage.d.open(address);
    await stage.d.wait(SECOND);
    return { who, before, moved, redrawn: await stage.read(), armedBefore, armedAfter };
  } finally {
    await stage.stop();
  }
}
const made = shared(run);

describe(`AC6 ${ID.card} a presented card whose content changed says so once, and arms again`, () => {
  it(`AC6 ${ID.card}: a presented card whose pinned revision moves adds one entry saying the question changed, and the card arms again`, async () => {
    const r = await made();
    expect([...questionChanged({ who: r.who, before: r.before, after: r.moved }), ...armedAgain({ who: r.who, before: r.armedBefore, after: r.armedAfter })]).toEqual([]);
  }, LIMIT);

  it(`AC6 ${ID.card}: redrawing the same card adds none`, async () => {
    const r = await made();
    const said = questionChanged({ who: r.who, before: r.before, after: r.moved });
    expect(said.length ? said.map((f) => `nothing was said that a redraw could say again: ${f}`) : noneAdded({ what: `redrawing ${r.who}`, before: r.moved, after: r.redrawn })).toEqual([]);
  }, LIMIT);
});

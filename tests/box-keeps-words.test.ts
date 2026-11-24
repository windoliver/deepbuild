// The words typed on an ask's page, when the card refuses the press on Send (#1843): the press that brings the window back
// from another app is refused, so Send is often the first thing pressed. The replica's window is resized, which re-arms
// the card too, and Send pressed at once.
import { afterAll, expect, it } from 'vitest';
import { askOf, byId, cleanup, makeWorld, MIN, replicaOf, type Replica } from './acceptance/1461/helpers.ts';

afterAll(cleanup, MIN);
const QUESTION = 'Keep the cart on SQLite or plain files?';
const WORDS = 'plain files, but keep the index';

const read = async (r: Replica): Promise<unknown[]> => {
  const { snapshot } = await r.see();
  return [byId(snapshot, 'question-card')?.value, byId(snapshot, 'box-draft')?.value];
};

it('a Send the card refused leaves your words in the box, and the next one sends them', async () => {
  const world = await makeWorld([{ key: 'b', project: 'shop', title: 'Cart totals', state: 'finished', asks: [{ kind: 'choice', question: QUESTION }] }]);
  const ask = askOf(world, QUESTION);
  const r = await replicaOf(world);
  try {
    await r.open(`ask/${ask.handle.slice('ask:'.length)}`);
    await r.waitValue('question-card', 'armed');
    await r.press('cmd-n');
    await r.type(null, WORDS);
    expect(await read(r), 'before').toEqual(['armed', WORDS]);
    await r.must('resizing the window', { call: 'resize', resize: { size: [1200, 800] } });
    await r.click({ id: 'box-send' });
    expect(await read(r), 'a press on Send inside the new interval').toEqual(['presented', WORDS]);
    await r.waitValue('question-card', 'armed');
    await r.click({ id: 'box-send' });
    const { hub } = await r.close();
    const answers = (hub ?? []).filter((call) => call.method === 'ask.answer');
    expect(answers.map((call) => [call.params.ask, call.params.words])).toEqual([[ask.handle, WORDS]]);
  } finally {
    await r.stop();
  }
}, 30 * MIN);

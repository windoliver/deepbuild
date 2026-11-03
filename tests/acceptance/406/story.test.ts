// AC1: A story number passes in an art film with no bindings, and fails naming the item once the film binds a status
// or a reading, or once it's shown inside a document that does, such as a return card.
// The film shows `Round {data/round}`, with `round` a `data` constant `{value: 3, source: "story"}` (Honest numbers:
// "a story number ... is a data constant with source: story"), in the text item `round-label`. Alone, with a status
// bound and with a reading bound it goes through `deep-canvas-render check`; on a return card through `deep-gpu run`'s
// `host` call (#382's surface for a document shown inside a view of the record).
import { describe, expect, it } from 'vitest';
import {
  TIMEOUT, check, checkedOf, envelope, listed, naming, onReturnCard, shownErrors, shownListing, textItem, useBuilds, useTemp, withReading, withStatus,
} from './helpers.ts';

const bin = useBuilds(['deep-canvas-render', 'deep-gpu']);
const temp = useTemp('story');

const ITEM = 'round-label';
const FILM = envelope('art-film-406', 'film', [textItem(ITEM, 'a1', { template: 'Round {data/round}' })], {
  data: { round: { value: 3, source: 'story' } },
});

describe('AC1 a story number passes only where nothing binds a status or a reading and nothing that does shows it', () => {
  it('AC1 the art film with no bindings passes, listing 3 as a story number; once it binds a status or a reading it fails naming the item', () => {
    const render = bin('deep-canvas-render');
    const alone = check(render, FILM);
    expect(alone.errors.map((e) => `${e.code} ${e.ids.join(',')}`), `alone: the film passes honest numbers: ${shownErrors(alone)}`).toEqual([]);
    expect(alone.ok, 'alone: the check passes').toBe(true);
    expect(listed(alone, ITEM, '3', /story/i).length, `alone: the check lists ${ITEM}'s 3 as a story number: ${shownListing(alone)}`).toBeGreaterThan(0);
    for (const [what, doc] of [['a status bound', withStatus(FILM)], ['a reading bound', withReading(FILM)]] as const) {
      const c = check(render, doc);
      expect(c.ok, `${what}: the check fails: ${shownErrors(c)}`).toBe(false);
      expect(naming(c, 'number_unsourced', ITEM).length, `${what}: number_unsourced names ${ITEM}: ${shownErrors(c)}`).toBeGreaterThan(0);
    }
  }, TIMEOUT);

  it('AC1 the same film, binding nothing, shown on a return card is refused naming the item', () => {
    const reply = onReturnCard(bin('deep-gpu'), temp(), FILM);
    expect(reply['ok'], `the return card refuses the film with its check's issues: ${JSON.stringify(reply).slice(0, 2000)}`).toBe(false);
    const c = checkedOf(reply, 'the host reply');
    expect(naming(c, 'number_unsourced', ITEM).length, `number_unsourced names ${ITEM}: ${shownErrors(c)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});

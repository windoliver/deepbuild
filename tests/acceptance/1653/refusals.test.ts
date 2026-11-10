// AC3 #1653.0a06a5ae: A parallax group with repeat whose child takes a status role, and a `sort: y` group holding a
// status badge, are each refused at check, naming the item
//
// Through `deep-canvas-render check` (every platform) with #467's look less the data roles within its status distance
// (helpers.ts `STATUS_LOOK`), since these documents bind status. A child "takes a status role" the only way a
// status color reaches a mark (the status-color rule): a status binding on its fill; a "status badge" is a status
// binding on an item's badge slot (Status binding: `fill | stroke | badge`). The item named is the one that takes the
// status role or holds the badge (README: Readings). Each refusal has two controls that must pass the same check: the
// same document without the binding, and the same status mark outside the group, so neither the group nor the binding
// alone is what the check refuses.
import { describe, expect, it } from 'vitest';
import { AC, STATUS_LOOK, check, describeErrors, naming, parallaxStatus, sortStatus, useBin, type JsonObject } from './helpers.ts';

const ID = AC[3];
const bin = useBin('deep-canvas-render');

function refusedNaming(d: JsonObject, id: string, what: string): void {
  const { answer, errors } = check(bin(), d, { look: STATUS_LOOK });
  expect(answer['ok'], `${what} is refused at check: ${describeErrors(errors)}`).toBe(false);
  expect(naming(errors, id), `${what}: an error names ${id}: ${describeErrors(errors)}`).toBe(true);
}
function passes(d: JsonObject, what: string): void {
  const { answer, errors } = check(bin(), d, { look: STATUS_LOOK });
  expect(answer['ok'], `${what} passes the check: ${describeErrors(errors)}`).toBe(true);
}

describe(`${ID} status inside a parallax group or a sorting group`, () => {
  it(`${ID} a parallax group with repeat whose child takes a status role is refused at check, naming the item`, () => {
    passes(parallaxStatus('band-plain', { bound: false, inside: true }), 'the repeating band with a lamp in a data role');
    passes(parallaxStatus('band-beside', { bound: true, inside: false }), 'the status lamp beside the repeating band, not in it');
    refusedNaming(parallaxStatus('band-status', { bound: true, inside: true }), 'lamp', 'the repeating band whose child lamp takes a status role');
  });

  it(`${ID} a sort: y group holding a status badge is refused at check, naming the item`, () => {
    passes(sortStatus('line-plain', { bound: false, inside: true }), 'the sorting group without a status badge');
    passes(sortStatus('line-beside', { bound: true, inside: false }), 'the badged post beside the sorting group, drawn after it');
    refusedNaming(sortStatus('line-status', { bound: true, inside: true }), 'post', 'the sorting group holding post\'s status badge');
  });
});

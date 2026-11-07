// Criterion 7, the world half: "A reverse remap is refused at check, naming the remap and the read, when ... its target
// reads a world that takes inputs, and a remap at half rate over the same target is accepted"
//
// Time remap, Semantics: "A remap whose child time can pass its parent's ... is refused at check when its target reads
// the input track, a control, a view input or a world that takes inputs". Through `deep-motion eval`. The forms are in
// the README and helpers.ts: a world inlined under the scene's `worlds`, and a driver on the placement's item reading
// `<world ID>.occurrences`. The twins keep every other part of the refused document, so the world's inputs, the map
// and whether the target is the reader decide the answer, not the document's shape.
import { describe, expect, it } from 'vitest';
import { HALF_RATE, POKE, READ, REMAP, REVERSE, TIMEOUT, WORLD, evalDocs, mentions, scene, show, useBin, world, type JsonObject } from './helpers.ts';

const motion = useBin('deep-motion');

describe('criterion 7, the world half: a remap that can pass its parent over a world that takes inputs', () => {
  it('criterion 7: a reverse remap whose target reads a world that takes inputs is refused, naming the remap and the read', () => {
    const [answer] = evalDocs(motion.bin(), [scene('refused', world(POKE), REVERSE)]);
    expect(answer!['ok'], `the document is refused: ${show(answer)}`).toBe(false);
    expect(mentions(answer, REMAP), `the refusal names the remap ${REMAP}: ${show(answer)}`).toBe(true);
    expect(mentions(answer, WORLD) || mentions(answer, READ), `the refusal names the read, ${WORLD} or ${READ}: ${show(answer)}`).toBe(true);
  }, TIMEOUT);

  it('criterion 7: the twins are accepted: the same reverse remap over a world with no inputs or off the reading item, and a half-rate remap over the same target', () => {
    const twins: [string, JsonObject][] = [
      ['reverse over a world with no inputs field', scene('no_inputs', world(), REVERSE)],
      ['reverse over a world with an empty inputs map', scene('empty_inputs', world({}), REVERSE)],
      ['reverse beside a world with inputs, read by an item outside the target', scene('off_target', world(POKE), REVERSE, 'bystander')],
      ['half rate over the target that reads a world with inputs', scene('half_rate', world(POKE), HALF_RATE)],
    ];
    const answers = evalDocs(motion.bin(), twins.map(([, doc]) => doc));
    const refused = twins.flatMap(([what], i) => (answers[i]!['ok'] === true ? [] : [`${what}: ${show(answers[i])}`]));
    expect(refused, `each twin is accepted:\n  ${refused.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});

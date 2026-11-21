// AC8 #194.d265d3bd: "A catalog.reach whose roots the working agent wrote leaves its requirement INCONCLUSIVE with one ask
// when it passes, and the same roots taken from the brief pass it"
//
// catalog.reach over the fixture with the start kit and the loot table as roots (criterion 4's input), twice through
// the hub: once marked `by: "agent"`, the working agent's own list, and once as the brief gives it. Both runs pass. The
// plug-in's export `catalogSource(input)` gives each run's source, `own` and `definition`, and the verdict engine
// (packages/verdicts, through #184's `judge`) judges the requirement the check covers: INCONCLUSIVE with one ask for the
// agent's roots, PASS for the brief's.
// The wrong programs: the base (no plug-in), a source that reads every input as the definition's (the agent's list
// would pass its requirement), and one that reads every input as the agent's (the brief's list could never pass).
import { describe, expect, it } from 'vitest';
import { judge } from '../184/helpers.ts';
import { AC, TIMEOUT, catalogEntry, openHub, packAll, packCall, prebuildCatalog, runCheck, scratch, show, shown, specOf } from './helpers.ts';
import { MAKES, ROOTS, SCHEMA, catalog } from './fixtures.ts';

prebuildCatalog();

describe(`${AC[8]} roots the working agent wrote bind only its own checks`, () => {
  it(`${AC[8]} the agent's roots pass and leave the requirement INCONCLUSIVE with one ask; the brief's same roots pass it`, async () => {
    const [c] = packAll([packCall(scratch('ac08'), catalog(), SCHEMA)], 'the fixture');
    const hub = await openHub();
    const entry = await catalogEntry();
    expect(typeof entry['catalogSource'], 'the plug-in exports catalogSource(input)').toBe('function');
    const catalogSource = entry['catalogSource'] as (input: unknown) => 'own' | 'definition';
    const brief = { catalog: c!.sha256, roots: ROOTS, makes: MAKES, every: ['items', 'recipes'] };
    const agents = { ...brief, by: 'agent' };

    const own = await runCheck(hub, specOf('catalog.reach', agents, [c!]));
    expect(own.outcome, `catalog.reach on the agent's roots passes: ${shown(own)}`).toBe('passed');
    expect(catalogSource(agents), 'roots the working agent wrote are its own check\'s').toBe('own');
    const v1 = judge(own, catalogSource(agents));
    expect(v1.requirements[0]?.outcome, `its requirement: ${show(v1.reasons)}`).toBe('INCONCLUSIVE');
    expect(v1.asks.length, `with one ask: ${show(v1.asks)}`).toBe(1);

    const theirs = await runCheck(hub, specOf('catalog.reach', brief, [c!]));
    expect(theirs.outcome, `catalog.reach on the brief's roots passes: ${shown(theirs)}`).toBe('passed');
    expect(catalogSource(brief), 'roots the brief gives are the definition\'s').toBe('definition');
    const v2 = judge(theirs, catalogSource(brief));
    expect(v2.requirements[0]?.outcome, `its requirement: ${show(v2.reasons)}`).toBe('PASS');
  }, TIMEOUT);
});

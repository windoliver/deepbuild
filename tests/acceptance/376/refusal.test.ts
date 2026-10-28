// AC1, first sentence: "A fixture figure without a description, one with an unnamed part and one with a
// control without a role are each refused before showing, naming the item and the field, and their fixed
// twins show."
//
// asserts: alpha's deep_show of each wrong figure is `refused` with an error whose `path` is the field
// (`description`; `items/lens/name`; `controls/c-rays/role`) and whose `ids` hold the item (`lens`; `c-rays`),
// and the panel has presented no frame by the time its fixed twin arrives (`refusalFailures`); the fixed twin
// is `presented` and the panel then presents a frame of it.

import { describe, expect, it } from 'vitest';
import {
  FLICKS, figure, frames, none, obj, outcome, presented, refusalFailures, run, scenario, show, useEvidence, useShow,
  type JsonObject,
} from './helpers.ts';

const bin = useShow();
const evidence = useEvidence();

interface Case { what: string; id: string | null; path: string; wrong: () => JsonObject }

const CASES: Case[] = [
  {
    what: 'a figure without a description', id: null, path: 'description',
    wrong: () => { const d = figure(); delete d['description']; return d; },
  },
  {
    what: 'a figure with an unnamed part', id: 'lens', path: 'items/lens/name',
    wrong: () => { const d = figure(); delete obj(obj(d['items'], 'items')['lens'], 'lens')['name']; return d; },
  },
  {
    what: 'a figure with a control without a role', id: 'c-rays', path: 'controls/c-rays/role',
    wrong: () => { const d = figure(); delete obj(obj(d['controls'], 'controls')['c-rays'], 'c-rays')['role']; return d; },
  },
];

describe('AC1 a figure without a description, a name for a part or a role for a control is refused before showing, naming the item and the field', () => {
  for (const c of CASES) {
    it(`AC1 ${c.what} is refused before showing, naming ${c.id ?? 'the document'} and ${c.path}, and its fixed twin shows`, () => {
      const [wrong, before, fixed, after] = run(bin(), scenario(evidence(), [
        show(c.wrong(), 0),
        presented(FLICKS),
        show(figure(), FLICKS),
        presented(2 * FLICKS),
      ]));
      none(refusalFailures(wrong!, before!, c.id, c.path), `${c.what} is refused before showing`);
      expect(outcome(fixed!), `the fixed twin of ${c.what} is presented: ${JSON.stringify(fixed).slice(0, 1200)}`).toBe('presented');
      const shown = frames(after!, 'presented after the fixed twin');
      expect(shown.length, `the panel presents a frame of the fixed twin: ${JSON.stringify(shown)}`).toBeGreaterThanOrEqual(1);
      expect(shown.every((f) => f.vsync >= FLICKS), `every frame presented comes once the fixed twin arrived: ${JSON.stringify(shown)}`).toBe(true);
    });
  }
});

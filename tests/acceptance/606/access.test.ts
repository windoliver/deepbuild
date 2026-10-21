// Criterion 2 (#606.1e9b8ac4): the schema that carries access words accepts `sound`, `microphone`,
// `camera` and `device:<class>` and refuses `device:` with no class and any word outside the list.
//
// The issue doesn't name the schema, so the tests find it by its fixtures: every published schema with a
// fixture holding a string that starts with `device:` carries access words there. See README.md.

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { fixtures, listSchemas, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { expectAccepted, notRefusedAt, setAt, stringLeaves } from './helpers.ts';

const ID = '#606.1e9b8ac4';

/** The words the criterion names, with device classes in the design's forms: `name@major`, and a plug-in's `ext.<plug-in>.<name>@major`. */
const ACCEPTED = ['sound', 'microphone', 'camera', 'device:pen@1', 'device:midi@1', 'device:touches@1', 'device:ext.tiltpad.phone@1'];

/**
 * Words outside the list. The design names notices, schedules and secrets as blocks a manifest declares,
 * "not access words"; the rest are the listed words in a wrong form, near words, and `device` without its
 * class or with another prefix.
 */
const OUTSIDE = ['notices', 'schedules', 'secrets', 'Microphone', 'CAMERA', ' sound', 'sound ', 'sounds', 'mic', 'speaker', 'location', 'bluetooth', 'device', 'devices:pen@1', 'Device:pen@1', 'device;pen@1', ''];

/** Every spelling an implementation might give the design's other access words; the property never generates these. */
const PLAUSIBLE = new Set(['files', 'file', 'programs', 'program', 'exec', 'fs', 'hosts', 'host', 'net', 'network', 'run_as_you', 'run-as-you', 'runasyou',
  'screen', 'sound', 'microphone', 'camera', 'clipboard', 'window', 'agent', 'edit_as_you', 'edit-as-you', 'record', 'read', 'write']);

interface Site { schema: string; fixture: JsonValue; at: string }

/** Every place a published schema's fixture holds an access word `device:…`. */
function sites(): Site[] {
  return listSchemas().flatMap(({ name }) => fixtures(name).flatMap((fixture) =>
    stringLeaves(fixture).filter((leaf) => leaf.value.startsWith('device:')).map((leaf) => ({ schema: name, fixture, at: leaf.path }))));
}

function found(): Site[] {
  const all = sites();
  expect(all.length, 'no published schema has a fixture holding an access word device:<class>, so no schema carries access words').toBeGreaterThan(0);
  return all;
}

describe('criterion 2: access words', () => {
  test(`${ID} the schema that carries access words accepts sound, microphone, camera and device:<class>`, () => {
    for (const site of found()) {
      for (const word of ACCEPTED) {
        expectAccepted(validate(site.schema, setAt(site.fixture, site.at, word)), `${site.schema} with ${JSON.stringify(word)} at ${site.at}`);
      }
    }
  });

  test(`${ID} the schema that carries access words refuses device: with no class, naming it`, () => {
    for (const site of found()) {
      expect(notRefusedAt(validate(site.schema, setAt(site.fixture, site.at, 'device:')), site.at, 'device:'), site.schema).toBeUndefined();
    }
  });

  test(`${ID} the schema that carries access words refuses any word outside the list, naming it`, () => {
    for (const site of found()) {
      for (const word of OUTSIDE) {
        expect(notRefusedAt(validate(site.schema, setAt(site.fixture, site.at, word)), site.at, word), site.schema).toBeUndefined();
      }
      // Any text, and any plain lower-case word longer than every access word.
      const outside = fc.oneof(fc.string({ maxLength: 40 }), fc.stringMatching(/^[a-z]{13,24}$/))
        .filter((word) => !PLAUSIBLE.has(word) && !word.startsWith('device:'));
      fc.assert(fc.property(outside, (word) => {
        const why = notRefusedAt(validate(site.schema, setAt(site.fixture, site.at, word)), site.at, word);
        if (why) throw Error(`${site.schema}: ${why}`);
      }), { numRuns: 1000, seed: 606 });
    }
  });
});

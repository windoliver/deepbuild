// Criterion 1 (#606.9092f0b3): an ask that ends as superseded or moot records that outcome in an event,
// from a closed set, and the asks projection reads it; an outcome outside the set is refused.
//
// Either shape the issue allows passes: an outcome field on a closing ask kind (such as
// `ask.cancelled`'s `data.because`), or a closing kind of its own (`ask.superseded`, `ask.moot`) that the
// asks projection turns into the outcome. See README.md, "Readings".

import fc from 'fast-check';
import { describe, expect, test } from 'vitest';
import { catalogue, checkViewBindings, fixtures, validate } from '../../../packages/contracts/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { ASK_OUTCOMES, expectAccepted, isObject, notRefusedAt, setAt, stringLeaves } from './helpers.ts';

const ID = '#606.9092f0b3';
const OUTCOMES: readonly string[] = ASK_OUTCOMES;
/** The ask kinds that are steps, not endings (canvas-primitives.md, The event catalogue). */
const STEPS = ['created', 'batched', 'later'];
/** Plausible wrong outcomes: the other suggestion outcome, words near the design's, and its two in the wrong form. */
const NEAR_MISSES = ['accepted', 'obsolete', 'withdrawn', 'expired', 'rejected', 'replaced', 'stale', 'closed', 'resolved', 'Superseded', 'MOOT', 'superseded ', ' moot', 'superceded', 'super_seded', ''];

interface OutcomeRecord {
  kind: string;
  schema: string;
  feeds: string[];
  event: JsonValue;
  /** The JSON Pointer of the outcome field, or null when the kind itself is the outcome. */
  at: string | null;
}

/**
 * The events that record `outcome`: a fixture of a catalogued `ask.*` kind, or of a kind the asks projection
 * reads, that is either of kind `ask.<outcome>`, or holds an ask outcome under `/data` at a field that takes
 * `outcome` (the fixture with that field set to it validates).
 */
function records(outcome: string): OutcomeRecord[] {
  return catalogue().flatMap((entry) => {
    if (!entry.kind.startsWith('ask.') && !entry.feeds.includes('asks')) return [];
    return fixtures(entry.schema).flatMap((fixture): OutcomeRecord[] => {
      if (!isObject(fixture)) return [];
      const base = { kind: entry.kind, schema: entry.schema, feeds: entry.feeds };
      if (entry.kind === `ask.${outcome}`) return [{ ...base, event: fixture, at: null }];
      return stringLeaves(fixture.data ?? null, '/data')
        .filter((leaf) => OUTCOMES.includes(leaf.value))
        .map((leaf) => ({ ...base, event: setAt(fixture, leaf.path, outcome), at: leaf.path }))
        .filter((record) => validate(record.schema, record.event).ok);
    });
  });
}

const describeRecord = (r: OutcomeRecord): string => (r.at === null ? `${r.kind} (${r.schema}), the kind itself` : `${r.kind} (${r.schema}) at ${r.at}`);

describe('criterion 1: ask outcomes superseded and moot', () => {
  for (const outcome of ['superseded', 'moot']) {
    test(`${ID} an ask that ends as ${outcome} records that outcome in an event about the ask, of a kind the asks projection reads`, () => {
      const found = records(outcome);
      expect(found.length, `no event records an ask's outcome ${outcome}: the catalogue has no \`ask.${outcome}\` kind, and no fixture of an \`ask.*\` kind or a kind feeding asks holds an outcome field that takes "${outcome}"`).toBeGreaterThan(0);
      for (const record of found) {
        expectAccepted(validate(record.schema, record.event), `${describeRecord(record)} with ${outcome}`);
        // The asks projection reads it: the catalogue (generated from the schemas' x-feeds) says the kind feeds asks.
        expect(record.feeds, `${describeRecord(record)}: the asks projection must read the kind that records ${outcome}`).toContain('asks');
        // It ends an ask: the event is about that ask (the asks table's row), by its ask: handle.
        const subject = isObject(record.event) ? record.event.subject : undefined;
        expect(typeof subject === 'string' && /^ask:[0-9A-Za-z]+$/.test(subject), `${describeRecord(record)}: the event that ends an ask names it as its subject (ask:<id>), got ${JSON.stringify(subject)}`).toBe(true);
      }
    });
  }

  test(`${ID} an ask outcome outside the design's closed set is refused, naming where it sits and the value`, () => {
    const found = [...records('superseded'), ...records('moot')];
    expect(found.length, 'no event records superseded or moot, so there is no outcome to refuse an outside value for').toBeGreaterThan(0);
    for (const record of found) {
      if (record.at !== null) {
        const at = record.at;
        // A field that takes any word, or a set with an outcome the design doesn't list, fails here.
        for (const word of NEAR_MISSES) {
          expect(notRefusedAt(validate(record.schema, setAt(record.event, at, word)), at, word), describeRecord(record)).toBeUndefined();
        }
        fc.assert(fc.property(fc.string({ maxLength: 40 }).filter((s) => !OUTCOMES.includes(s)), (word) => {
          const why = notRefusedAt(validate(record.schema, setAt(record.event, at, word)), at, word);
          if (why) throw Error(`${describeRecord(record)}: ${why}`);
        }), { numRuns: 1000, seed: 606 });
      } else {
        // The kind is the outcome, so the closed set is the catalogue's ask kinds: each one is a step or one
        // of the design's outcomes, and any other ask kind is uncatalogued, which a view can't bind to.
        const askKinds = catalogue().map((e) => e.kind).filter((k) => k.startsWith('ask.'));
        for (const kind of askKinds) {
          const suffix = kind.slice('ask.'.length);
          expect(STEPS.includes(suffix) || OUTCOMES.includes(suffix), `${kind} is an ask ending outside the design's outcomes (${OUTCOMES.join(', ')})`).toBe(true);
        }
        fc.assert(fc.property(fc.stringMatching(/^[a-z][a-z_]{0,24}$/).filter((s) => !OUTCOMES.includes(s) && !STEPS.includes(s)), (word) => {
          const kind = `ask.${word}`;
          const why = notRefusedAt(checkViewBindings([kind]), '/0', kind);
          if (why) throw Error(`the uncatalogued ask ending ${kind}: ${why}`);
          const relabelled = notRefusedAt(validate(record.schema, setAt(record.event, '/kind', kind)), '/kind', kind);
          if (relabelled) throw Error(`${describeRecord(record)} relabelled ${kind}: ${relabelled}`);
        }), { numRuns: 1000, seed: 606 });
      }
    }
  });
});

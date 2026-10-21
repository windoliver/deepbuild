// Criterion 3 (#606.23148a24), its contracts half: a child session's stop and a task's completion each
// resolve to one catalogued kind, new or existing, with a fixture. The kind each resolves to is the one the
// recorded corpus stores for Claude Code's SubagentStop and TaskCompleted (adapters/corpus, read as data);
// corpus.test.mjs holds the replay half. See README.md.

import { describe, expect, test } from 'vitest';
import { catalogue, fixtures, validate } from '../../../packages/contracts/src/index.ts';
import { corpusCases, expectAccepted, isObject, setAt, where } from './helpers.ts';

const ID = '#606.23148a24';

const ENDINGS = [
  {
    what: "a child session's stop",
    hook: 'SubagentStop',
    // The sessions projection (a session's status) or the claims projection (where a stop is judged).
    feeds: ['sessions', 'claims'],
    // Kinds that start what this ends.
    not: ['session.start', 'session.child_started'],
  },
  {
    what: "a task's completion",
    hook: 'TaskCompleted',
    // The tasks projection: the task's state and its last station.
    feeds: ['tasks'],
    not: ['task.created'],
  },
];

describe("criterion 3: kinds for a child's stop and a task's completion", () => {
  for (const ending of ENDINGS) {
    test(`${ID} ${ending.what} resolves to one catalogued kind with a fixture, which the hook may write: the kind the corpus stores for Claude Code's ${ending.hook}`, () => {
      const cases = corpusCases('claude-code').filter((c) => c.payload?.hook_event_name === ending.hook);
      expect(cases.length, `the corpus (adapters/corpus/claude-code) holds no recorded ${ending.hook} payload`).toBeGreaterThan(0);
      for (const c of cases) expect(c.expect?.length ?? 0, `${where(c)}: a recorded ${ending.hook} is stored with no expected event`).toBeGreaterThan(0);

      // One kind: every event every recorded payload of this hook maps to has the same kind.
      const kinds = [...new Set(cases.flatMap((c) => (c.expect ?? []).map((e) => e.kind)))];
      expect(kinds, `${ending.what} resolves to more than one kind across the corpus's ${ending.hook} payloads`).toHaveLength(1);
      const kind = kinds[0]!;

      // Catalogued: generated from a published schema with its x-feeds.
      const entry = catalogue().find((e) => e.kind === kind);
      expect(entry, `${kind}, which the corpus stores for ${ending.hook}, isn't a catalogued kind`).toBeDefined();
      expect(ending.not, `${kind} starts what ${ending.what} ends`).not.toContain(kind);
      expect(entry!.feeds.some((f) => ending.feeds.includes(f)), `${kind} feeds ${JSON.stringify(entry!.feeds)}, none of ${JSON.stringify(ending.feeds)}, so nothing reads ${ending.what}`).toBe(true);

      // With a fixture, valid under its schema.
      const own = fixtures(entry!.schema);
      expect(own.length, `${entry!.schema} has no fixture`).toBeGreaterThan(0);
      for (const fixture of own) expectAccepted(validate(entry!.schema, fixture), `${entry!.schema}'s fixture`);

      // The adapter's events reach the record through deep-hook, so the hub stamps them with the writer
      // `hook` (the Event primitive: the writer comes from the connection). A kind only the core may write
      // can't carry what the hook reports.
      const asHook = own.filter(isObject).map((fixture) => validate(entry!.schema, setAt(fixture, '/writer', 'hook')));
      expect(asHook.some((r) => r.ok), `${entry!.schema} refuses the writer hook: ${JSON.stringify(asHook.flatMap((r) => (r.ok ? [] : r.issues.map(({ code, path, actual }) => ({ code, path, actual })))))}`).toBe(true);
    });
  }
});

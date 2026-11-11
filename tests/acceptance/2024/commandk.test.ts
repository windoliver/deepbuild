// AC1 and AC2 of #2024 (README): what ⌘K takes when it is pasted, and the words it finds across the archive and the
// wiki, read in the real `deep-drive` over a copy of a real hub's record. One world for the file: the Codex session two
// weeks old (archived by the hub, its key scrubbed on the way in), the session that opened the PR and got a PASS, a
// decision and the wiki claim. Each test opens a replica of its own.
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { cleanup, ID, makeWorld, MIN, pastedPr, replicaOf, twoInFlight, unnamedAtDeepOpen, unnamedInCommandK, wordsFound, type World } from './helpers.ts';

let w: World;
beforeAll(async () => { w = await makeWorld(); }, 20 * MIN);
afterAll(cleanup, 120_000);

const none = (failures: readonly string[], what: string): void => expect(failures, `${what}:\n${failures.join('\n')}\n`).toEqual([]);

describe(`AC1 ${ID.paste} references pasted into ⌘K and deep open`, () => {
  test(`AC1 ${ID.paste}: pasting a PR URL opens the session that made it, with its verdict`, async () => {
    const r = await replicaOf(w);
    try { none(await pastedPr(r, w), 'pasting the PR URL in ⌘K'); } finally { await r.stop(); }
  });

  test(`AC1 ${ID.paste}: a SHA prefix nothing names lists the kinds accepted, in ⌘K and at deep open`, async () => {
    const r = await replicaOf(w);
    const failures: string[] = [];
    try { failures.push(...(await unnamedInCommandK(r))); } finally { await r.stop(); }
    failures.push(...(await unnamedAtDeepOpen(w)));
    none(failures, 'a SHA prefix nothing names');
  });

  test(`AC1 ${ID.paste}: with two queries in flight only the later one's results show`, async () => {
    const r = await replicaOf(w);
    try { none(await twoInFlight(r, w), 'two queries in flight'); } finally { await r.stop(); }
  });
});

describe(`AC2 ${ID.words} words across archived transcripts and wiki claims`, () => {
  test(`AC2 ${ID.words}: ⌘K "reconnect backoff" lists the Codex session's message and the wiki claim, opens the session's page at that message, and no hit shows the scrubbed key`, async () => {
    const r = await replicaOf(w);
    try { none((await wordsFound(r, w)).failures, '⌘K "reconnect backoff"'); } finally { await r.stop(); }
  });

  // The wrong programs the criterion names (README, Pinned 5): each must make the judge above fail, naming the session.
  test(`AC2 ${ID.words}: a ⌘K that searches only references fails, naming the session`, async () => {
    const r = await replicaOf(w, 'commandk-references-only');
    try {
      none(await pastedPr(r, w), 'the planted ⌘K that searches only references must still open a pasted PR URL, or it is not the wrong program the criterion names');
      const found = await wordsFound(r, w);
      expect(found.failures.some((f) => f.includes(w.codex)), `the planted ⌘K that searches only references must fail AC2's judge naming the Codex session ${w.codex}; the judge found: ${found.failures.join('\n') || 'nothing wrong'}`).toBe(true);
    } finally { await r.stop(); }
  });

  test(`AC2 ${ID.words}: a ⌘K that reads the agent's own transcript files instead of the archive fails, naming the session`, async () => {
    const r = await replicaOf(w, 'commandk-reads-agent-files');
    try {
      const found = await wordsFound(r, w);
      expect(found.listed, `the planted ⌘K that reads the agent's own files must find the Codex session's message in its rollout (${w.rollout}), or it is not the wrong program the criterion names; the judge found: ${found.failures.join('\n')}`).toBe(true);
      expect(found.failures.some((f) => f.includes(w.codex)), `the planted ⌘K that reads the agent's own files must fail AC2's judge naming the Codex session ${w.codex}; the judge found: ${found.failures.join('\n') || 'nothing wrong'}`).toBe(true);
    } finally { await r.stop(); }
  });
});

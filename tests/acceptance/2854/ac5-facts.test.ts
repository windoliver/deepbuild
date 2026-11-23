// #2854 AC5: "Claude Code's and Codex's facts each name the revision their client opens the handshake with, for every
// covered version, with the recorded request beside it. With the held list cut back to lack a revision the facts name,
// the conformance check fails, naming the agent and the revision"
//
// Read as the issue's "Where the list, the facts and the check live" names it. The facts: adapters/claude-code.facts.json
// and adapters/codex.facts.json at `adapter.facts@9`, a section `mcpHandshake` of `{readBy, conformance, entries}`, one
// entry `{versions, revision, request}` per covered version, `request` the path from the checkout's root of
// `adapters/corpus/<agent>/<version>/mcp-initialize.json`, one JSON document naming that revision as
// `params.protocolVersion`. The check: `node scripts/corpus.mjs check` from the checkout's root; the plant: a copy of
// the checkout with mcp.handshake@1.json's enum less a revision a facts entry names, the check run there. It must exit
// non-zero with a line naming the agent (the facts file's `agent`), the version and the revision.
//
// The second test first asserts that the facts name revisions and that the entry exists, so on a checkout without
// them (the base) it fails there, at an assertion, before it copies anything.
import { describe, expect, it } from 'vitest';
import {
  AC, copyCheckout, corpusCheck, cutBack, ENTRY, facts, FACTS_FILES, handshakeEntries, handshakeFactsFailures, heldList, namesWord,
} from './helpers.ts';

describe(`${AC.facts} each agent's facts name the revision its client opens the handshake with`, () => {
  for (const file of FACTS_FILES) {
    it(`${AC.facts} ${file}'s facts name in mcpHandshake, for every covered version, a held revision its MCP client opens with, and the recorded request adapters/corpus/${file}/<version>/mcp-initialize.json names it`, () => {
      expect(handshakeFactsFailures(file), `adapters/${file}.facts.json, version by version`).toEqual([]);
    });
  }

  it(`${AC.facts} with mcp.handshake@1's enum cut back to lack a revision the facts name, node scripts/corpus.mjs check exits non-zero with a line naming the agent, the version and the revision`, () => {
    // What the facts name: per revision, each agent (the facts file's `agent`) and the versions it opens with it.
    const named = new Map<string, Array<{ agent: string; versions: string[] }>>();
    for (const file of FACTS_FILES) {
      const f = facts(file);
      for (const entry of handshakeEntries(f)) {
        const list = named.get(entry.revision) ?? [];
        list.push({ agent: String(f.agent), versions: entry.versions });
        named.set(entry.revision, list);
      }
    }
    expect([...named.keys()], 'the revisions the claude-code and codex facts\' mcpHandshake entries name').not.toEqual([]);
    const { revisions, failure } = heldList();
    expect(failure, `the contract entry ${ENTRY}`).toBeUndefined();
    expect([...named.keys()].filter((r) => !revisions!.includes(r)), `revisions the facts name that ${ENTRY} lacks before the cut`).toEqual([]);

    // The check in the copy before any cut: only lines it prints after a cut and not before are read, so a line the
    // check prints anyway (it may fail on cases of its own) is never taken for the plant's.
    const copy = copyCheckout();
    const beforeLines = new Set(corpusCheck(copy).lines);

    const missing: string[] = [];
    for (const [revision, agents] of named) {
      cutBack(copy, revision);
      const after = corpusCheck(copy);
      expect(after.status, `node scripts/corpus.mjs check with ${ENTRY}'s enum less ${revision}: its exit code`).not.toBe(0);
      const fresh = after.lines.filter((l) => !beforeLines.has(l));
      for (const { agent, versions } of agents) {
        const line = fresh.find((l) => namesWord(l, agent) && namesWord(l, revision) && versions.some((v) => namesWord(l, v)));
        if (!line) missing.push(`less ${revision}: no line names ${agent}, one of ${versions.join(', ')}, and ${revision}; new lines: ${JSON.stringify(fresh.slice(0, 20))}`);
      }
    }
    expect(missing, 'the check names the agent, the version and the revision the cut list lacks').toEqual([]);
  }, 900_000);
});

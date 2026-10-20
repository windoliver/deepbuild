import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { shipped } from '../../../packages/adapters/src/index.ts';
import type { JsonValue } from '../../../packages/contracts/src/index.ts';
import { validate } from '../../../packages/contracts/src/index.ts';
import { corpusPayloads, eventFixture, expectAccepted, fixture, isObject, kindSchema, only, request, setAt } from './helpers.ts';
import type { EditFixture, JsonObject } from './helpers.ts';

const claudeEdit = fixture('edits', 'claude-edit.json') as unknown as EditFixture;
const codexPatch = fixture('edits', 'codex-apply-patch.json') as unknown as EditFixture;
const codexShell = fixture('edits', 'codex-patch-shell.json') as unknown as EditFixture;
const codexMany = fixture('edits', 'codex-patch-many.json') as unknown as EditFixture;

const edit = (agent: string, payload: JsonObject, version: string): JsonObject => {
  const event = only(shipped().mapHook(request(agent, payload), version), 'tool.before', `${agent} ${String(payload.tool_name)}`);
  expect(event.agent).toBe(agent);
  return event.data;
};

describe('AC1 Codex\'s apply_patch and Claude Code\'s Edit both record as an edit with the same paths', () => {
  it('AC1 the two calls on /work/notes.md record kind edit with one and the same path list', () => {
    const claude = edit('claude', claudeEdit.payload, claudeEdit.version);
    const codex = edit('codex', codexPatch.payload, codexPatch.version);
    // An adapter that leaves apply_patch a shell call, or keeps the patch's relative path, fails here.
    expect(claude.kind).toBe('edit');
    expect(codex.kind).toBe('edit');
    expect(claude.paths).toEqual(['/work/notes.md']);
    expect(codex.paths).toEqual(claude.paths);
  });

  it('AC1 a patch sent through the shell tool, in a heredoc after a cd, with indented markers, is the same edit', () => {
    const codex = edit('codex', codexShell.payload, codexShell.version);
    expect(codex.kind).toBe('edit');
    expect(codex.paths).toEqual(['/work/notes.md']);
    // The patch's text is not a shell command the guards should read as one.
    expect(codex.command ?? null).toBeNull();
  });

  it('AC1 every path line counts: Add File, Update File, Move to and Delete File, resolved against the working folder with .. folded', () => {
    const codex = edit('codex', codexMany.payload, codexMany.version);
    expect(codex.kind).toBe('edit');
    expect([...(codex.paths as string[])].sort()).toEqual(codexMany.paths);
  });

  it('AC1 a Claude Edit named relative to cwd, or through .., records the same resolved path as the patch', () => {
    const relative = setAt(claudeEdit.payload, '/tool_input/file_path', 'sub/../notes.md') as JsonObject;
    expect(edit('claude', relative, claudeEdit.version).paths).toEqual(['/work/notes.md']);
    const dotted = setAt(claudeEdit.payload, '/tool_input/file_path', '/work/./sub/../notes.md') as JsonObject;
    expect(edit('claude', dotted, claudeEdit.version).paths).toEqual(['/work/notes.md']);
  });

  it('AC1 for every relative path, the Edit and the patch on it record the same path (1,000 cases)', () => {
    const segment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,7}$/);
    const rel = fc.array(fc.oneof({ weight: 4, arbitrary: segment }, { weight: 1, arbitrary: fc.constant('..') }), { minLength: 1, maxLength: 4 })
      .filter((parts) => parts[parts.length - 1] !== '..')
      .map((parts) => parts.join('/'));
    fc.assert(fc.property(rel, (path) => {
      const claude = edit('claude', setAt(claudeEdit.payload, '/tool_input/file_path', path) as JsonObject, claudeEdit.version);
      const patch = `*** Begin Patch\n*** Update File: ${path}\n@@\n-one\n+two\n*** End Patch`;
      const codex = edit('codex', setAt(codexPatch.payload, '/tool_input/command', patch) as JsonObject, codexPatch.version);
      expect(codex.kind).toBe('edit');
      expect(claude.kind).toBe('edit');
      expect(codex.paths).toEqual(claude.paths);
      const [single] = claude.paths as string[];
      expect(single!.startsWith('/')).toBe(true);
      expect(single!.includes('/../') || single!.includes('/./')).toBe(false);
    }), { numRuns: 1000 });
  });

  it('AC1 the corpus\'s recorded apply_patch and Edit calls replay as edits whose paths are the files they named', () => {
    const codexTools = corpusPayloads('codex', '0.160.0', 'tools').filter((p) => p.hook_event_name === 'PreToolUse' && p.tool_name === 'apply_patch');
    const claudeTools = corpusPayloads('claude-code', '2.1.304', 'tools').filter((p) => p.hook_event_name === 'PreToolUse' && p.tool_name === 'Edit');
    expect(codexTools.length).toBeGreaterThan(0);
    expect(claudeTools.length).toBeGreaterThan(0);
    for (const payload of codexTools) {
      const data = edit('codex', payload, '0.160.0');
      expect(data.kind).toBe('edit');
      expect(data.paths).toEqual(['/private/tmp/deep-corpus-tools-1792479670970/added.txt']);
    }
    for (const payload of claudeTools) {
      const data = edit('claude', payload, '2.1.304');
      expect(data.kind).toBe('edit');
      expect(data.paths).toEqual([(payload.tool_input as JsonObject).file_path]);
    }
  });

  it('AC1 an edit the adapters record fits the published tool-call shape: kind edit with its paths and no command', () => {
    const data = edit('codex', codexPatch.payload, codexPatch.version);
    const shaped: JsonValue = { kind: 'edit', paths: data.paths as JsonValue, command: null };
    expectAccepted(validate(kindSchema('tool.before'), setAt(eventFixture('tool.before'), '/data', shaped)), 'an edit with its paths');
    expect(isObject(data) && Array.isArray(data.paths)).toBe(true);
  });
});

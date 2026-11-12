// What a working session's turn is doing now (#2021), past what the blind suite reads (an Edit, a Bash call that runs,
// fails and waits at its prompt): a fetch names its host, never its path or query, from a hook sent through the hub's
// own mapping; and the read, search and fetch verbs in each tense the Scope lists.
import { expect, it } from 'vitest';
import { doingOf } from '../src/rows.js';
import { parseLine } from '../src/hookmap.js';

/** What the hub records before a WebFetch call, from the hook as deep-hook sends it. */
function fetched(url: string): Record<string, unknown> {
  const line = JSON.stringify({
    v: 1, agent: 'claude-code', event: 'PreToolUse', seq: '1', id: '01K74FKZVK8Q2X5R7M3N9P0001', pid: 1, ppid: 1, matched: [],
    payload: { session_id: '1e2053ee-a7c7-46ca-8eeb-8972a74be1ae', cwd: '/private/tmp/shop', hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url, prompt: 'Read it' }, tool_use_id: 'toolu_01Eco2SaDunqGtHwZFpznoiq', permission_mode: 'auto' },
  });
  const parsed = parseLine(Buffer.from(line), true, []);
  if (parsed.kind !== 'hook') throw Error(`not a hook: ${JSON.stringify(parsed)}`);
  return parsed.drafts.find((d) => d.kind === 'tool.before')!.data;
}

it('a fetch is recorded with its host alone, and its line names that host in each tense', () => {
  const data = fetched('https://docs.example.com/guide/install?token=abc#top');
  expect(data).toMatchObject({ kind: 'fetch', host: 'docs.example.com' });
  expect(JSON.stringify(data)).not.toContain('token=abc');
  const start = { kind: 'tool.before', data, ts: 1_000 };
  expect(doingOf(start, undefined, '/private/tmp/shop')).toEqual({ words: 'Fetching docs.example.com', at: 1_000, ago: false });
  // An ended call carries no host of its own: its start's names it.
  const ended = { kind: 'tool.after', data: { kind: 'fetch', paths: [], command: null, call: data.call, outcome: 'ok' }, ts: 2_000 };
  expect(doingOf(ended, start, '/private/tmp/shop')).toEqual({ words: 'Fetched docs.example.com', at: 2_000, ago: true });
});

it('a read names its file by its short path, and a search its verb alone', () => {
  const read = { kind: 'read', paths: ['/private/tmp/shop/src/grid.ts'], command: null };
  expect(doingOf({ kind: 'tool.before', data: read, ts: 5 }, undefined, '/private/tmp/shop').words).toBe('Reading src/grid.ts');
  expect(doingOf({ kind: 'tool.after', data: { ...read, outcome: 'ok' }, ts: 6 }, undefined, '/private/tmp/shop').words).toBe('Read src/grid.ts');
  const search = { kind: 'search', paths: [], command: null };
  expect(doingOf({ kind: 'tool.before', data: search, ts: 7 }, undefined, '/private/tmp/shop').words).toBe('Searching');
  expect(doingOf({ kind: 'tool.after', data: { ...search, outcome: 'failed' }, ts: 8 }, undefined, '/private/tmp/shop').words).toBe("Couldn't search");
});

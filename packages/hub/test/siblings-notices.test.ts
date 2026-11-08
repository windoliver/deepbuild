// The session map's line ranges from Claude Code's real structuredPatch, the loop rule after a "hold" answer, an edit
// whose PreToolUse comes late, and the map read back after a restart (#352).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { parseLine } from '../src/hookmap.js';
import { Siblings, type SiblingOptions } from '../src/siblings.js';
import type { Draft, HookMeta } from '../src/wire.js';

const dir = mkdtempSync(join(tmpdir(), 'deep-siblings-notices-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' });
let worlds = 0;
/** A repo with worktrees wa and wb, on branches a/issue-7 and b/issue-8. */
function world(): { wa: string; wb: string } {
  const root = join(dir, `w${++worlds}`);
  const repo = join(root, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/cart.js'), `${Array.from({ length: 40 }, (_, i) => `l${i + 1}`).join('\n')}\n`);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'worktree', 'add', '-q', '-b', 'a/issue-7', join(root, 'wa'));
  git(repo, 'worktree', 'add', '-q', '-b', 'b/issue-8', join(root, 'wb'));
  return { wa: join(root, 'wa'), wb: join(root, 'wb') };
}
const options = (extra: Partial<SiblingOptions> = {}): SiblingOptions => ({
  raw: async () => [], append: async () => undefined, ask: async () => 'ask:01', wake: async () => false,
  acking: () => undefined, queue: (work) => void work(), now: () => Date.now(), ...extra,
});
let seq = 0;
/** A Claude Code hook as deep-hook sends it, through the hub's own mapping. */
function hook(session: string, cwd: string, event: string, use: string, extra: Record<string, unknown> = {}): { drafts: Draft[]; meta: HookMeta } {
  const line = JSON.stringify({
    v: 1, agent: 'claude-code', event, seq: String(++seq), id: `01K74FKZVK8Q2X5R7M3N9P${String(seq).padStart(4, '0')}`, pid: 1, ppid: 1, matched: [],
    payload: { session_id: session, cwd, hook_event_name: event, tool_name: 'Edit', tool_input: { file_path: join(cwd, 'src/cart.js'), old_string: 'x', new_string: 'y' }, tool_use_id: use, ...extra },
  });
  const parsed = parseLine(Buffer.from(line), true, []);
  if (parsed.kind !== 'hook') throw Error(`not a hook: ${JSON.stringify(parsed)}`);
  return parsed;
}
const post = (session: string, cwd: string, use: string, structuredPatch: object[]) => hook(session, cwd, 'PostToolUse', use, { tool_response: { filePath: join(cwd, 'src/cart.js'), structuredPatch } });
/** A hunk as Claude Code reports it: three lines of context each side of the change. */
const patch = (oldStart: number, newStart: number, lines: string[]) => ({
  oldStart, newStart, lines,
  oldLines: lines.filter((l) => !l.startsWith('+')).length, newLines: lines.filter((l) => !l.startsWith('-')).length,
});
const until = () => Date.now() + 60_000;

it("counts only the lines an edit changed, not the context lines Claude Code's structuredPatch carries around them", async () => {
  const { wa, wb } = world();
  const siblings = new Siblings(options());
  const edit = async (use: string, hunks: object[]) => {
    const pre = hook('b', wb, 'PreToolUse', use);
    await siblings.hook(pre.drafts, pre.meta);
    const after = post('b', wb, use, hunks);
    await siblings.hook(after.drafts, after.meta);
  };
  const a = hook('a', wa, 'PreToolUse', 'a1');
  await siblings.hook(a.drafts, a.meta);
  // Line 17 changed.
  await edit('b1', [patch(14, 14, [' l14', ' l15', ' l16', '-l17', '+L17', ' l18', ' l19', ' l20'])]);
  expect(siblings.row('b')?.files).toEqual([{ path: 'src/cart.js', lines: '17' }]);
  // One line inserted at line 2, which moves line 17 to 18, and old line 21 (now 22) changed, its context 18-24 (now 19-25).
  await edit('b2', [patch(1, 1, [' l1', '+X', ' l2', ' l3', ' l4']), patch(18, 19, [' l18', ' l19', ' l20', '-l21', '+L21', ' l22', ' l23', ' l24'])]);
  expect(siblings.row('b')?.files).toEqual([{ path: 'src/cart.js', lines: '2, 18, 22' }]);
  // Line 23 changed: its context 20-26 holds line 22, which stays.
  await edit('b3', [patch(20, 20, [' l19', ' l20', ' L21', '-l22', '+L22', ' l23', ' l24', ' l25'])]);
  expect(siblings.row('b')?.files).toEqual([{ path: 'src/cart.js', lines: '2, 18, 22-23' }]);
  const told = await siblings.deliver(hook('a', wa, 'PreToolUse', 'a2').meta, until());
  expect(told).toContain('lines 2, 18, 22-23');
  siblings.stop();
});

it('a "hold" answer to the loop ask holds the pair\'s next prompts without asking again, until you prompt the session', async () => {
  const { wa } = world();
  const asked: string[] = [];
  let status = 'open';
  const siblings = new Siblings(options({
    ask: async (_s, _a, _c, _source, ask) => { asked.push(String(ask.question)); return `ask:0${asked.length}`; },
    raw: async (query) => (query.startsWith('SELECT status, answer FROM asks') ? [{ status, answer: status === 'open' ? null : 'hold' }] : []),
  }));
  const start = hook('a', wa, 'PreToolUse', 'a1');
  await siblings.hook(start.drafts, start.meta);
  const now = Date.now();
  for (let i = 0; i < 21; i++) siblings.turn('a', `p${i}`, 'session', now);
  const prompt = hook('a', wa, 'UserPromptSubmit', '').meta;
  expect(await siblings.held(prompt, 'session', async () => undefined)).toContain('held');
  await new Promise((done) => setTimeout(done, 0));
  expect(asked).toHaveLength(1);
  status = 'answered';
  siblings.turn('a', 'p21', 'session', now);
  expect(await siblings.held(prompt, 'session', async () => undefined)).toContain('held');
  siblings.turn('a', 'p22', 'session', now);
  expect(await siblings.held(prompt, 'session', async () => undefined)).toContain('held');
  await new Promise((done) => setTimeout(done, 0));
  expect(asked).toHaveLength(1);
  siblings.turn('a', 'you', 'person', now);
  siblings.turn('a', 'p23', 'session', now);
  expect(await siblings.held(prompt, 'session', async () => undefined)).toBeUndefined();
  siblings.stop();
});

it('an edit whose PostToolUse comes before its PreToolUse still tells this session which other session changed the file', async () => {
  const { wa, wb } = world();
  const siblings = new Siblings(options());
  const a1 = hook('a', wa, 'PreToolUse', 'a1');
  await siblings.hook(a1.drafts, a1.meta);
  const b0 = hook('b', wb, 'SessionStart', '');
  await siblings.hook(b0.drafts, b0.meta);
  await siblings.deliver(b0.meta, until());
  const ahead = post('b', wb, 'b1', [patch(1, 1, [' l1', '-l2', '+L2', ' l3'])]);
  await siblings.hook(ahead.drafts, ahead.meta);
  const late = hook('b', wb, 'PreToolUse', 'b1');
  await siblings.hook(late.drafts, late.meta);
  expect(await siblings.deliver(hook('b', wb, 'PreToolUse', 'b2').meta, until()) ?? '(nothing)').toContain('session a (claude-code) also changed src/cart.js');
  siblings.stop();
});

it('a session read back after a restart is on its branch and issue before it hooks again', async () => {
  const { wa } = world();
  const siblings = new Siblings(options({
    raw: async (query) => (query.includes('FROM sessions') ? [{ id: 'a', agent: 'claude-code', worktree: wa, last_seen: Date.now() }]
      : query.includes('FROM session_files') ? [{ path: 'src/cart.js' }] : []),
  }));
  await siblings.restore();
  expect(siblings.row('a')).toMatchObject({ branch: 'a/issue-7', issue: 7, files: [{ path: 'src/cart.js', lines: '' }] });
  siblings.stop();
});

/** A hub started again on a record of these asks and prompts, with 21 turns of a's started by another session's messages: what a's next such prompt, or `to`'s, is told, and the asks raised. */
async function restarted(asks: object[], prompts: object[], to: 'a' | 'b' = 'a') {
  const { wa, wb } = world();
  const now = Date.now();
  const peers = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, session_id: 'a', ts: now - 60_000 + i, origin: 'session' }));
  const asked: string[] = [];
  const siblings = new Siblings(options({
    ask: async (_s, _a, _c, _source, ask) => { asked.push(String(ask.question)); return 'ask:09'; },
    raw: async (query, params) => {
      if (query.includes("kind = 'user.ask' AND ts >=")) return [...peers, ...prompts];
      if (query.includes('FROM asks WHERE status IN') || query.includes('FROM asks WHERE session_id')) return asks;
      if (query.startsWith('SELECT status, answer FROM asks')) return (asks as { id: string }[]).filter((a) => a.id === params?.[0]);
      if (query.includes("IN ('person', 'app')")) return (prompts as { session_id: string; ts: number }[]).filter((p) => p.session_id === params?.[0] && p.ts > Number(params?.[1]));
      return [];
    },
  }));
  await siblings.restore();
  const start = hook('a', wa, 'PreToolUse', 'a1');
  await siblings.hook(start.drafts, start.meta);
  const told = await siblings.held(hook(to, to === 'a' ? wa : wb, 'UserPromptSubmit', '').meta, 'session', async () => undefined);
  await new Promise((done) => setTimeout(done, 0));
  siblings.stop();
  return { told, asked };
}

it('after a restart, a loop ask you answered "hold" still holds without asking again, and one your prompt came after holds nothing', async () => {
  const now = Date.now();
  const question = 'Session a (claude-code) had 21 turns started by another session\'s messages in the last 10 minutes, with no prompt from you. Let it go on?';
  // Answered "hold" before the restart, no prompt from you since: still held, never asked again.
  const hold = await restarted([{ id: '01', session_id: 'a', created: now - 30_000, status: 'answered', answer: 'hold', question }], []);
  expect(hold.told).toContain('held');
  expect(hold.asked).toHaveLength(0);
  // Still open, but you prompted the session after it was raised, and no peer turn came since: nothing held.
  const prompted = await restarted([{ id: '02', session_id: 'a', created: now - 50_000, status: 'open', answer: null, question }], [{ id: 'you', session_id: 'a', ts: now - 1_000, origin: 'person' }]);
  expect(prompted.told).toBeUndefined();
  expect(prompted.asked).toHaveLength(0);
});

it('after a restart, a "hold" you gave a pair of sessions still holds the other one too', async () => {
  const now = Date.now();
  const question = "Sessions a (claude-code) and b (claude-code) started 21 of a's turns with each other's messages in the last 10 minutes, with no prompt from you. Let them go on?";
  // The core raises every ask with its key hashed, so the record names the pair only in the question.
  const toB = await restarted([{ id: '03', key: '5f2c8e0d9a7b4c1e3f6a8d2b0c4e7f9a1b3d5c7e9f0a2b4c6d8e0f1a3b5c7d9e', session_id: 'a', created: now - 30_000, status: 'answered', answer: '"hold"', question }], [], 'b');
  expect(toB.told).toContain('you said to hold');
  expect(toB.asked).toHaveLength(0);
});

/** A live hub where 21 of a's turns came from another session's messages, its loop ask's row as `ask` says. */
function looping(ask: { status: string; answer: string | null }, sender?: string) {
  const { wa, wb } = world();
  const asked: string[] = [];
  const siblings = new Siblings(options({
    ask: async (_s, _a, _c, _source, a) => { asked.push(String(a.question)); return `ask:0${asked.length}`; },
    raw: async (query) => (query.startsWith('SELECT status, answer FROM asks') ? [ask] : []),
  }));
  const now = Date.now();
  for (let i = 0; i < 21; i++) siblings.turn('a', `p${i}`, 'session', now);
  const held = (session: 'a' | 'b') => siblings.held(hook(session, session === 'a' ? wa : wb, 'UserPromptSubmit', '').meta, 'session', async () => sender);
  return { siblings, asked, held, now, settle: () => new Promise((done) => setTimeout(done, 0)) };
}

it('a "hold" for two sessions stops holding the one you prompted, even when the other is held after', async () => {
  const ask = { status: 'open', answer: null as string | null };
  const { siblings, held, now, settle } = looping(ask, 'b');
  expect(await held('a')).toContain('held');
  await settle();
  Object.assign(ask, { status: 'answered', answer: '"hold"' });
  siblings.turn('b', 'you', 'person', now);
  expect(await held('a')).toContain('you said to hold');
  expect(await held('b')).toBeUndefined();
  siblings.stop();
});

it('a "go on" given after a "hold" lets the sessions go on', async () => {
  const ask = { status: 'defaulted', answer: '"hold"' as string | null };
  const { siblings, held, settle } = looping(ask);
  expect(await held('a')).toContain('held');
  await settle();
  expect(await held('a')).toContain('you said to hold');
  // You undid the default and answered "go on".
  Object.assign(ask, { status: 'answered', answer: '"go-on"' });
  expect(await held('a')).toBeUndefined();
  siblings.stop();
});

it('a loop ask closed with no answer holds until you prompt the session, never says you said to hold, and never asks again', async () => {
  const ask = { status: 'open', answer: null as string | null };
  const { siblings, asked, held, now, settle } = looping(ask);
  expect(await held('a')).toContain('held');
  await settle();
  ask.status = 'cancelled';
  const told = await held('a');
  await settle();
  expect(told).toContain('closed with no answer');
  expect(told).not.toContain('you said');
  expect(asked).toHaveLength(1);
  siblings.turn('a', 'you', 'person', now);
  expect(await held('a')).toBeUndefined();
  siblings.stop();
});

it('after a restart, a loop ask closed with no answer still holds, never asking again', async () => {
  const now = Date.now();
  const question = 'Session a (claude-code) had 21 turns started by another session\'s messages in the last 10 minutes, with no prompt from you. Let it go on?';
  const closed = await restarted([{ id: '04', session_id: 'a', created: now - 30_000, status: 'cancelled', answer: null, question }], []);
  expect(closed.told).toContain('closed with no answer');
  expect(closed.asked).toHaveLength(0);
});

/** A live hub whose loop asks' rows are `rows`, by ask ID, each raised as ask:01, ask:02, ...; `loop(s)` gives s 21 turns from other sessions' messages. */
function asksWorld() {
  const { wa, wb } = world();
  const rows = new Map<string, { status: string; answer: string | null }>();
  const asked: string[] = [];
  const siblings = new Siblings(options({
    ask: async (_s, _a, _c, _source, a) => { asked.push(String(a.question)); const id = `0${asked.length}`; rows.set(id, { status: 'open', answer: null }); return `ask:${id}`; },
    raw: async (query, params) => (query.startsWith('SELECT status, answer FROM asks') ? [rows.get(String(params?.[0]))].filter(Boolean) : []),
  }));
  const now = Date.now();
  const loop = (session: string) => { for (let i = 0; i < 21; i++) siblings.turn(session, `${session}${i}`, 'session', now); };
  const held = (session: string, sender?: string) => siblings.held(hook(session, session === 'a' ? wa : wb, 'UserPromptSubmit', '').meta, 'session', async () => sender);
  return { siblings, rows, asked, loop, held, now, settle: () => new Promise((done) => setTimeout(done, 0)) };
}

it('"go on" to one loop ask lets go only the sessions that ask still holds, not one another loop ask holds since', async () => {
  const { siblings, rows, loop, held, now, settle } = asksWorld();
  loop('a');
  expect(await held('a', 'b')).toContain('held');
  await settle();
  // You prompt b, then b and c loop: their ask holds b.
  siblings.turn('b', 'you', 'person', now);
  loop('b');
  expect(await held('b', 'c')).toContain('held');
  await settle();
  rows.set('01', { status: 'answered', answer: '"go-on"' });
  expect(await held('a')).toBeUndefined();
  expect(await held('b')).toContain('held');
  siblings.stop();
});

it('a loop ask naming a sender another loop ask holds leaves that hold to its own ask', async () => {
  const { siblings, rows, loop, held, settle } = asksWorld();
  loop('b');
  expect(await held('b', 'c')).toContain('held');
  await settle();
  loop('a');
  expect(await held('a', 'b')).toContain('held');
  await settle();
  rows.set('02', { status: 'answered', answer: '"go-on"' });
  expect(await held('a')).toBeUndefined();
  expect(await held('b')).toContain('held');
  siblings.stop();
});

it("a notice handed in a hook's reply whose deep-hook was gone is handed again at the session's next hook", async () => {
  const { wa, wb } = world();
  const kinds: string[] = [];
  const siblings = new Siblings(options({ append: async (_s, _a, e) => { kinds.push(String((e as { kind: string }).kind)); } }));
  // b edits src/cart.js.
  const pre = hook('b', wb, 'PreToolUse', 'b1');
  await siblings.hook(pre.drafts, pre.meta);
  const after = post('b', wb, 'b1', [patch(1, 1, [' l1', '-l2', '+L2', ' l3'])]);
  await siblings.hook(after.drafts, after.meta);
  // a's tool call is told, in a reply its deep-hook had already given up on: what no hook carried is handed again.
  const first = hook('a', wa, 'PreToolUse', 'a1');
  await siblings.hook(first.drafts, first.meta);
  const told = await siblings.deliver(first.meta, until());
  expect(told).toContain('src/cart.js');
  siblings.gone(first.meta.id);
  const next = hook('a', wa, 'PreToolUse', 'a2');
  await siblings.hook(next.drafts, next.meta);
  expect(await siblings.deliver(next.meta, until()), 'handed again at the next hook').toBe(told);
  expect(kinds.filter((k) => k === 'notice.delivered'), 'each hand-off is in the record').toHaveLength(2);
  siblings.stop();
});

it('after a restart, a "keep which?" ask you answered is not asked again for the same pair', async () => {
  const { wa } = world();
  const root = join(wa, '..');
  const wc = join(root, 'wc');
  git(join(root, 'repo'), 'worktree', 'add', '-q', '-b', 'c/issue-7', wc);
  let skew = 0;
  const asked: string[] = [];
  const fresh = (asks: object[]) => new Siblings(options({
    now: () => Date.now() + skew,
    ask: async (_s, _a, _c, _source, ask) => { asked.push(String(ask.question)); return 'ask:11'; },
    raw: async (query) => (query.includes('FROM sessions') ? [{ id: 'a', agent: 'claude-code', worktree: wa, last_seen: Date.now() }, { id: 'c', agent: 'codex', worktree: wc, last_seen: Date.now() }]
      : query.includes('Keep which') ? asks : []),
  }));
  // Before the restart: a and c both on issue 7, asked once.
  const one = fresh([]);
  for (const [s, w] of [['a', wa], ['c', wc]] as const) { const h = hook(s, w, 'PreToolUse', `${s}1`); await one.hook(h.drafts, h.meta); }
  skew = 6_000;
  await new Promise((done) => setTimeout(done, 5_400));
  expect(asked, 'the pair is asked once').toHaveLength(1);
  one.stop();
  // After it: the record holds that ask, answered; the map is read back; the same question is never put again.
  const two = fresh([{ session_id: 'a', status: 'answered', answer: 'keep-both', question: asked[0] }]);
  await two.restore();
  skew = 12_000;
  await new Promise((done) => setTimeout(done, 5_400));
  expect(asked, 'never the same question twice').toHaveLength(1);
  two.stop();
}, 20_000);

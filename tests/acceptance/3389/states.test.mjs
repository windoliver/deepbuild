// #3389.63db82fc: after each append that changes another session's state or row, made of no session or under another one,
// the newest session.state of each session and the rows are those a hub started afresh on a copy of the record gives.
//   node --test tests/acceptance/3389/states.test.mjs
// One hub runs throughout on one seeded record. Each append goes in through a surface it serves (the CLI's and the app's
// socket methods, a session's hooks and MCP calls, the hub's clock); then the record is copied as it stands and a hub
// starts on the copy, which reads every session, and the two lists are compared. Each append has sessions of its own, so
// a row one leaves behind is named with it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import { CHANGE, control, endedSession, hook, HOUR, ledgerOf, listed, own, peerOf, quiet, remove, seed, sessionId, sqlite, startHub, stopHub, tempHome, tool, ulid, unbuilt, until } from './lib.mjs';

const MINUTE = 60_000;
const sha = (text) => createHash('sha256').update(text).digest('hex');
/** Your ask settings, with a batch every `every` hours or none: an ask then shows when it is raised. */
const settings = (every) => JSON.stringify({ asks: {
  deadline: { taste: '3d', authority: '1d', unblock: '2d', exception: '2d', choice: '2d', definition: '4h' },
  default: { taste: 'recommended', authority: 'no', unblock: 'stay-blocked', exception: 'no-change', choice: 'recommended', definition: 'leave-out' },
  fallback: ['change-owner'], fold: 5, ...(every ? { batch: { every: `${every}h`, cap: 20 } } : {}),
} });
const ids = ['other', 'later', 'undone', 'batched', 'answered', 'made', 'sent', 'stale', 'opened', 'opener', 'closed', 'older', 'newer'];
const S = Object.fromEntries(ids.map((name, n) => [name, sessionId(n + 1)]));
const DOC = ulid(1_790_000_000_000, 3389);
const ITEM = sha('the open item of the closed session');

/** A list's states and rows, each by what it is of. */
const named = ({ states, rows }) => Object.fromEntries([...Object.entries(states).map(([id, state]) => [`session:${id}'s state`, state]), ...Object.entries(rows).map(([id, row]) => [`${id}'s row`, row])]);

/** The record every step starts from; gives each named session's ask and claim. */
async function fixture(home, now, boundary, next) {
  const asks = {}, claims = {};
  const deadline = now + 48 * HOUR;
  await seed(home, async (add) => {
    const ask = (name, until = deadline) => async (at) => {
      asks[name] = `ask:${await add('ask.created', 1, at, {
        kind: 'choice', question: `Which header for ${name}?`, options: [{ id: 'a', label: 'A', decision: 'none' }, { id: 'b', label: 'B', decision: 'none' }], recommended: 'a',
        deadline: until, fallback: 'you', default: 'a', provisional: false, owner: 'you', key: sha(`header ${name}`), pinned_to: { kind: 'evidence', ref: sha(name) },
      }, { writer: `mcp:${S[name]}`, session: S[name] })}`;
    };
    const judged = (name, task, attempt, outcome, { smallest = null, doc_revisions = [] } = {}) => async (at) => {
      const commit = sha(name).slice(0, 40);
      const id = await add('claim.made', 2, at, { task_ref: task, attempt, commit, scope: 'session', predictions: [] }, { writer: `mcp:${S[name]}`, session: S[name] });
      claims[name] = `claim:${id}`;
      const verdict = ulid(at + 10, 3389);
      await add('verdict.made', 1, at + 10, {
        outcome, verdict: `verdict:${verdict}`, claim: claims[name], reasons: [], requirements: [], smallest, points_to: null, commit,
        key: { commit, doc_revisions, check_digests: [], state_digests: [], environment: 'test', tools: [] },
      }, { session: S[name], subject: claims[name], id: verdict });
    };
    const early = boundary - 40 * MINUTE, late = boundary + 5 * MINUTE;
    const turns = {
      // Asked before the last batch, so shown at the hub's start; and after it, so each waits for the next.
      answered: [early, ask('answered')], undone: [early, ask('undone', next + 40 * MINUTE)], later: [late, ask('later')], batched: [late, ask('batched')],
      made: [early, judged('made', 'task:T3389M', 1, 'PASS')], sent: [early, judged('sent', 'task:T3389S', 1, 'PASS')],
      stale: [early, judged('stale', 'task:T3389K', 1, 'PASS', { doc_revisions: [`doc:${DOC}@9 ${sha('an earlier revision')}`] })],
      opened: [early, judged('opened', 'task:T3389O', 1, 'BLOCKED', { smallest: 'the probe is missing' })], opener: [early, judged('opener', 'task:T3389O', 2, 'PASS')],
      closed: [early, async (at) => {
        await judged('closed', 'task:T3389C', 1, 'BLOCKED', { smallest: 'the probe is missing' })(at);
        await add('open_item.opened', 2, at + 20, { task_ref: 'task:T3389C', text: 'the far end was not read', item: ITEM, from: 'section' }, { session: S.closed });
      }],
      other: [early, undefined],
    };
    for (const [n, [name, [at, during]]] of Object.entries(turns).entries()) await endedSession(add, S[name], at + n * 6000, during);
    // The item's ask, of no session, as the hub raises it: your waiver closes the item.
    asks.waiver = `ask:${await add('ask.created', 1, early + 10 * MINUTE, {
      kind: 'exception', question: 'Close this open item without evidence, as a waiver?', options: [{ id: 'waive', label: 'Waive it: close it without evidence', decision: 'none' }, { id: 'keep', label: 'Keep it open', decision: 'none' }], recommended: 'keep',
      deadline, fallback: 'you', default: 'keep', provisional: false, owner: 'you', key: sha(`open item waiver\n${ITEM}`), pinned_to: { kind: 'evidence', ref: sha('waiver') },
    })}`;
    // A hub ran until just now: time it didn't run moves the deadline of an ask no one saw (#908).
    await add('hub.stopped', 1, now - 1000, { reason: 'requested' });
  });
  return { asks, claims };
}

describe('#3389 every state and row is the one a whole pass gives', { timeout: 3_600_000 }, () => {
  it('#3389.63db82fc after each append that names another session, and one of every session, the newest session.state of each session and the rows table are those a hub started afresh on a copy of that record gives', async () => {
    const blocked = unbuilt(CHANGE);
    if (blocked) assert.fail(blocked);
    const home = tempHome(), root = join(home, '.deepbuild'), confirm = join(home, 'confirm'), shown = join(home, 'world.json');
    let hub, db;
    try {
      // A batch schedule whose last batch is over an hour gone and whose next is over an hour off.
      const now = Date.now();
      const every = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 17, 19].find((h) => now % (h * HOUR) >= HOUR && now % (h * HOUR) <= (h - 1.2) * HOUR);
      const boundary = now - (now % (every * HOUR)), next = boundary + every * HOUR;
      const { asks, claims } = await fixture(home, now, boundary, next);
      writeFileSync(join(root, 'config.json'), settings(every));
      writeFileSync(confirm, 'confirmed');
      writeFileSync(shown, JSON.stringify({ panels: { main: { rect: [0, 0, 64, 48] } }, docs: { [DOC]: { panel: 'main' } } }));
      const env = { DEEP_HUB_TEST_CLOCK_STEPS: '1', DEEP_HUB_TEST_VERDICT: '1', DEEP_HUB_TEST_CONFIRM: confirm, DEEP_HUB_TEST_SHOW: shown };
      hub = await startHub(CHANGE, home, env);
      db = sqlite(ledgerOf(home));
      const cli = (method, params) => control(hub, (call) => call(method, params));
      const clock = async () => Number((await cli('test.clock', { advance_ms: 0 })).now);
      const stepTo = async (time) => cli('test.clock', { advance_ms: Math.max(0, time - await clock()) });
      const head = () => db.prepare('SELECT max(log_pos) AS pos FROM events').get().pos;
      /** The newest event of `kind` after `pos`, once there is one. */
      const event = (kind, pos) => until(() => db.prepare('SELECT id, log_pos, session_id FROM events WHERE kind = ? AND log_pos > ? ORDER BY log_pos DESC LIMIT 1').get(kind, pos), 120_000, () => `BLOCKED: no ${kind} was recorded; since then came ${db.prepare('SELECT DISTINCT kind FROM events WHERE log_pos > ?').all(pos).map((r) => r.kind).join(', ') || 'nothing'}`);
      /** What a hub started afresh on a copy of the record gives, at this hub's time, under its settings. */
      const afresh = async () => {
        const copy = tempHome();
        let fresh, file;
        try {
          mkdirSync(join(copy, '.deepbuild'), { mode: 0o700 });
          await db.backup(ledgerOf(copy));
          for (const name of ['config.json', 'gates.json']) if (existsSync(join(root, name))) copyFileSync(join(root, name), join(copy, '.deepbuild', name));
          fresh = await startHub(CHANGE, copy, { ...env, DEEP_HUB_TEST_CLOCK: String(await clock()) });
          file = sqlite(ledgerOf(copy));
          await quiet(file, fresh);
          return listed(file);
        } finally {
          file?.close();
          if (fresh) await stopHub(fresh);
          remove(copy);
        }
      };
      const session = (name) => `session:${S[name]}`;
      const start = (name, source) => hook(hub, S[name], 'SessionStart', { source });
      const end = (name, reason) => hook(hub, S[name], 'SessionEnd', { reason });
      // On one subject, and in words of its own: the same words again would be the same ask.
      const raised = (name) => tool(hub, S[name], 'deep_ask', { kind: 'choice', question: `Which header, asks the ${name} session?`, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'a', steps: null, where: null, why: null, check: null, subject: { point: `req:${ulid(now, 1)}#R1`, screen: null, element: null } });

      // Each step: the append it ends in, what it does, and the rows a whole pass then gives otherwise than before it.
      let older, unowned;
      const steps = [
        // Before any hook: these two name the calling process, which no agent session may be above.
        ['deep off', 'holds.watch', () => own(hub, 'cli', 'gates.off', {}, peerOf(process.pid)), () => [session('other'), session('batched')]],
        ['deep on', 'holds.watch', () => own(hub, 'cli', 'gates.on', {}, peerOf(process.pid)), () => [session('other'), session('batched')]],
        ['an ask put off with Later', 'ask.later', () => own(hub, 'app', 'ask.later', { ask: asks.later }), () => [asks.later]],
        ['an ask batched', 'ask.batched', () => stepTo(next + MINUTE), () => [asks.batched]],
        ['an ask\'s answer undone', 'default.undone', async (pos) => {
          await stepTo(Number(db.prepare('SELECT deadline FROM asks WHERE id = ?').get(asks.undone.slice('ask:'.length)).deadline) + MINUTE);
          await event('ask.defaulted', pos);
          await quiet(db, hub);
          await cli('ask.undo', { ask: asks.undone });
        }, () => [session('undone'), asks.undone]],
        ['an ask answered', 'ask.answered', async () => {
          // From here an ask shows when it is raised.
          writeFileSync(join(root, 'config.json'), settings());
          await cli('ask.answer', { ask: asks.answered, words: 'The plain one' });
        }, () => [session('answered'), asks.answered]],
        ['an answer\'s delivery timed out', 'delivery.outcome', () => start('answered', 'resume'), () => [session('answered')]],
        // Raised in its own session, for the next append to supersede.
        ['an ask raised in a thread', 'ask.created', async () => {
          await end('answered', 'other');
          await start('older', 'startup');
          older = (await raised('older')).ask;
          await end('older', 'clear');
        }, () => [older]],
        ['an ask superseded', 'ask.superseded', async () => {
          await start('newer', 'clear');
          await raised('newer');
        }, () => [older]],
        ['a verdict made', 'verdict.made', () => cli('test.verdict', { session: S.other, claim: claims.made, outcome: 'FAIL' }), () => [session('made')]],
        ['a claim sent back', 'claim.sent_back', () => cli('test.verdict', { session: S.other, claim: claims.sent, outcome: 'FAIL', round: 2 }), () => [session('sent')]],
        ['a verdict gone stale', 'verdict.stale', () => cli('canvas.show', { doc: DOC, document: JSON.stringify({ format: 1, profile: 'board', title: 'Header', description: 'A header.', size: [64, 48], items: { mark: { id: 'mark', kind: 'rect@1', name: 'Mark', order: 'a0', params: { box: [0, 0, 8, 8], paint: { fill: { role: 'ground' } } } } } }), include: ['issues'] }), () => [session('stale')]],
        ['an open item opened', 'open_item.opened', async () => {
          await end('newer', 'other');
          await start('opener', 'resume');
          await quiet(db, hub);
          await tool(hub, S.opener, 'deep_open_item', { text: 'the far end was not timed' });
        }, () => [session('opened')]],
        ['an open item closed', 'open_item.closed', async () => {
          await end('opener', 'other');
          await quiet(db, hub);
          await cli('ask.answer', { ask: asks.waiver, option: 'waive' });
        }, () => [session('closed'), asks.waiver]],
        ['an ask of no session raised', 'ask.created', async (pos) => {
          await cli('agents.propose', { via: 'app', agents: ['claude-code'], server: { name: 'probe', command: '/usr/bin/true' } });
          unowned = `ask:${(await event('ask.created', pos)).id}`;
        }, () => [unowned]],
        ['an ask of no session closed', 'ask.answered', () => cli('ask.answer', { ask: unowned, option: 'keep' }), () => [unowned]],
      ];

      await quiet(db, hub);
      let before = { whole: await afresh(), told: new Map() };
      assert.deepEqual(listed(db), before.whole, 'BLOCKED: before any append, the hub and one started afresh on a copy of its record already differ');
      const wrong = [];
      for (const [what, kind, act, about] of steps) {
        const pos = head();
        await act(pos);
        const made = await event(kind, pos);
        await quiet(db, hub);
        const held = named(listed(db));
        const whole = await afresh();
        for (const id of about()) assert.notDeepEqual(whole.rows[id], before.whole.rows[id], `BLOCKED: ${what} (${kind}) changed nothing of ${id} that a whole pass gives, so it shows nothing`);
        const wanted = named(whole);
        // Each is told at the append after which it first differs, or differs otherwise.
        const differing = Object.keys({ ...held, ...wanted }).filter((part) => !isDeepStrictEqual(held[part], wanted[part])).sort();
        const told = new Map(differing.map((part) => [part, `is ${JSON.stringify(held[part]) ?? 'none'}, and ${JSON.stringify(wanted[part]) ?? 'none'} from a hub started afresh on a copy of the record`]));
        for (const [part, says] of told) if (before.told.get(part) !== says) wrong.push(`${part} after ${what} (${kind}, of ${made.session_id === null ? 'no session' : `session ${made.session_id}`}) ${says}`);
        before = { whole, told };
      }
      assert.equal(wrong.length, 0, `${wrong.length} states and rows aren't those a whole pass gives. The first: ${wrong[0]}\n${wrong.slice(1).join('\n')}`);
    } finally {
      db?.close();
      if (hub) await stopHub(hub);
      remove(home);
    }
  });
});

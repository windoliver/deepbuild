// #3389.d8c0dd63 and #3389.c0c50375: what the state passes of a hub read, by its read log, on a record of 60 sessions none
// of which is at work: after 20 appends of no session, and while one more session works, is judged, asks and ends.
//   node --test tests/acceptance/3389/passes.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { draftAskSettings } from '@deepbuild/asks';
import { CHANGE, control, endedSession, follow, given, hook, HOUR, ledgerOf, letters, listed, own, quiet, rawOf, remove, seed, sessionId, settled, sqlite, startHub, stopHub, tempHome, tool, unbuilt, until } from './lib.mjs';

const SESSIONS = Array.from({ length: 60 }, (_, n) => sessionId(n));
const brief = (entry) => rawOf(entry).sql.replace(/\s+/g, ' ').slice(0, 200);

/** A hub on a record of the 60 sessions, its start's work done; `use` gets it, its file and its read log's new lines. */
async function world(prepare, use) {
  const home = tempHome(), reads = join(home, 'reads.jsonl');
  let hub, db;
  try {
    const at = Date.now() - 2 * HOUR;
    await seed(home, async (add) => { for (const [n, id] of SESSIONS.entries()) await endedSession(add, id, at + n * 10_000); });
    hub = await startHub(CHANGE, home, { DEEP_HUB_TEST_READS: reads, ...await prepare(home) });
    db = sqlite(ledgerOf(home));
    await until(() => SESSIONS.every((id) => listed(db).states[id]), 120_000, "BLOCKED: the hub's start recorded no state of some of the 60 sessions");
    await quiet(db);
    const { states } = listed(db);
    assert.deepEqual(SESSIONS.filter((id) => states[id] !== 'finished/finished'), [], `BLOCKED: none of the 60 sessions is at work, and each reads finished: ${JSON.stringify(states).slice(0, 300)}`);
    const more = follow(reads);
    more();
    await use({ hub, home, db, more });
  } finally {
    db?.close();
    if (hub) await stopHub(hub);
    remove(home);
  }
}

describe('#3389 the state pass', { timeout: 1_800_000 }, () => {
  it('#3389.d8c0dd63 with 60 sessions in the record and none at work, after 20 appends of no session that name no ask, claim, verdict or task the read log holds no read of any session by a state pass', async () => {
    const blocked = unbuilt(CHANGE);
    if (blocked) assert.fail(blocked);
    await world(async () => ({}), async ({ hub, db, more }) => {
      const steps = db.prepare("SELECT count(*) AS n FROM events WHERE kind = 'setup.step' AND session_id IS NULL");
      const windows = [];
      for (let n = 1; n <= 20; n++) {
        await control(hub, (call) => call('setup.report', { steps: [{ step: 'install', agent: 'claude-code' }] }));
        await until(() => steps.get().n === n, 60_000, () => `BLOCKED: ${n} reports recorded ${steps.get().n} setup.step events of no session`);
        // Well past a pass's 200 ms, then on until the read log has gone quiet, so a slow machine's pass is this append's.
        windows.push([]);
        let since = Date.now();
        await until(() => {
          const got = more().map((entry) => ({ entry, count: given(db, entry, SESSIONS).length })).filter(({ count }) => count);
          windows.at(-1).push(...got);
          if (got.length) since = Date.now();
          return Date.now() - since > 2000;
        }, 120_000, 'busy').catch((error) => { if (error.message !== 'busy') throw error; });
      }
      // An append of one session's own does start a pass, which the log has to show.
      await own(hub, 'app', 'session.rename', { session: SESSIONS[0], name: 'the first value' });
      await until(() => listed(db).rows[`session:${SESSIONS[0]}`].title === 'the first value', 60_000, "BLOCKED: a session's new name never reached its row");
      if (!more().some((entry) => given(db, entry, SESSIONS.slice(0, 1)).length)) assert.fail("INCONCLUSIVE: no read gave the state of a session once it was named, though its row has the name, so this hub's state passes don't show in its read log");
      const read = windows.filter((w) => w.length), whole = windows.filter((w) => w.some(({ count }) => count === SESSIONS.length));
      assert.equal(read.length, 0, `after ${read.length} of the 20 appends of no session a state pass read sessions: ${whole.length} of those passes each read all 60. The first read: ${read[0] && brief(read[0][0].entry)}`);
    });
  });

  it('#3389.c0c50375 with 60 sessions in the record and none at work, every state pass from one more session\'s first hook to its end reads that session alone, and it ends in the state and row the merge base gives it', async () => {
    const blocked = unbuilt(CHANGE);
    if (blocked) assert.fail(blocked);
    // The change asked for, with its definition handed at once (DEEP_HUB_TEST_DRAFTS): one requirement, judged by the repo's drafted check.
    const ASKED = 'make the value module give the number four', FILE = 'src/value.mjs', CHECK = '.deepbuild/checks/value.sh';
    const value = (n) => `export const value = '${n}';\n`;
    const session = sessionId(3389);
    await world(async (home) => {
      const work = join(home, 'work'), drafts = join(home, 'drafts.json'), confirm = join(home, 'confirm');
      const files = {
        [FILE]: value('none'), [CHECK]: 'node --test test/value.test.mjs\n', 'package.json': '{"name":"value","version":"1.0.0","type":"module"}\n',
        'test/value.test.mjs': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { value } from '../src/value.mjs';\n\ntest('the value module gives a value', () => assert.equal(typeof value, 'string'));\n",
      };
      for (const [path, text] of Object.entries(files)) { mkdirSync(join(work, path, '..'), { recursive: true }); writeFileSync(join(work, path), text); }
      const git = (...args) => execFileSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', ...args], { cwd: work, env: { PATH: '/usr/bin:/bin', HOME: work, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@example.invalid' } });
      git('init', '-q', '-b', 'main');
      git('add', '-A');
      git('commit', '-q', '-m', 'the value module and its drafted check');
      git('checkout', '-q', '-b', 'four');
      writeFileSync(drafts, JSON.stringify({ drafts: [{ ask: ASKED, requirements: [{ id: 'R1', text: 'The value module gives a value', source_line: 'ask#L1', refuted_by: 'a run where it gives none', check: CHECK, on_base: 'passes', asserts: [], depth: 'unit', oracle: 'code', near_misses: [] }], deliverables: [FILE], budget: null }] }));
      writeFileSync(confirm, 'confirmed');
      await draftAskSettings(join(home, '.deepbuild'));
      return { DEEP_HUB_TEST_DRAFTS: drafts, DEEP_HUB_TEST_CONFIRM: confirm };
    }, async ({ hub, home, db, more }) => {
      const from = db.prepare('SELECT max(log_pos) AS pos FROM events').get().pos;
      const recorded = (what, sql, ...params) => until(() => db.prepare(sql).get(...params), 180_000, () => `BLOCKED: no ${what} was recorded; the newest events are ${db.prepare('SELECT kind FROM events ORDER BY log_pos DESC LIMIT 8').all().map((r) => r.kind).join(', ')}`);

      // The session's transcript, as Claude Code writes it beside the hooks.
      const work = join(home, 'work'), transcript = join(home, '.claude', 'projects', 'work', `${session}.jsonl`);
      const version = JSON.parse(readFileSync(join(CHANGE, 'adapters/claude-code.facts.json'), 'utf8')).versions.at(-1);
      mkdirSync(join(transcript, '..'), { recursive: true });
      let parentUuid = null;
      const entry = (line) => {
        const uuid = randomUUID();
        appendFileSync(transcript, `${JSON.stringify({ parentUuid, isSidechain: false, ...line, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: work, sessionId: session, version, gitBranch: 'four' })}\n`);
        parentUuid = uuid;
      };
      const says = (content, stop_reason) => entry({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', content, stop_reason, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
      const prompt_id = randomUUID();
      const fire = (event, fields = {}) => hook(hub, session, event, { prompt_id, ...fields });

      // It prompts, edits, and stops with a claim judged to a verdict.
      await fire('SessionStart', { source: 'startup' });
      entry({ promptId: prompt_id, type: 'user', message: { role: 'user', content: ASKED }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
      await fire('UserPromptSubmit', { prompt: ASKED });
      await recorded('definition.locked', "SELECT 1 FROM events WHERE kind = 'definition.locked' AND json_extract(data, '$.task_ref') LIKE ?", `session:${letters(session)}#%`);
      const edit = { tool_name: 'Edit', tool_input: { file_path: join(work, FILE), old_string: value('none'), new_string: value('four'), replace_all: false }, tool_use_id: 'toolu_3389_1' };
      const tool_response = { filePath: edit.tool_input.file_path, oldString: value('none'), newString: value('four'), replaceAll: false, structuredPatch: [], userModified: false };
      says([{ type: 'tool_use', id: edit.tool_use_id, name: 'Edit', input: edit.tool_input }], 'tool_use');
      await fire('PreToolUse', edit);
      writeFileSync(join(work, FILE), value('four'));
      entry({ promptId: prompt_id, type: 'user', message: { role: 'user', content: [{ tool_use_id: edit.tool_use_id, type: 'tool_result', content: 'done' }] }, toolUseResult: tool_response });
      await fire('PostToolUse', { ...edit, tool_response, duration_ms: 40 });
      says([{ type: 'text', text: 'Done.' }], 'end_turn');
      let stopped = await fire('Stop', { stop_hook_active: false, last_assistant_message: 'Done.' });
      const claim = `claim:${(await recorded('claim.made', "SELECT id FROM events WHERE kind = 'claim.made' AND session_id = ?", session)).id}`;
      const verdict = db.prepare("SELECT json_extract(data, '$.outcome') AS outcome FROM events WHERE kind = 'verdict.made' AND subject = ? ORDER BY log_pos DESC LIMIT 1");
      // A check that missed the stop's time, as on a busy machine, starts once the turn ends: the agent stops again.
      for (const end = Date.now() + 300_000; !verdict.get(claim);) {
        if (Date.now() > end) assert.fail(`BLOCKED: ${claim} wasn't judged within 300 s`);
        await until(() => verdict.get(claim), 15_000, 'late').catch(async () => {
          entry({ promptId: prompt_id, type: 'user', message: { role: 'user', content: `Stop hook feedback:\n${JSON.parse(stopped.stdout || '{}').reason ?? ''}` } });
          says([{ type: 'text', text: 'Done.' }], 'end_turn');
          stopped = await fire('Stop', { stop_hook_active: true, last_assistant_message: 'Done.' });
        });
      }
      assert.equal(verdict.get(claim).outcome, 'PASS', 'BLOCKED: the claim is judged to PASS');
      // It raises an ask, which the CLI answers in words, so no decision is saved; and it ends.
      const asked = await tool(hub, session, 'deep_ask', { kind: 'choice', question: 'Which header for the value page?', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], recommended: 'a', steps: null, where: null, why: null, check: null, subject: null });
      // Each append's pass lands before the next append, so that what each reads is seen apart; its state isn't judged here.
      await until(() => listed(db).states[session] === 'needs you/ask', 60_000, 'late').catch(() => undefined);
      await control(hub, (call) => call('ask.answer', { ask: asked.ask, words: 'The plain one' }));
      await until(() => listed(db).states[session] === 'PASS/pass', 60_000, 'late').catch(() => undefined);
      await fire('SessionEnd', { reason: 'other' });
      await recorded('session.end', "SELECT 1 FROM events WHERE kind = 'session.end' AND session_id = ?", session);
      await quiet(db);

      const reads = more().map((e) => ({ entry: e, others: given(db, e, SESSIONS) }));
      if (!reads.some(({ entry: e }) => given(db, e, [session]).length)) assert.fail(`INCONCLUSIVE: no read gave the state of session ${session} either, so this hub's state passes don't show in its read log`);
      const first = reads.find(({ others }) => others.length);
      if (first) {
        // The appends since the pass before, the newest first: what had this one read the others is among them.
        const before = db.prepare("SELECT log_pos, kind, session_id FROM events WHERE log_pos > ? AND ts <= ? AND kind NOT IN ('session.state', 'row.set') ORDER BY log_pos DESC LIMIT 12").all(from, first.entry.at);
        const cause = before.find((e) => e.session_id === null) ?? before[0];
        assert.fail(`a state pass read ${first.others.length} other sessions after ${cause?.kind} (log_pos ${cause?.log_pos}, of ${cause?.session_id === null ? 'no session' : `session ${cause?.session_id}`}), the append before it; ${reads.filter(({ others }) => others.length).length} reads gave another session's state until its end. The first: ${brief(first.entry)}`);
      }

      await settled(hub);
      const { states, rows } = listed(db);
      assert.equal(states[session], 'PASS/pass', 'the session ends in the state the merge base gives it');
      const since = db.prepare('SELECT ts FROM events WHERE id = ?').get(claim.slice('claim:'.length)).ts;
      assert.deepEqual(rows[`session:${session}`], {
        order: `0|2|work|3|${String(since).padStart(16, '0')}|session:${session}`, id: `session:${session}`, address: `session/${session}`, title: ASKED, project: 'work', session, agent: 'claude-code',
        entry: 'pass', word: 'PASS', why: 'its claim passed its checks', waits_on: null, since, actions: [], unread: true,
      }, 'and in the row the merge base gives it');
      assert.ok(!Object.keys(rows).some((id) => id.startsWith('ask:')), `its answered ask left the list: ${Object.keys(rows).filter((id) => id.startsWith('ask:')).join(', ')}`);
    });
  });
});

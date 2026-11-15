// #2084 AC2 and Scope: a heavy command whose call the hub holds for the core still carries its settled reply.
//
// AC2: two Claude Code sessions in two worktrees of one repo both change README.md (so each has changes in the repo and the
// hub holds the next tool call of each for the core, #352). The second session's first `cargo test --workspace` after
// its prompt comes after the first session's second edit of that file, so a sibling notice waits for it. Its
// PreToolUse reply must (1) rewrite the call into its `deep lease` form, (2) carry the sibling notice in that same
// reply, which the record shows as delivered to it, and (3) the rewritten command, run, holds a cpu.slot under the
// session in the record's leases. A hub whose held reply drops the rewrite fails at (1).
//
// Scope (second bullet): for an agent whose calls can't be rewritten, the held reply carries the heavy command's one
// denial, with its `deep lease` form. A Codex session whose call is held after a Claude Code sibling's change must be
// denied once with that form. Tagged with AC2's tag, since it is the same held-reply path.
//
// Real hub, real deep-hook, real `deep lease`, real record, on #1015's helpers (the stand-in `cargo` only stands in for the
// outside executable, as in #1015). Nothing from the product is imported.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  allEvents, CARGO_TEST, claudeCall, decisionOf, heldNow, leaseRows, leasedForm, letters, sampleRepo, Session, shownHook, shownLeases, sleep,
  slotsOf, until, World, rewrittenToLease, type Hooked, type Ev,
} from '../../1015/helpers.ts';

// `#2084.<first 8 hex of SHA-256 of the criterion text, trimmed, whitespace collapsed>`.
const AC2 = 'AC2 #2084.ef9a3ee6';
const LOAD = /deep-hook: spooled|missed its deadline/;

/** The transcript lines of a Claude Code session, as #1015's Session writes them (its file and chain, which it keeps private). */
function transcriptOf(s: Session): string {
  return join(s.w.home, '.claude/projects', s.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${s.id}.jsonl`);
}
function entry(s: Session, value: Record<string, unknown>): void {
  const path = transcriptOf(s);
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
  const parentUuid = (lines.at(-1)?.uuid as string | undefined) ?? null;
  const promptId = lines.find((l) => typeof l.promptId === 'string')?.promptId;
  const line = { parentUuid, isSidechain: false, ...(value.type === 'user' ? { promptId } : {}), ...value, uuid: randomUUID(), timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: '2.1.304', gitBranch: 'main' };
  appendFileSync(path, `${JSON.stringify(line)}\n`);
}
/** A Claude Code Edit of one line of a file: its tool_use, PreToolUse, the edit, its tool_result and PostToolUse. */
async function edit(s: Session, file: string, from: string, to: string): Promise<void> {
  const path = join(s.cwd, file);
  const before = readFileSync(path, 'utf8');
  expect(before.split('\n')[0], `the test's own edit of ${file} finds its first line`).toBe(from);
  const id = `toolu_${randomBytes(12).toString('hex')}`;
  const input = { file_path: path, old_string: from, new_string: to, replace_all: false };
  entry(s, { type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit', input }], stop_reason: 'tool_use', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } } });
  const pre = await s.hook('PreToolUse', { tool_name: 'Edit', tool_input: input, tool_use_id: id });
  expect(decisionOf(pre).denied, `BLOCKED: the Edit of ${file} in ${s.label} must be allowed: ${shownHook(pre)}`).toBe(false);
  writeFileSync(path, before.replace(from, to));
  const response = { filePath: path, oldString: from, newString: to, originalFile: before, replaceAll: false, structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [`-${from}`, `+${to}`] }], userModified: false };
  entry(s, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(response), is_error: false }] }, toolUseResult: response });
  await s.hook('PostToolUse', { tool_name: 'Edit', tool_input: input, tool_response: response, tool_use_id: id, duration_ms: 40 });
}
const noticesTo = (events: readonly Ev[], to: Session): Ev[] => events.filter((e) => e.kind === 'notice.delivered' && e.data?.target === `session:${letters(to.id)}`);
const unspooled = (h: Hooked, what: string): void => {
  if (LOAD.test(h.stderr)) expect.fail(`INCONCLUSIVE: ${what} came back unanswered, the machine too loaded for deep-hook's 50 ms acknowledgement: ${shownHook(h)}`);
};

describe(`${AC2} a heavy command's call held for the core keeps its rewrite and the sibling notice`, () => {
  it(`${AC2} with two sessions that both changed README.md, the second session's first \`${CARGO_TEST}\` after its prompt is rewritten into its \`deep lease\` form, carries the sibling notice in the same reply, and holds a cpu.slot`, async () => {
    const w = new World();
    await w.startHub();
    const sessions: Session[] = [];
    try {
      const { worktrees } = sampleRepo(w, 2);
      const a = new Session(w, 'claude', worktrees[0]!);
      const b = new Session(w, 'claude', worktrees[1]!);
      sessions.push(a, b);
      await a.begin();
      await edit(a, 'README.md', '# shop', '# shop A1');
      await b.begin();
      await edit(b, 'README.md', '# shop', '# shop B');
      // A changes the file B changed: a notice for B is waiting, and B's next tool call is held for it.
      await edit(a, 'README.md', '# shop A1', '# shop A2');
      await sleep(1500);
      const before = noticesTo(await allEvents(w.hub!), b).length;

      const call = await claudeCall(b, CARGO_TEST);
      const hooked = call.pre.hooked;
      unspooled(hooked, `B's first \`${CARGO_TEST}\``);

      // The rewrite: the settled reply for a heavy command, which the hold must not drop.
      expect(rewrittenToLease(call.pre.decision, CARGO_TEST), `B's first \`${CARGO_TEST}\` after its prompt, held for the core, must be rewritten into its \`deep lease\` form: ${shownHook(hooked)}`).toBe(true);

      // The sibling notice the hold is for, in that same reply and in the record.
      const arrived = await until(async () => noticesTo(await allEvents(w.hub!), b).length > before, 20_000);
      expect(arrived, `the sibling notice A's second edit of README.md raised for B must be delivered at B's \`${CARGO_TEST}\` call`).toBe(true);
      const fresh = noticesTo(await allEvents(w.hub!), b).slice(before);
      const text = fresh.map((e) => String(e.data.text)).find((t) => t.includes('README.md') && t.includes(a.id.slice(0, 8)));
      expect(text, `a notice naming session ${a.id.slice(0, 8)} and README.md must be delivered to B by that call: ${JSON.stringify(fresh.map((e) => e.data))}`).toBeDefined();
      const reply = JSON.parse(hooked.stdout.trim() || '{}') as { hookSpecificOutput?: { additionalContext?: string } };
      expect(reply.hookSpecificOutput?.additionalContext ?? '', `the same PreToolUse reply must carry the notice: ${shownHook(hooked)}`).toContain(text!);

      // The live cpu.slot, held under B while the rewritten command runs.
      expect(await until(() => Boolean(w.started(b.label)), 120_000), `the leased \`${CARGO_TEST}\` runs (a cpu.slot is free): ${JSON.stringify(call.bash?.output())}`).toBe(true);
      const held = heldNow(await leaseRows(w.hub!));
      w.go(b.label);
      expect(slotsOf(held, b).length, `the leased \`${CARGO_TEST}\` holds a cpu.slot under session ${b.id} while it runs: ${shownLeases(held)}`).toBeGreaterThanOrEqual(1);
      expect((await Promise.race([call.after, sleep(120_000).then(() => undefined)]))?.code, 'the leased command runs to its end').toBe(0);
    } finally {
      for (const s of sessions) s.stop();
      await w.stopHub();
    }
  }, 900_000);

  it(`${AC2} (scope) a Codex session's \`${CARGO_TEST}\`, held for the core after a Claude Code sibling's change, is denied once with its \`deep lease\` form`, async () => {
    const w = new World();
    await w.startHub();
    const sessions: Session[] = [];
    try {
      const { worktrees } = sampleRepo(w, 2);
      const a = new Session(w, 'claude', worktrees[0]!);
      const b = new Session(w, 'codex', worktrees[1]!);
      sessions.push(a, b);
      await a.begin();
      await edit(a, 'README.md', '# shop', '# shop A1');
      await b.begin();
      // One light call, whose reply marks B for the hold: its next call is held for the core.
      const light = await b.pre('git status');
      await b.post(light, 'git status', { code: 0, signal: null, output: '', pid: 0 });
      const first = await b.pre(CARGO_TEST);
      unspooled(first.hooked, `the Codex \`${CARGO_TEST}\``);
      expect(first.decision.denied, `a Codex call can't be rewritten, so the held \`${CARGO_TEST}\` must still be denied once: ${shownHook(first.hooked)}`).toBe(true);
      const form = leasedForm(first.decision.reason);
      expect(form, `the denial must give the \`deep lease\` form in backticks: ${JSON.stringify(first.decision.reason)}`).toBeDefined();
      expect(form, 'the form runs the command asked for').toContain(CARGO_TEST);
    } finally {
      for (const s of sessions) s.stop();
      await w.stopHub();
    }
  }, 900_000);
});

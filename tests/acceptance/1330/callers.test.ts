// AC2: a start asked for from an agent's process tree, and one through an MCP call, are refused, each naming the
// caller, though an approval that would cover the start is on the record (README).
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AC, approve, CLI, DesktopSession, FIXTURES, jsonOut, mentions, NODE, openWorld, sh, sleep, standIns, startArgs, worktrees, type Line } from './helpers.ts';

/** The words of an MCP reply: its tool result's text, or its JSON-RPC error's message. */
const words = (reply: Line | undefined): string => [
  ...((reply?.result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? ''),
  String(reply?.error?.message ?? ''),
].join('\n');

test(`${AC[2]} a start from an agent's process tree and one through an MCP call are refused, each naming the caller`, async () => {
  const w = await openWorld();
  await approve(w, { issues: [41], agents: ['claude-code'], atOnce: 2, planShare: 50 });
  const session = new DesktopSession(w, w.repo);
  await session.start();

  const tree = await session.bash(sh(NODE, CLI, ...startArgs(w, { issue: 41 })));
  const out = jsonOut(tree.stdout);
  expect(out?.status, `${AC[2]}: deep start run inside Claude Code session ${session.id}'s process tree is refused (exit ${tree.code}, stdout ${tree.stdout.slice(-800)}, stderr ${tree.stderr.slice(-800)})`).toBe('refused');
  expect(tree.code, `${AC[2]}: the refused start exits non-zero`).not.toBe(0);
  expect(mentions(out?.reason, session.id), `${AC[2]}: the refusal names the caller, session ${session.id}: ${JSON.stringify(out?.reason)}`).toBe(true);

  const call = await session.bash(sh(NODE, join(FIXTURES, 'mcp-call.mjs'), NODE, CLI, JSON.stringify({ repo: w.repo, issue: 41, agent: 'claude-code', prompt: 'Say ready.' })));
  const reply = jsonOut(call.stdout);
  expect(reply?.result?.isError === true || reply?.error !== undefined, `${AC[2]}: deep_start through deep mcp is refused: ${JSON.stringify(reply)} (stderr ${call.stderr.slice(-600)})`).toBe(true);
  expect(words(reply), `${AC[2]}: the refusal names the caller, an MCP call`).toMatch(/\bMCP\b/i);

  await sleep(3000);
  expect(standIns(w).filter((s) => !s.refused).map((s) => s.cwd), `${AC[2]}: neither starts an agent`).toEqual([]);
  expect(worktrees(w.repo).length, `${AC[2]}: neither adds a worktree`).toBe(1);
});

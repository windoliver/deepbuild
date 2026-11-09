// #1676 AC3: a replay of the recorded corpus scripts/corpus.mjs reads (adapters/corpus/<agent>/<version>/<session>/
// events.jsonl) shows no new deny on any call that ran clean, or lists each one. Every recorded tool call that ran
// clean (Claude Code's and Codex's PreToolUse with a PostToolUse of the same tool_use_id; pi's tool_call with a
// tool_result of outcome ok) goes through `deep-hook match` on a home holding the shipped defaults, once with this
// checkout's deep-hook and once with the pinned merge base's. A new deny is a call the merge base lets through and the
// branch denies: a hub-away denial (the hub stopped) or a block entry it newly matches (the hub up). None: PASS. Some:
// INCONCLUSIVE, listing each, for a person to judge; never PASS. The replay counts only once the branch's deep-hook
// steps over a project runner (AC1's `uv run python -c` call denied), or it compares the merge base with itself:
// BLOCKED until then. A reader that counts every later command on the line as unread (the planted
// `plant-later-command-unread`) newly denies the corpus's clean `pwd; rg … | sort | head -20` call, and the replay
// must list it. Adapted from tests/acceptance/1503/corpus.test.ts. No call is ever executed.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AC3, buildBase, buildDeepHook, cleanup, CORPUS, defaults, makeHome, matchMode, must, REPO, seedDefaults, type Line,
} from './helpers.ts';

let BIN: string;
beforeAll(async () => { BIN = await buildDeepHook(); }, 900_000);
afterEach(cleanup, 60_000);

const PLANT = 'plant-later-command-unread';

interface Case { at: string; payload: Line }
const dirs = (dir: string) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

/** Every recorded tool call that ran clean, with where it was recorded (`<agent>/<version>/<session>/events.jsonl:<line>`). */
function cleanCalls(): Case[] {
  const out: Case[] = [];
  for (const agent of dirs(CORPUS)) for (const version of dirs(join(CORPUS, agent))) for (const session of dirs(join(CORPUS, agent, version))) {
    const file = join(CORPUS, agent, version, session, 'events.jsonl');
    if (!existsSync(file)) continue;
    const rows = readFileSync(file, 'utf8').split('\n').map((text, i) => ({ text, line: i + 1 })).filter((r) => r.text.trim())
      .map((r) => ({ line: r.line, payload: (JSON.parse(r.text) as Line).payload as Line | undefined }));
    const ran = new Set(rows.flatMap(({ payload: p }) => (p && (p.hook_event_name === 'PostToolUse' || (p.hook_event_name === 'tool_result' && p.outcome === 'ok')) && p.tool_use_id ? [String(p.tool_use_id)] : [])));
    for (const { line, payload: p } of rows) {
      if (!p || !(p.hook_event_name === 'PreToolUse' || p.hook_event_name === 'tool_call') || !p.tool_use_id || !ran.has(String(p.tool_use_id))) continue;
      out.push({ at: `${relative(REPO, file)}:${line}`, payload: p });
    }
  }
  return out;
}

const BLOCK = new Set(Object.entries(defaults().entries).filter(([, g]) => g.mode === 'block').map(([n]) => n));
/** AC1's first call, which the branch must deny before its replay shows anything about this change. */
const AC1_FIRST = `uv run python -c "open('~/.deepbuild/rules.json','w')"`;

interface NewDeny { at: string; call: string; how: string }
async function replay(branch: string): Promise<{ cases: number; fresh: NewDeny[] }> {
  const home = makeHome();
  seedDefaults(home);
  const [probe] = await matchMode(branch, home, [{ hook_event_name: 'PreToolUse', cwd: home, tool_name: 'Bash', tool_input: { command: AC1_FIRST } }]);
  must(probe!.denials.length > 0, `BLOCKED: the branch's deep-hook doesn't step over a project runner yet (it lets \`${AC1_FIRST}\` through with the hub stopped), so a replay would compare the merge base with itself`);
  const cases = cleanCalls();
  must(cases.length > 0, `BLOCKED: no recorded tool call that ran clean under ${relative(REPO, CORPUS)}`);
  const payloads = cases.map((c) => c.payload);
  const [mine, base] = [await matchMode(branch, home, payloads), await matchMode(await buildBase(), home, payloads)];
  const fresh: NewDeny[] = [];
  cases.forEach((c, i) => {
    const [m, b] = [mine[i]!, base[i]!];
    must(!m.unread && !b.unread, `BLOCKED: deep-hook match couldn't read ${c.at}`);
    const call = JSON.stringify(c.payload.tool_input ?? {}).slice(0, 300);
    if (m.denials.length && !b.denials.length) fresh.push({ at: c.at, call, how: `denied with the hub stopped: ${m.denials.join(' / ').slice(0, 400)}` });
    const blocks = m.matched.filter((n) => BLOCK.has(n) && !b.matched.includes(n));
    if (blocks.length) fresh.push({ at: c.at, call, how: `newly meets the block entries ${blocks.join(', ')} (a deny with the hub up)` });
  });
  return { cases: cases.length, fresh };
}
const listed = (fresh: NewDeny[]) => fresh.map((f) => `${f.at} ${f.call}: ${f.how}`).join('\n');

describe(`AC3 ${AC3} a replay of the recorded corpus shows no new deny on any call that ran clean, or lists each one`, () => {
  it('AC3 every recorded call that ran clean, through this checkout\'s deep-hook and the merge base\'s: no new deny, or each one listed (INCONCLUSIVE)', async (ctx) => {
    const { cases, fresh } = await replay(BIN);
    console.log(`AC3 replayed ${cases} recorded calls that ran clean; ${fresh.length} new denies`);
    if (fresh.length) ctx.skip(`INCONCLUSIVE: ${fresh.length} new denies on calls that ran clean, for a person to judge:\n${listed(fresh)}`);
  }, 900_000);

  it(`AC3 (wrong program) a reader that counts every later command on the line as unread (${PLANT}) newly denies the clean pwd; rg … | sort | head -20 call, and the replay lists it`, async () => {
    const { fresh } = await replay(await buildDeepHook({ features: [PLANT] }));
    const text = listed(fresh);
    expect(fresh.length, `${PLANT} must show new denies`).toBeGreaterThan(0);
    expect(text, 'the list names the sequenced rg call').toContain('pwd; rg --files');
    expect(text, 'the list names where it was recorded').toMatch(/adapters\/corpus\/codex\/[^ ]+\/events\.jsonl:\d+/);
  }, 900_000);
});

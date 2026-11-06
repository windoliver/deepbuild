// #84 AC10: a merge through the GitHub MCP server's merge tool without an ask is denied with the same rule as
// `gh pr merge`. `github` is GitHub's official remote server in Claude Code's user config, which the facts file lists
// (`merge_pull_request`: effect merge); nothing contacts it, since a denied call never runs and the read control runs
// only as far as its hooks. In a thread whose ask names no merge, `gh pr merge 12` and the tool are each denied, the
// two denials name one entry, and an authority ask for the tool is filed. The server's read tool still goes through, so
// a program that denies every call of the server fails.
import { afterEach, describe, it } from 'vitest';
import { AC10, MERGE, MERGE_TOOL, cleanup, bash, expectAllowed, expectAuthorityAsk, expectDenied, makeWorld, mcpMerge, must, startHub, stopHub, unasked, verdict } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC10} a merge through the GitHub MCP server's merge tool without an ask is denied with the same rule as gh pr merge`, () => {
  it(`${AC10} ${MERGE_TOOL} and ${MERGE}, in a thread whose ask names no merge, are denied naming one entry; an ask is filed for the tool; get_pull_request goes through`, async (ctx) => verdict(ctx, async () => {
    const w = makeWorld();
    const hub = await startHub(w);
    try {
      const s = await unasked(hub, w);
      const gh = await expectDenied(hub, s, bash(MERGE), AC10);
      const tool = await expectDenied(hub, s, mcpMerge(), AC10);
      const same = tool.rules.filter((r) => gh.rules.includes(r));
      must(same.length > 0, `${AC10} the merge tool must be denied with the same rule as \`${MERGE}\`: the tool's denial names ${tool.rules.join(', ')}, \`${MERGE}\`'s names ${gh.rules.join(', ')}`);
      await expectAuthorityAsk(hub, tool, AC10);
      await expectAllowed(hub, s, { tool_name: 'mcp__github__get_pull_request', tool_input: { owner: 'acme', repo: 'shop', pullNumber: 12 } }, AC10);
    } finally {
      await stopHub(hub);
    }
  }), 600_000);
});

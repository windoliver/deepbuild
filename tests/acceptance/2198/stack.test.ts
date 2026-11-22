// #2198 AC3: a stack that didn't start is an error to the agent's client. A repo whose spec has no environment block; a
// session's deep_env with action up, through its own `deep mcp`, comes back as a tool result with isError true. Today:
// {"status":"BLOCKED",…} with isError false.
import { afterEach, describe, expect, it } from 'vitest';
import { AC3, call, cleanup, world } from './helpers.ts';

afterEach(cleanup, 60_000);

describe(`${AC3} A blocked stack is an error`, () => {
  // "Given a repo whose spec has no environment block, when a session calls `deep_env` with action up, then the tool result
  // is an error."
  it(`${AC3} deep_env up in a repo whose done.yaml has no environment block: the tool result is an error (isError true)`, async () => {
    const w = await world('no-environment');
    const o = await call(w, 'deep_env', { action: 'up' });
    expect(o.protocolError, `the result is a tool result, not a JSON-RPC error: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(false);
    expect(o.isError, `deep_env up with no environment block is an error to the client: ${JSON.stringify(o.reply).slice(0, 1500)}`).toBe(true);
  }, 240_000);
});

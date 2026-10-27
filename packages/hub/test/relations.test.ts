// The deep_ask timing relation (#19; design: Timing relations): deep_ask says "still waiting" at least 5 s before
// Claude Code's MCP tool timeout, read from the settings' env block or the environment, 60 s when unset; past that it
// returns at once and the agent waits with deep_wait. The other rows are the acceptance suites' (#18, #19).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { relations } from '../src/claude-settings.js';

const root = mkdtempSync(join(tmpdir(), 'deep-relations-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
// Setup's record of our entries: relations are read only once something was installed.
writeFileSync(join(root, 'claude-hooks.json'), JSON.stringify({ hooks: {} }));
const deepAsk = (settings: Record<string, unknown>, env: NodeJS.ProcessEnv = {}) => relations(root, settings, env).find((r) => r.name === 'deep_ask')!;

describe('the deep_ask relation', () => {
  it('holds at the 60 s DeepBuild takes while MCP_TOOL_TIMEOUT is unset, and at 45 s', () => {
    expect(deepAsk({})).toMatchObject({ holds: true, timeoutS: 60 });
    expect(deepAsk({ env: { MCP_TOOL_TIMEOUT: '45000' } })).toMatchObject({ holds: true, timeoutS: 45 });
  });
  it('breaks when the timeout leaves less than 5 s after the 40 s wait, from the settings or the environment, naming both values', () => {
    const broken = deepAsk({ env: { MCP_TOOL_TIMEOUT: '44999' } });
    expect(broken.holds).toBe(false);
    expect(broken.text).toMatch(/44\.999 s/);
    expect(broken.text).toMatch(/40 s/);
    expect(deepAsk({}, { MCP_TOOL_TIMEOUT: '9000' }).holds).toBe(false);
  });
});

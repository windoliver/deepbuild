// #2077 probe/judge launches use the chosen sign-in but never its hooks, settings or writable auth files.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { readFacts } from '@deepbuild/adapters';
import { cleanup, coveredVersions, tempDir } from '../../../tests/acceptance/159/helpers.ts';
import { openWorld, room } from '../../../tests/acceptance/159/world.ts';

afterAll(cleanup);
it('isolates both read agents while retaining only their chosen sign-in', async () => {
  const bin = tempDir(), home = tempDir(), claude = tempDir(), codex = tempDir();
  mkdirSync(join(home, '.claude'));
  const settings = JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo USER_HOOK' }] }] } });
  writeFileSync(join(home, '.claude', 'settings.json'), settings);
  writeFileSync(join(claude, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: 'isolation-account' } }));
  writeFileSync(join(claude, 'settings.json'), settings);
  const credentials = JSON.stringify({ claudeAiOauth: { accessToken: 'isolated-fixture', expiresAt: Date.now() + 3_600_000 } });
  const auth = JSON.stringify({ tokens: { account_id: 'isolated-codex' } });
  writeFileSync(join(claude, '.credentials.json'), credentials);
  writeFileSync(join(codex, 'auth.json'), auth);
  writeFileSync(join(codex, 'hooks.json'), settings);
  writeFileSync(join(codex, 'config.toml'), 'user_config = true\n');
  const script = (name: string, version: string, body: string) => writeFileSync(join(bin, name), `#!/bin/sh\nif [ "$1" = --version ]; then echo '${version}'; exit; fi\n${body}\n`, { mode: 0o755 });
  script('claude', coveredVersions().at(-1)!, `
    test "$HOME" != '${home}' && test "$CLAUDE_CONFIG_DIR" != '${claude}' || exit 21
    test "$CLAUDE_CODE_OAUTH_TOKEN" = isolated-fixture || exit 22
    test "$(cat "$CLAUDE_CONFIG_DIR/settings.json")" = '{}' || exit 23
    test ! -f "$HOME/.claude/settings.json" || exit 24
    if echo changed > '${claude}/.credentials.json' 2>/dev/null; then exit 25; fi
    printf '%s\\n' '{"type":"result","result":"isolated-claude","total_cost_usd":0.25}'`);
  script('codex', readFacts<{ versions: string[] }>('codex.facts.json').versions.at(-1)!, `
    test "$HOME" != '${home}' && test "$CODEX_HOME" != '${codex}' || exit 31
    test -r "$CODEX_HOME/auth.json" || exit 32
    test ! -f "$CODEX_HOME/config.toml" && test ! -f "$CODEX_HOME/hooks.json" || exit 33
    if echo changed > "$CODEX_HOME/auth.json" 2>/dev/null; then exit 34; fi
    printf '%s\\n' '{"type":"turn.completed","isolation":"isolated-codex"}'`);
  const w = await openWorld({ loginPath: `${bin}:/usr/bin:/bin`, env: { HOME: home, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex } });
  try {
    await room(w, 'isolation-account');
    await w.runner.report({ agent: 'codex', account: 'isolated-codex', rate_limits: { primary: { used_percent: 5, resets_at: Math.floor(w.clock.now() / 1000) + 3600 } } });
    const job = await w.runner.submit({ kind: 'eval', agent: 'claude-code', prompt: 'isolation', deadline_ms: 60_000 }, async (c) => {
      expect(await c.read('claude-code', 'haiku', 'probe', Date.now() + 30_000)).toContainEqual({ type: 'result', result: 'isolated-claude', total_cost_usd: 0.25 });
      expect(await c.read('codex', 'gpt-reserve', 'judge', Date.now() + 30_000)).toContainEqual({ type: 'turn.completed', isolation: 'isolated-codex' });
      return 'isolated';
    });
    const ended = await w.runner.wait(job.job);
    expect(ended.state, ended.refused).toBe('finished');
    expect(readFileSync(join(claude, '.credentials.json'), 'utf8')).toBe(credentials);
    expect(readFileSync(join(codex, 'auth.json'), 'utf8')).toBe(auth);
    expect(readFileSync(join(claude, 'settings.json'), 'utf8')).toBe(settings);
    expect((await w.events('job.recorded'))).toHaveLength(1);
  } finally { await w.close(); }
}, 90_000);

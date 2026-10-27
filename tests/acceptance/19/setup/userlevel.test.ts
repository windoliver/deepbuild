// AC13 #19.fddcc673 Setup writes hook entries only to user-level settings; no file inside any repo changes.
//
// Two repos with Claude Code project files of their own (`.claude/settings.json` with a hook, `.claude/settings.local.json`,
// `.mcp.json`, `CLAUDE.md`, `AGENTS.md`): `shop`, the folder `deep setup` runs in, and `blog`, which only your Claude
// Code history and ~/.claude.json name (setup reads that history). Every path in each repo is snapshotted with its
// bytes, mode and modification time in nanoseconds, the root folder's included, so even a file written back with the
// same bytes, or a temporary file made and removed, shows. Inside `.git` only `config` and `hooks/` count, the places
// a git hook would go; git's own bookkeeping (its index, say) is git's, not setup's.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  appendTranscript, changes, cleanup, deepEntries, gitRepo, installedHub, makeHome, newSession, onMac, readSettings, settingsFile, setup, sleep, snapshot,
  userConfig,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const PLANT = 'setup-writes-project-settings';
/** What counts in a repo: everything but git's bookkeeping, and of `.git` its config and its hooks. */
const counts = (rel: string) => !rel.startsWith(`.git${sep}`) || rel === join('.git', 'config') || rel === join('.git', 'hooks') || rel.startsWith(join('.git', 'hooks') + sep);
const keep = (rel: string) => rel !== '.git' && counts(rel);
const enter = (rel: string) => rel === '.git' || counts(rel);

function projectRepo(home: string, dir: string, name: string): void {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'), `{\n  "hooks": {\n    "PostToolUse": [ { "matcher": "Edit", "hooks": [ { "type": "command", "command": "npx prettier --write ." } ] } ]\n  },\n  "permissions": { "allow": ["Bash(npm run lint)"] }\n}\n`);
  writeFileSync(join(dir, '.claude', 'settings.local.json'), '{ "permissions": { "allow": ["Bash(npm test)"] } }\n');
  writeFileSync(join(dir, '.mcp.json'), '{ "mcpServers": { "db": { "command": "/usr/bin/true" } } }\n');
  writeFileSync(join(dir, 'CLAUDE.md'), `# ${name}\n\nRun npm test before you say done.\n`);
  writeFileSync(join(dir, 'AGENTS.md'), `# ${name}\n\nNever kill processes by name.\n`);
  writeFileSync(join(dir, 'src', 'index.js'), `console.log(${JSON.stringify(name)});\n`);
  gitRepo(home, dir);
}

async function setupInRepos(env: Record<string, string | undefined> = {}): Promise<void> {
  onMac();
  const { tmp, home } = makeHome();
  const shop = join(tmp, 'shop');
  const blog = join(tmp, 'blog');
  projectRepo(home, shop, 'shop');
  projectRepo(home, blog, 'blog');
  // Your Claude Code history names blog: a session there, and its project entry in ~/.claude.json.
  const past = newSession(home, blog);
  appendTranscript(past, { type: 'user', message: { role: 'user', content: 'Fix the typo in the header.' } });
  writeFileSync(userConfig(home), `${JSON.stringify({ numStartups: 3, projects: { [blog]: { allowedTools: [], hasTrustDialogAccepted: true }, [shop]: { allowedTools: [], hasTrustDialogAccepted: true } } }, null, 2)}\n`);
  const before = { shop: snapshot(shop, { times: true, keep, enter }), blog: snapshot(blog, { times: true, keep, enter }) };

  await setup(home, { env, cwd: shop });
  await installedHub(home);
  await sleep(3000);

  // The control: the entries are there, at user level.
  expect(deepEntries(readSettings(home)).length, `deep setup must write DeepBuild's hook entries into your user settings, ${settingsFile(home)}`).toBeGreaterThan(0);
  for (const [name, dir] of [['shop', shop], ['blog', blog]] as const) {
    const changed = changes(before[name], snapshot(dir, { times: true, keep, enter }));
    if (changed.length) expect.fail(`AC13 deep setup must change no file inside a repo; in ${dir}: ${changed.join('; ')}`);
  }
}

describe('AC13 #19.fddcc673 Setup writes hook entries only to user-level settings; no file inside any repo changes', () => {
  it('AC13 #19.fddcc673 deep setup run in one repo, with another in your history, writes its hook entries to ~/.claude/settings.json and changes no file in either repo', async () => {
    await setupInRepos();
  }, 600_000);

  it(`AC13 #19.fddcc673 (wrong program) a setup that also writes its entries into the repo's .claude/settings.json (${PLANT}) fails this test, naming the file`, async () => {
    let failure = '';
    try { await setupInRepos({ DEEP_HUB_PLANT: PLANT }); } catch (error) { failure = (error as Error).message; }
    expect(failure, `the repo check must fail on ${PLANT}`).toMatch(/^AC13 deep setup must change no file inside a repo; in \S+\/shop: .*\.claude\/settings\.json changed/);
  }, 600_000);
});

// The judges update.test.ts uses for AC5 #41.115d2abb and AC16 #41.539bf83d, run on planted setups, so a pass there
// means the setup's entries are right and not that the judges pass everything. AC16: "a planted setup that pins a
// version's folder starts nothing once that folder is removed and fails." Each planted entry here is what a wrong setup
// would write; each right one what the pinned surface (update.test.ts's header) asks for. The version folders are laid
// out by hand, as installVersion would leave them, so these run without the installer.

import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { CLI, HOOK, NODE, cleanup, notFixed, notNewest, readDefinition, tempDir, versionFolder, type Entry } from './helpers.js';

afterAll(async () => { await cleanup([]); });

const NEWEST = '3.0.0';
let root: string;
beforeEach(() => {
  root = join(tempDir(), 'deepbuild');
  for (const v of ['1.0.0', '2.0.0', NEWEST]) versionFolder(join(root, 'versions', v), v);
  symlinkSync(NEWEST, join(root, 'versions', 'current'));
  mkdirSync(join(root, 'bin'));
  for (const name of ['deep', 'deep-hook']) symlinkSync(join(root, 'versions', 'current', 'bin', name), join(root, 'bin', name));
});
const removeOlder = () => { for (const v of ['1.0.0', '2.0.0']) rmSync(join(root, 'versions', v), { recursive: true, force: true }); };
const q = (p: string) => `'${p.replaceAll("'", `'\\''`)}'`;
const hook = (path: string): Entry => ({ where: 'Claude Code settings.json Stop', shell: `exec ${q(path)} claude-code Stop` });
/** A launchd definition as setup writes one, naming `program`, read back from its text. */
const plist = (program: string[]): Entry => {
  const file = join(root, 'hub.plist');
  writeFileSync(file, `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n  <key>Label</key>\n  <string>com.deepbuild.hub</string>\n  <key>ProgramArguments</key>\n  <array>\n    ${program.map((s) => `<string>${s}</string>`).join('\n    ')}\n  </array>\n  <key>EnvironmentVariables</key>\n  <dict>\n    <key>PATH</key>\n    <string>/usr/bin:/bin</string>\n  </dict>\n</dict>\n</plist>\n`);
  return { where: 'the login service definition', ...readDefinition(readFileSync(file, 'utf8'), true) };
};

describe('AC16 #41.539bf83d twins: the login service definition', () => {
  it('AC16 #41.539bf83d a definition through DeepBuild\'s bin, or the current link, passes both judges once the older folders are gone', () => {
    removeOlder();
    for (const program of [join(root, 'bin', 'deep'), join(root, 'versions', 'current', 'bin', 'deep')]) {
      const e = plist([program, 'hub', 'run']);
      expect(notFixed(e, root, NEWEST)).toBeUndefined();
      expect(notNewest(e, NEWEST)).toBeUndefined();
    }
  });

  it('AC16 #41.539bf83d a planted setup that pins a version\'s folder starts nothing once that folder is removed, and fails both judges', () => {
    const e = plist([join(root, 'versions', '1.0.0', 'bin', 'deep'), 'hub', 'run']);
    expect(notNewest(e, NEWEST)).toMatch(/started "1\.0\.0"/);
    removeOlder();
    expect(notFixed(e, root, NEWEST)).toMatch(/version's own folder/);
    expect(notNewest(e, NEWEST)).toMatch(/started nothing/);
  });

  it('AC16 #41.539bf83d a planted setup that writes the link\'s target, the version folder current reaches today, fails once an update moves current', () => {
    // Pinned to 3.0.0 while it is current: it passes now, and an update to 4.0.0 leaves it behind.
    const e = plist([join(root, 'versions', NEWEST, 'bin', 'deep'), 'hub', 'run']);
    versionFolder(join(root, 'versions', '4.0.0'), '4.0.0');
    rmSync(join(root, 'versions', 'current'));
    symlinkSync('4.0.0', join(root, 'versions', 'current'));
    expect(notFixed(e, root, '4.0.0')).toMatch(/version's own folder/);
    expect(notNewest(e, '4.0.0')).toMatch(/started "3\.0\.0"/);
  });

  it('AC16 #41.539bf83d a definition running the checkout\'s CLI through Node, as a source install writes it, is not a fixed path', () => {
    expect(notFixed(plist([NODE, CLI, 'hub', 'run']), root, NEWEST)).toMatch(/not a fixed path/);
  });
});

describe('AC5 #41.115d2abb twins: hook entries', () => {
  it('AC5 #41.115d2abb an entry through DeepBuild\'s bin or the current link passes both judges', () => {
    removeOlder();
    for (const path of [join(root, 'bin', 'deep-hook'), join(root, 'versions', 'current', 'bin', 'deep-hook')]) {
      expect(notFixed(hook(path), root, NEWEST)).toBeUndefined();
      expect(notNewest(hook(path), NEWEST)).toBeUndefined();
    }
  });

  it('AC5 #41.115d2abb an entry naming a version\'s own folder fails, and runs nothing once that folder is removed', () => {
    const e = hook(join(root, 'versions', '1.0.0', 'bin', 'deep-hook'));
    expect(notFixed(e, root, NEWEST)).toMatch(/version's own folder/);
    removeOlder();
    expect(notNewest(e, NEWEST)).toMatch(/started nothing/);
  });

  it('AC5 #41.115d2abb a fixed path whose link was pointed at a version\'s own folder, not through current, fails', () => {
    rmSync(join(root, 'bin', 'deep-hook'));
    symlinkSync(join(root, 'versions', '1.0.0', 'bin', 'deep-hook'), join(root, 'bin', 'deep-hook'));
    expect(notFixed(hook(join(root, 'bin', 'deep-hook')), root, NEWEST)).toMatch(/not the newest version's folder/);
  });

  it('AC5 #41.115d2abb an entry naming the checkout\'s deep-hook build, or an MCP server running the checkout\'s CLI, is not a fixed path', () => {
    expect(notFixed(hook(HOOK), root, NEWEST)).toMatch(/not a fixed path/);
    expect(notFixed({ where: 'Claude Code .claude.json mcpServers.deepbuild', argv: [NODE, CLI, 'mcp'] }, root, NEWEST)).toMatch(/not a fixed path/);
  });
});

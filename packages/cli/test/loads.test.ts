// The commands you run often start with their own modules and none of the others' (#24's budget): `deep inbox` loads
// neither the gate, the record nor the YAML parser, and `deep lease`, which runs every heavy command an agent starts,
// none of the product store's YAML or SQLite. Each command's module graph is read off Node's loader.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../dist/main.js', import.meta.url));

/** The module URLs `deep <args>` loads, in a home with DeepBuild set up and no hub running. */
function loaded(args: string[]): string[] {
  const home = mkdtempSync(join(tmpdir(), 'deep-loads-'));
  try {
    const hook = join(home, 'loads.mjs');
    const log = join(home, 'loads.log');
    writeFileSync(hook, `import { registerHooks } from 'node:module';\nimport { appendFileSync } from 'node:fs';\nregisterHooks({ load(url, ctx, next) { appendFileSync(${JSON.stringify(log)}, url + '\\n'); return next(url, ctx); } });\n`);
    mkdirSync(join(home, '.deepbuild'));
    writeFileSync(join(home, '.deepbuild', 'setup-finished.json'), '{}\n');
    spawnSync(process.execPath, ['--import', hook, CLI, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
    return existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
const heavy = /\/node_modules\/(yaml|better-sqlite3)\/|\/packages\/(gate|record|contracts)\/dist\/index\.js$/;

it.each([[['inbox']], [['lease', '--', 'true']]])('deep %s loads none of the YAML parser, SQLite, the gate, the record or the contracts', (args) => {
  const urls = loaded(args);
  expect(urls.some((u) => u.endsWith('/packages/cli/dist/main.js')), 'the CLI ran').toBe(true);
  expect(urls.filter((u) => heavy.test(u))).toEqual([]);
});

it.each([['deep', []], ['deep status', ['status']]])('%s, in a folder that joined no project\'s hub, loads neither TLS nor the contracts', (_, args) => {
  const urls = loaded(args);
  expect(urls.some((u) => u.endsWith('/packages/hub/dist/list.js')), 'the list ran').toBe(true);
  expect(urls.filter((u) => u === 'node:tls' || heavy.test(u))).toEqual([]);
});

it('deep hub status, which only asks the hub on its socket, loads none of the hub\'s own server', () => {
  const urls = loaded(['hub', 'status']);
  expect(urls.some((u) => u.endsWith('/packages/hub/dist/service.js')), 'the command ran').toBe(true);
  expect(urls.filter((u) => heavy.test(u) || u.endsWith('/packages/hub/dist/server.js'))).toEqual([]);
});

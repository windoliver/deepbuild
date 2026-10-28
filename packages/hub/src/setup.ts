// `deep setup` (#18's part of it): Claude Code's hook entries merged into your user settings beside yours, and your
// ask settings drafted; and `deep doctor`'s timing-relation items. The background entry that wakes an idle session
// with an answer is deep-hook's waiter (#25), small enough to wait the longest ask deadline; `deep waiter` is only the
// planted Node waiter that polls. The rest of setup (the login service, the wiki, undo) is #19's and #41's.
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { draftAskSettings } from '@deepbuild/asks';
import { claudeSettings, install, longestDeadline, ourGroups, relations } from './claude-settings.js';
import { call } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';

/** The deep-hook this checkout built, the newer of its release and debug builds. */
function deepHook(): string {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const built = ['release', 'debug'].map((p) => join(repo, 'target', p, 'deep-hook')).filter((p) => existsSync(p));
  if (!built.length) throw Error(`no deep-hook is built under ${join(repo, 'target')}; run cargo build -p deep-hook first`);
  return built.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]!;
}

/** `deep setup`: exit 0 once Claude Code's user settings hold our entries beside yours. `cli` is the deep command's script. */
export async function setupCommand(cli: string): Promise<number> {
  const root = installedRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    await draftAskSettings(root);
    // The waiter waits as long as your longest ask deadline, so an answer in time can still wake the session.
    const longest = longestDeadline(root) ?? 0;
    const hook = deepHook();
    const waiter = process.env.DEEP_HUB_PLANT === 'waiter-polls' ? `'${process.execPath}' '${cli}' waiter` : `'${hook.replaceAll("'", `'\\''`)}' claude-code waiter`;
    install(root, ourGroups(hook, waiter, Math.max(600, Math.ceil(longest / 1000))));
  } catch (error) {
    process.stderr.write(`deep setup: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  console.log(`DeepBuild's hooks are in ${claudeSettings()}, beside yours.`);
  for (const r of relations(root)) console.log(`${r.holds ? 'OK' : 'BROKEN'} ${r.text}`);
  return 0;
}

/** deep doctor's item for each timing relation our entries keep, with both values: broken is a failed item. */
export function relationItems(): { item: string; agent: string; code: string; level: string; evidence: string; fix: string }[] {
  return relations(installedRoot()).map((r) => ({
    item: `timing.${r.name.replace(' ', '_')}`,
    agent: 'claude-code',
    code: r.holds ? 'healthy' : 'timing_relation_broken',
    level: r.holds ? 'ok' : 'fail',
    evidence: r.text,
    fix: r.holds ? 'Nothing to do.' : `Run deep setup, which writes the entry's timeout again, or raise it in ${claudeSettings()}.`,
  }));
}

/**
 * `deep waiter`, the planted wrong program waiter-polls (#25): a waiter in Node, as #18's was, that asks the hub for
 * its session's answer every 50 ms instead of being told, and wakes the session with it (exit 2, the answer on stderr).
 */
export async function waiterCommand(): Promise<number> {
  let session = '';
  try { session = String((JSON.parse(readFileSync(0, 'utf8')) as { session_id?: unknown }).session_id ?? ''); } catch { /* no payload */ }
  if (!session) return 0;
  const parent = process.ppid;
  for (;;) {
    try { process.kill(parent, 0); } catch { return 0; }
    try {
      const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
      const reply = await call(hubAddress().path, token, 'session.wait', { session, poll: true });
      if ('result' in reply && typeof reply.result.text === 'string') {
        process.stderr.write(`${reply.result.text}\n`);
        return 2;
      }
    } catch { /* the hub is away: ask again */ }
    await new Promise((done) => setTimeout(done, 50));
  }
}

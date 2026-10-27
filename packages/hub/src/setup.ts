// `deep setup` (#18's part of it): Claude Code's hook entries merged into your user settings beside yours, and your
// ask settings drafted; `deep doctor`'s timing-relation items; and `deep waiter`, the background entry that wakes an
// idle session with an answer. The rest of setup (the login service, the wiki, undo) is #19's and #41's.
import { mkdirSync, readFileSync } from 'node:fs';
import { draftAskSettings } from '@deepbuild/asks';
import { claudeSettings, install, longestDeadline, ourGroups, relations } from './claude-settings.js';
import { call } from './client.js';
import { deepHook, hubAddress, installedRoot, rootOf } from './paths.js';

/** `deep setup`: exit 0 once Claude Code's user settings hold our entries beside yours. `cli` is the deep command's script. */
export async function setupCommand(cli: string): Promise<number> {
  const root = installedRoot();
  mkdirSync(root, { recursive: true, mode: 0o700 });
  try {
    await draftAskSettings(root);
    // The waiter waits as long as your longest ask deadline, so an answer in time can still wake the session.
    const longest = longestDeadline(root) ?? 0;
    const waiter = `'${process.execPath}' '${cli}' waiter`;
    install(root, ourGroups(deepHook(), waiter, Math.max(600, Math.ceil(longest / 1000))));
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
 * `deep waiter`, run by Claude Code's background Stop entry: waits for an answer for its session and wakes the session
 * with it (exit 2, the answer on stderr). It ends quietly when Claude Code goes, or the hub does.
 */
export async function waiterCommand(): Promise<number> {
  let session = '';
  try { session = String((JSON.parse(readFileSync(0, 'utf8')) as { session_id?: unknown }).session_id ?? ''); } catch { /* no payload */ }
  if (!session) return 0;
  const parent = process.ppid;
  const watch = setInterval(() => { try { process.kill(parent, 0); } catch { process.exit(0); } }, 2000);
  watch.unref();
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    const reply = await call(hubAddress().path, token, 'session.wait', { session });
    if (!('result' in reply) || typeof reply.result.text !== 'string') return 0;
    process.stderr.write(`${reply.result.text}\n`);
    return 2;
  } catch {
    return 0;
  } finally {
    clearInterval(watch);
  }
}

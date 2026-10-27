// AC18 #19.b903fde1 `deep doctor` detects other hook-based tools and reports the order hooks run in.
//
// Another tool, a terminal multiplexer's `herd-hook` (fixtures/herd-hook.sh), has its own entries in Claude Code's
// user settings beside DeepBuild's: on PreToolUse, written before setup; on UserPromptSubmit, put first after setup;
// and on Stop, put last after setup. The doctor must name the tool and, for each of those hooks, list the entries in
// the order Claude Code reads and starts them, the settings file's order (README: AC18, The order hooks run in):
// herd-hook before DeepBuild on UserPromptSubmit, DeepBuild before herd-hook on Stop, and on PreToolUse whatever
// order setup left in the file.

import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURES, cleanup, doctor, entries, isDeepBuild, itemText, itemsShown, readSettings, shown, world, writeSettings, type Home, type Line } from './helpers.ts';

afterAll(cleanup, 60_000);

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'StopFailure', 'SessionEnd', 'Notification', 'SubagentStop', 'PreCompact'];
const eventAt = (event: string) => new RegExp(`\\b${event}\\b`, 'g');
const OURS = /deep-hook|DeepBuild|deep waiter|packages\/cli\/dist\/main\.js/;
const herd = (h: Home) => join(h.tmp, 'tools', 'herd-hook');
const entry = (h: Home, arg: string) => ({ type: 'command', command: `'${herd(h)}' ${arg}` });

/** In the file, which comes first on `event`: 'herd' or 'ours'. */
function fileOrder(settings: Line, event: string): 'herd' | 'ours' {
  const first = entries(settings).find((e) => e.event === event && (isDeepBuild(e.hook.command) || String(e.hook.command).includes('herd-hook')));
  return first && isDeepBuild(first.hook.command) ? 'ours' : 'herd';
}
/**
 * The order the doctor's text gives on `event`: each stretch of text that starts at the event's name and runs to the
 * next hook event's name, among those naming both herd-hook and DeepBuild, says which comes first.
 */
function reportedOrders(text: string, event: string): ('herd' | 'ours')[] {
  const starts = [...text.matchAll(eventAt(event))].map((m) => m.index!);
  const others = EVENTS.filter((e) => e !== event).flatMap((e) => [...text.matchAll(eventAt(e))].map((m) => m.index!));
  return starts.flatMap((start) => {
    const end = Math.min(text.length, ...others.filter((o) => o > start));
    const stretch = text.slice(start, end);
    const h = stretch.indexOf('herd-hook');
    const o = stretch.search(OURS);
    return h >= 0 && o >= 0 ? [h < o ? 'herd' as const : 'ours' as const] : [];
  });
}

/** Throws naming the hook whose order the doctor gets wrong, or the tool it doesn't detect. */
async function orderReported(plant?: string): Promise<void> {
  const w = await world({
    ...(plant ? { plant } : {}),
    before: (settings, h) => {
      mkdirSync(join(h.tmp, 'tools'), { recursive: true });
      copyFileSync(join(FIXTURES, 'herd-hook.sh'), herd(h));
      chmodSync(herd(h), 0o755);
      settings.hooks = { PreToolUse: [{ matcher: '*', hooks: [entry(h, 'pre')] }] };
    },
    after: (h) => {
      const settings = readSettings(h);
      settings.hooks.UserPromptSubmit = [{ hooks: [entry(h, 'prompt')] }, ...(settings.hooks.UserPromptSubmit ?? [])];
      settings.hooks.Stop = [...(settings.hooks.Stop ?? []), { hooks: [entry(h, 'stop')] }];
      writeSettings(h, settings);
    },
  });
  const settings = readSettings(w.h);
  const expected = { UserPromptSubmit: 'herd', Stop: 'ours', PreToolUse: fileOrder(settings, 'PreToolUse') } as const;
  if (fileOrder(settings, 'UserPromptSubmit') !== 'herd' || fileOrder(settings, 'Stop') !== 'ours') throw Error(`BLOCKED: the fixture's order isn't as written: ${JSON.stringify(settings.hooks)}`);
  const d = await doctor(w.h);
  const about = d.items.filter((i) => itemText(i).includes('herd-hook'));
  if (!about.length) expect.fail(`AC18 deep doctor must detect the other hook-based tool, ${herd(w.h)}, in Claude Code's user settings: ${shown(d.ran)}`);
  const text = about.map(itemText).join('\n');
  for (const [event, first] of Object.entries(expected)) {
    const said = reportedOrders(text, event);
    if (!said.length) expect.fail(`AC18 deep doctor must report the order hooks run in on ${event}, naming herd-hook and DeepBuild's entry: ${itemsShown(about)}`);
    if (said.some((o) => o !== first)) expect.fail(`AC18 on ${event} the file has ${first === 'herd' ? 'herd-hook before DeepBuild' : 'DeepBuild before herd-hook'}, and deep doctor reports the other order: ${itemsShown(about)}`);
  }
}

describe('AC18 #19.b903fde1 `deep doctor` detects other hook-based tools and reports the order hooks run in', () => {
  it('AC18 #19.b903fde1 deep doctor names another tool\'s hook entries and lists each hook\'s entries in the order Claude Code runs them: herd-hook first on UserPromptSubmit, DeepBuild first on Stop', async () => {
    await orderReported();
  }, 600_000);

  it('AC18 #19.b903fde1 (wrong program) a doctor that lists DeepBuild\'s entries first whatever the file says (hooks-order-ours-first) fails this test, naming the hook', async () => {
    await expect(orderReported('hooks-order-ours-first')).rejects.toThrow(/AC18 on UserPromptSubmit the file has herd-hook before DeepBuild, and deep doctor reports the other order/);
  }, 600_000);
});


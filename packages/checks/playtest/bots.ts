// The bot as a replica plays it (#184, #555). A policy and a logic bot play as given. The first-party bots, the legal
// bot, the explorer and the descender, read only the play interface's names and act only through a listed row, which
// becomes the entry a player's gesture on that action's control would make, with the writer bot; the replica runs
// them beside the piece (deep-logic's grid_bot), so their search costs the piece no fuel and every run is one play.
// Here each is taken or refused before any run: it needs the interface, and an action it names must be declared.
import type { PlayIface } from './iface.ts';
import type { Bot, Lowered } from './types.ts';

/** The first-party bots, by the field that names each. */
export const FIRST_PARTY = ['legal', 'explorer', 'descender'] as const;

/** The bot's own name in messages: its kind. */
export function kindOf(bot: Bot): string {
  return FIRST_PARTY.find((k) => k in bot) ?? ('policy' in bot ? 'policy' : 'logic');
}

/** The bot as a replica runs it: without the input's bands, expectations and authorship. */
export function lower(bot: Bot): Lowered {
  const { by: _by, share: _share, expect: _expect, ...run } = bot;
  return run as Lowered;
}

/**
 * Why a bot can't play this input, before any run, or nothing: a first-party bot with no play interface, or an action
 * a bot names that the interface doesn't declare (a descender's `action`, a policy's key or pick on an action's name).
 */
export function refusal(bot: Bot, play: PlayIface | undefined): string | undefined {
  const kind = kindOf(bot);
  const declared = new Set(Object.keys(play?.actions ?? {}));
  if (FIRST_PARTY.some((k) => k in bot) && !play) return `the ${kind} plays a play interface, and the input gives none`;
  const named: [string, string | undefined][] = [];
  if ('descender' in bot) named.push([bot.descender.action, undefined]);
  if ('policy' in bot) {
    // A policy's value may be the name of an action on that control, put as the entry that action's gesture makes.
    for (const [control, keys] of Object.entries(bot.policy.keys ?? {})) for (const [, v] of keys) if (typeof v === 'string') named.push([v, control]);
    for (const [control, p] of Object.entries(bot.policy.pick ?? {})) for (const v of p.from) if (typeof v === 'string') named.push([v, control]);
  }
  for (const [action, control] of named) {
    if (!declared.has(action)) return `the ${kind} names the action ${action}, which the play interface doesn't declare`;
    const on = play?.actions?.[action]?.control;
    if (control !== undefined && on !== control) return `the ${kind} puts the action ${action} on ${control}, and the play interface declares it on ${on}`;
  }
  return undefined;
}

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
  return FIRST_PARTY.find((k) => k in bot) ?? ('policy' in bot ? 'policy' : 'model' in bot ? 'model' : 'logic');
}

/** The bot as a replica runs it: without the input's bands, expectations and authorship. */
export function lower(bot: Bot): Lowered {
  const { by: _by, share: _share, expect: _expect, ...run } = bot;
  return run as Lowered;
}

/**
 * Why a bot can't play this input, before any run, or nothing: a first-party or model bot with no play interface, a
 * model bot that can't ask as the design spells it, or a descender's `action` the interface doesn't declare.
 */
export function refusal(bot: Bot, play: PlayIface | undefined): string | undefined {
  const kind = kindOf(bot);
  const declared = new Set(Object.keys(play?.actions ?? {}));
  if ((FIRST_PARTY.some((k) => k in bot) || 'model' in bot) && !play) return `the ${kind} plays a play interface, and the input gives none`;
  // #1048: a model bot picks among listed rows, at most once every 15 steps.
  if ('model' in bot) {
    if (!play?.legal) return 'the model picks one of the rows the piece lists, and the interface declares no legal list';
    if (!(typeof bot.model.provider === 'string' && /^[^@\s]+@[^@\s]+$/.test(bot.model.provider))) return 'a model bot names its provider as name@version';
    if ((bot.model.every ?? 15) < 15) return `a model bot asks at most once every 15 steps, not every ${bot.model.every}`;
  }
  // A policy's string names an action on its control, or (#1048) on a text control is a commit: the replica, which
  // reads the control's kind, refuses an action the interface doesn't declare there before any run.
  if ('descender' in bot && !declared.has(bot.descender.action)) return `the ${kind} names the action ${bot.descender.action}, which the play interface doesn't declare`;
  return undefined;
}

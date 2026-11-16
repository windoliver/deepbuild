// The first-party bot slot (#184): a bot the plug-in ships is a file here that declares this interface. It reads only
// the play interface's names and the run's seed, and lowers to one of the two forms a replica runs, a policy or a
// logic bot, so it writes only the rows the replica stamps with the writer bot and runs outside the piece's fuel.
// Later tasks add bots as files (#555's legal, explorer and descender); the bot union ends with a registered one's name.
import type { Bot, Lowered } from './types.ts';

export interface FirstPartyBot {
  name: string;
  /** The names of the play interface it reads. */
  reads: string[];
  lower(params: Record<string, unknown>, seed: number): Lowered;
}

/** The registered first-party bots, by name. */
export const BOTS: readonly FirstPartyBot[] = [];

/** The bot as a replica runs it: a policy or logic bot as given, or a registered bot lowered for the run's seed. */
export function lower(bot: Bot, seed: number): Lowered {
  if ('policy' in bot) return { policy: bot.policy };
  if ('logic' in bot) return { logic: bot.logic };
  const found = BOTS.find((b) => b.name === bot.bot);
  if (!found) throw Error(`no first-party bot ${bot.bot} is registered`);
  return found.lower(bot.params ?? {}, seed);
}

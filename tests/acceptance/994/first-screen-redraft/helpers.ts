// #994's first screen on the real window (README): the app in a set-up temp home, and the judges of its count and an
// ask's row. Worlds and asks are ../helpers.ts's, through #27's; the window is #1002's redraft's window.ts, one copy for
// both redrafts. Each judge returns what's wrong, so a tagged test and a wrong program go through the same one.
import { dirname } from 'node:path';
import { childEnv, own } from '../../27/helpers.ts';
import { allEvents, openAsk, type Hub, type Setting } from '../helpers.ts';
import { App, appBinary, named, read, squash, type Plant, type Seen } from '../../1002/first-screen-redraft/window.ts';

const HUB = /\bhub\b.*(isn['’]?t|not) answering/i;
const HUB_SQUASHED = /hub(isnt|not)answering/;
const NUMBER = /\b\d+\s+asks?\s+needs?\s+you\b/i;

/** The app as a person starts it, in `home`, light. `setting` stands in for the OS's answer (#994's README). */
export async function open(home: string, setting: Setting, plant?: Plant): Promise<App> {
  const binary = await appBinary(plant);
  return App.launch({ binary, cwd: dirname(home), own, env: childEnv(home, { DEEP_APP_NOTIFICATION_SETTING: setting, DEEP_APP_APPEARANCE: 'light' }) });
}

const texts = (s: Seen): string[] => s.nodes.map((n) => n.name).filter(Boolean);

/** The count while the app can't read the hub: it says so on the nodes, the pixels and the menu bar, and shows no number. */
export function hubCountFailures(s: Seen): string[] {
  const out: string[] = [];
  const number = [...texts(s), ...s.lines].find((t) => NUMBER.test(t));
  if (number !== undefined) out.push(`the count must say the hub isn't answering: the window reads ${JSON.stringify(number)}`);
  const menu = s.menu.join(' ').trim();
  if (!HUB.test(menu)) out.push(`the count must say the hub isn't answering: the menu bar reads ${JSON.stringify(menu)}`);
  if (!texts(s).some((t) => HUB.test(t))) out.push(`the count must say the hub isn't answering: no node of the window says so; its names are ${named(s)}`);
  if (!HUB_SQUASHED.test(squash(s.lines.join('')))) out.push(`the count must say the hub isn't answering: the window's pixels don't say so; they read ${read(s)}`);
  return out;
}

/** The count once the hub answers: a number of asks, in words in the window and alone in the menu bar, and no word of the hub. */
export function answeringFailures(s: Seen, count: number): string[] {
  const out: string[] = [];
  const words = count === 1 ? '1 ask needs you' : `${count} asks need you`;
  if (![...texts(s)].some((t) => t.includes(words))) out.push(`the count must read "${words}" once the hub answers; the window's names are ${named(s)}`);
  if (!s.lines.some((l) => l.includes(words))) out.push(`the count must read "${words}" once the hub answers; the window's pixels read ${read(s)}`);
  const said = [...texts(s), ...s.lines, ...s.menu].find((t) => HUB.test(t));
  if (said !== undefined) out.push(`the count must stop saying the hub isn't answering once it answers: the window reads ${JSON.stringify(said)}`);
  return out;
}

export interface Row { handle: string; question: string }
/** The ask's row: one row for the ask, its question on the nodes and the pixels, saying not notified on both. */
export function rowFailures(s: Seen, ask: Row): string[] {
  const out: string[] = [];
  const rows = s.nodes.filter((n) => n.name.includes(ask.question));
  if (rows.length !== 1) out.push(`${ask.handle} should have one row showing its question; it has ${rows.length}; the window's names are ${named(s)}`);
  else if (!/not notified/i.test(rows[0]!.name)) out.push(`${ask.handle}'s row must say not notified; it reads ${JSON.stringify(rows[0]!.name)}`);
  const pixels = squash(s.lines.join(''));
  if (!pixels.includes(squash(ask.question))) out.push(`${ask.handle}'s question isn't on the window's pixels; they read ${read(s)}`);
  else if (!pixels.includes('notnotified')) out.push(`${ask.handle}'s row must say not notified on the window's pixels; they read ${read(s)}`);
  return out;
}
/** With notifications allowed the same row says nothing of the kind. */
export function notifiedRowFailures(s: Seen, ask: Row): string[] {
  const out: string[] = [];
  if (!s.nodes.some((n) => n.name.includes(ask.question))) out.push(`${ask.handle} should have a row showing its question; the window's names are ${named(s)}`);
  if (!squash(s.lines.join('')).includes(squash(ask.question))) out.push(`${ask.handle}'s question isn't on the window's pixels; they read ${read(s)}`);
  const said = [...texts(s), ...s.lines].find((t) => /not notified/i.test(t));
  if (said !== undefined) out.push(`with notifications allowed nothing says not notified; the window reads ${JSON.stringify(said)}`);
  return out;
}

/** An ask a session of the Claude Code stand-in opens through deep_ask, while the app's window is up. */
export async function askedRow(hub: Hub, repo: string): Promise<Row> {
  const { handle } = await openAsk(hub, repo);
  const created = (await allEvents(hub)).find((e) => `ask:${e.id}` === handle);
  const question = created?.data?.question;
  if (typeof question !== 'string') throw Error(`BLOCKED: no question recorded for ${handle}`);
  return { handle, question };
}

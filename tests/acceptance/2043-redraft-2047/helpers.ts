// Test-side tools for the #2043 redraft (README). Every hub is `deep hub run` on a temp home, a real process reached
// only through its socket; #16's helpers make the homes, start the hubs and stop, by PID, only what this suite started.
import { alive, control, health, sendHook, type Hub, type HookResult, type Line } from '../16/helpers.ts';

/** Each criterion's live ID: `#2043.` + the first 8 hex of SHA-256 of its text, trimmed, white space collapsed. */
export const ID = {
  fixture: '#2043.3139319d',
  fifteen: '#2043.630d1d3d',
  throws: '#2043.a1a91749',
  exits: '#2043.e52db1b5',
} as const;

/** The five names every plain object has, as the issue lists them. */
export const NAMES = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'] as const;

/** How long one line may wait for the hub's last line back (sendHook bounds its own wait with it). */
export const LINE_MS = 10_000;

/** One line as a new connection's first, as deep-hook writes it; what came back. Never throws. */
export const send = (hub: Hub, text: string): Promise<HookResult> => sendHook(hub.socket, text.endsWith('\n') ? text : `${text}\n`, LINE_MS);

/** The lines the hub sent, with each `from` text written as its `to`: how another line answered alike reads. */
export function swapped(lines: Line[], swaps: Array<[string, string]>): string {
  let text = JSON.stringify(lines);
  for (const [from, to] of swaps) text = text.split(from).join(to);
  return text;
}

/** An answer: an ack naming the line's id, then a reply with a numeric exit, and no error line. */
export const answered = (r: HookResult, id: string): boolean =>
  r.ack?.ack === id && typeof r.reply?.exit === 'number' && r.error === undefined;

/** A refusal, error@1's shape (a non-empty code and a remediation), with no ack and no reply. */
export const refused = (r: HookResult): boolean =>
  typeof r.error?.code === 'string' && r.error.code !== '' && typeof r.error.remediation === 'string' && r.ack === undefined && r.reply === undefined;

/** A result as a failure message shows it. */
export const shown = (r: HookResult): string => `${JSON.stringify(r.lines)} (${r.end === 'reply' ? 'the last line came' : r.end === 'timeout' ? `still waiting at ${LINE_MS / 1000} s` : r.end === 'close' ? 'the hub closed the connection with nothing more' : r.end})`;

/** Whether the hub's process still runs, with the end of its stderr when it doesn't: for failure messages. */
export const fate = (hub: Hub): string =>
  alive(hub.pid) ? `the hub's process ${hub.pid} still runs` : `the hub's process ${hub.pid} has ended; its stderr ends: ${hub.proc.stderr().trim().slice(-800)}`;

/** hub.health on a new control connection, or why none came. Never throws. */
export async function healthNow(hub: Hub): Promise<Line | string> {
  try {
    const cli = await control(hub);
    try { return await health(cli); } finally { cli.close(); }
  } catch (error) {
    return `no hub.health (${(error as Error).message})`;
  }
}
